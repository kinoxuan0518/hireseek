// @hireclaw/core/evaluator/llm — LLM-powered Candidate Evaluation
//
// Sends candidate profile + job config + evaluation guide to LLM,
// receives structured EvaluationResult back.
// Falls back to rule engine when LLM is unavailable.

import type {
  Candidate,
  JobConfig,
  EvaluationConfig,
  EvaluationResult,
  EvaluationDimension,
  BonusHit,
  LLMConfig,
} from '../types.js';
import { callLLM, type LLMMessage } from '../llm/index.js';
import { evaluate as ruleEngineEvaluate, type EvaluateOptions } from './rules.js';

// ────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────

export interface LLMEvaluatorOptions extends EvaluateOptions {
  /** LLM configuration (required for LLM mode) */
  llm: LLMConfig;
  /** Path to candidate-evaluation.md (will be read at call time) */
  evaluationGuidePath?: string;
  /** Custom system prompt additions */
  systemPromptAdditions?: string;
}

// ────────────────────────────────────────────────────────────
// Main Entry — try LLM, fallback to rules
// ────────────────────────────────────────────────────────────

/**
 * Evaluate a candidate using LLM when available, falling back to rule engine.
 */
export async function evaluateWithLLM(
  candidate: Candidate,
  job: JobConfig,
  options: LLMEvaluatorOptions,
): Promise<EvaluationResult> {
  // Try LLM first
  try {
    return await evaluateByLLM(candidate, job, options);
  } catch (err) {
    // Fallback to rule engine
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[evaluator] LLM failed, falling back to rule engine: ${errMsg}`);
    return ruleEngineEvaluate(candidate, job, options);
  }
}

/**
 * Batch evaluate candidates using LLM.
 */
export async function evaluateBatchWithLLM(
  candidates: Candidate[],
  job: JobConfig,
  options: LLMEvaluatorOptions,
): Promise<Array<{ candidate: Candidate; result: EvaluationResult }>> {
  const results = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      result: await evaluateWithLLM(candidate, job, options),
    }))
  );

  // Sort by score descending
  results.sort((a, b) => b.result.score - a.result.score);
  return results;
}

// ────────────────────────────────────────────────────────────
// LLM Evaluation
// ────────────────────────────────────────────────────────────

async function evaluateByLLM(
  candidate: Candidate,
  job: JobConfig,
  options: LLMEvaluatorOptions,
): Promise<EvaluationResult> {
  const systemPrompt = buildSystemPrompt(options);
  const userPrompt = buildUserPrompt(candidate, job, options.config);

  const response = await callLLM(options.llm, {
    system: systemPrompt,
    prompt: userPrompt,
    jsonMode: true,
    maxTokens: 2048,
    temperature: 0.2,
  });

  const raw = response.json;
  if (!raw || typeof raw !== 'object') {
    throw new Error('LLM did not return valid JSON');
  }

  return parseAndValidate(raw as Record<string, unknown>, options.config);
}

// ────────────────────────────────────────────────────────────
// Prompt Construction
// ────────────────────────────────────────────────────────────

function buildSystemPrompt(options: LLMEvaluatorOptions): string {
  const guide = options.evaluationGuidePath
    ? '[Evaluation guide content will be provided separately]'
    : '';

  return `你是一个专业的招聘评估助手，负责评估候选人是否适合某个岗位。

你的任务：根据候选人简历和岗位要求，输出结构化的评估结果。

## 评估维度（6个）
1. education（学历与绩点）- 权重 0.15：看绩点不只看学校，绩点高→进取心强
2. experience（实际做的事情）- 权重 0.25：有具体描述、可量化结果、技术选型理由
3. skills（技能匹配度）- 权重 0.25：与职位关键词匹配 + 前沿技术栈
4. company（公司背景）- 权重 0.15：大厂标准高、明星公司含金量不输大厂
5. growth（成长轨迹）- 权重 0.10：跳槽频率、职级提升、方向一致性
6. personality（个人特质）- 权重 0.10：GitHub活跃度、个人项目、爱好推断

## 综合判断原则
- 80%合适就值得推进，不存在完美候选人
- 学历是底线，但一个有趣的人可以弥补很多
- 看行为，不看标签
- 每个维度打分 0-100
- 两个关键问题：80%匹配？剩下20%能否验证？

${options.systemPromptAdditions ? '\n' + options.systemPromptAdditions : ''}`;
}

function buildUserPrompt(
  candidate: Candidate,
  job: JobConfig,
  evalConfig?: EvaluationConfig,
): string {
  const profile = candidate.profile;

  // Serialize candidate info
  const educationStr = (profile.education ?? [])
    .map(e => `- ${e.school}${e.degree ? ' ' + e.degree : ''}${e.major ? '·' + e.major : ''}${e.gpa ? ' GPA:' + e.gpa : ''}`)
    .join('\n');

  const experienceStr = (profile.experience ?? [])
    .map(e => `- ${e.company} | ${e.title}${e.startDate ? ' (' + e.startDate + ' ~ ' + (e.endDate ?? '至今') + ')' : ''}${e.description ? '\n  ' + e.description : ''}`)
    .join('\n');

  const skillsStr = (profile.skills ?? []).join('、');

  const extStr = Object.entries(profile.ext ?? {}).length > 0
    ? '\n其他信息:\n' + Object.entries(profile.ext)
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join('\n')
    : '';

  const rawTextStr = candidate.source.rawText
    ? `\n简历原文:\n${candidate.source.rawText.slice(0, 3000)}`
    : '';

  // Job info
  const jobStr = `## 目标岗位
- 职位: ${job.title}${job.department ? '（' + job.department + '）' : ''}
${job.location ? '- 地点: ' + job.location : ''}
${job.salary ? '- 薪资: ' + job.salary.min + '-' + job.salary.max + (job.salary.currency ?? 'CNY') + '/' + (job.salary.period ?? 'month') : ''}
${job.description ? '- 岗位描述: ' + job.description : ''}
${evalConfig?.requirements ? '- 特殊要求: ' + evalConfig.requirements.join('、') : ''}`;

  const strictnessNote = evalConfig?.strictness
    ? `\n评估严格度: ${evalConfig.strictness === 'strict' ? '严格（阈值85）' : evalConfig.strictness === 'relaxed' ? '宽松（阈值70）' : '标准（阈值80）'}`
    : '\n评估严格度: 标准（阈值80）';

  return `## 候选人信息
姓名: ${candidate.name}
来源: ${candidate.platform}
教育经历:
${educationStr || '  （无）'}

工作经历:
${experienceStr || '  （无）'}

技能: ${skillsStr || '（无）'}
${extStr}${rawTextStr}

${jobStr}
${strictnessNote}

请严格按照以下JSON格式输出评估结果（不要输出其他内容）：
{
  "score": <总分0-100>,
  "passed": <boolean, score >= 阈值 且无否决项>,
  "threshold": <通过阈值>,
  "dimensions": [
    {"name": "education", "score": <0-100>, "weight": 0.15, "weightedScore": <score*weight四舍五入>, "notes": "<评估说明>"},
    {"name": "experience", "score": <0-100>, "weight": 0.25, "weightedScore": <score*weight四舍五入>, "notes": "<评估说明>"},
    {"name": "skills", "score": <0-100>, "weight": 0.25, "weightedScore": <score*weight四舍五入>, "notes": "<评估说明>"},
    {"name": "company", "score": <0-100>, "weight": 0.15, "weightedScore": <score*weight四舍五入>, "notes": "<评估说明>"},
    {"name": "growth", "score": <0-100>, "weight": 0.10, "weightedScore": <score*weight四舍五入>, "notes": "<评估说明>"},
    {"name": "personality", "score": <0-100>, "weight": 0.10, "weightedScore": <score*weight四舍五入>, "notes": "<评估说明>"}
  ],
  "vetoed": ["<触发的否决项描述>" 或 空数组],
  "bonuses": [{"rule": "<加分项描述>", "points": <分数>}" 或 空数组],
  "priority": "<critical|high|medium|low>",
  "summary": "<一句话综合评价>"
}`;
}

// ────────────────────────────────────────────────────────────
// Response Parsing & Validation
// ────────────────────────────────────────────────────────────

function parseAndValidate(
  raw: Record<string, unknown>,
  evalConfig?: EvaluationConfig,
): EvaluationResult {
  const strictness = evalConfig?.strictness ?? 'standard';
  const defaultThreshold: Record<string, number> = { strict: 85, standard: 80, relaxed: 70 };
  const threshold = typeof raw.threshold === 'number'
    ? raw.threshold
    : defaultThreshold[strictness];

  // Validate dimensions
  const rawDims = raw.dimensions;
  const dimensions: EvaluationDimension[] = Array.isArray(rawDims)
    ? rawDims.map((d: Record<string, unknown>) => ({
        name: String(d.name ?? 'unknown'),
        score: clamp(Number(d.score) || 0, 0, 100),
        weight: clamp(Number(d.weight) || 0, 0, 1),
        weightedScore: clamp(Number(d.weightedScore) || 0, 0, 100),
        notes: String(d.notes ?? ''),
      }))
    : [];

  // Validate bonuses
  const rawBonuses = raw.bonuses;
  const bonuses: BonusHit[] = Array.isArray(rawBonuses)
    ? rawBonuses.map((b: Record<string, unknown>) => ({
        rule: String(b.rule ?? ''),
        points: Number(b.points) || 0,
      }))
    : [];

  // Validate vetoed
  const rawVetoed = raw.vetoed;
  const vetoed: string[] = Array.isArray(rawVetoed)
    ? rawVetoed.map(String)
    : [];

  // Validate priority
  const validPriorities = ['critical', 'high', 'medium', 'low'] as const;
  const rawPriority = String(raw.priority ?? '');
  const priority = validPriorities.includes(rawPriority as typeof validPriorities[number])
    ? (rawPriority as EvaluationResult['priority'])
    : inferPriority(Number(raw.score) || 0);

  const score = clamp(Number(raw.score) || 0, 0, 100);
  const passed = raw.passed === true
    ? true
    : raw.passed === false
      ? false
      : score >= threshold && vetoed.length === 0;

  return {
    score,
    passed,
    threshold,
    dimensions,
    vetoed,
    bonuses,
    priority,
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inferPriority(score: number): EvaluationResult['priority'] {
  if (score >= 90) return 'critical';
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}
