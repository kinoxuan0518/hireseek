// @hireclaw/core/outreach/llm — LLM-powered Message Generation
//
// Sends candidate profile + evaluation + job config + outreach guide to LLM,
// receives Level 3-4 personalized outreach messages.
// Falls back to template engine when LLM is unavailable.

import type {
  Candidate,
  JobConfig,
  EvaluationResult,
  OutreachConfig,
  OutreachMessage,
  LLMConfig,
} from '../types.js';
import { callLLM } from '../llm/index.js';

// ────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────

export interface LLMOutreachOptions {
  candidate: Candidate;
  evaluation: EvaluationResult;
  job: JobConfig;
  tier: string;
  attemptNumber: number;
  previousMessages?: string[];
  brandTone?: string;
  llm: LLMConfig;
  /** Path to outreach-guide.md (will be referenced in prompt) */
  outreachGuidePath?: string;
}

// ────────────────────────────────────────────────────────────
// Main Entry — try LLM, caller handles fallback
// ────────────────────────────────────────────────────────────

/**
 * Generate an outreach message using LLM.
 * Caller should catch errors and fall back to template-based generation.
 */
export async function generateMessageWithLLM(
  options: LLMOutreachOptions,
): Promise<OutreachMessage> {
  const systemPrompt = buildSystemPrompt(options);
  const userPrompt = buildUserPrompt(options);

  const response = await callLLM(options.llm, {
    system: systemPrompt,
    prompt: userPrompt,
    jsonMode: true,
    maxTokens: 1024,
    temperature: 0.7, // Higher temp for creative messages
  });

  const raw = response.json;
  if (!raw || typeof raw !== 'object') {
    throw new Error('LLM did not return valid JSON');
  }

  return parseResponse(raw as Record<string, unknown>);
}

// ────────────────────────────────────────────────────────────
// Prompt Construction
// ────────────────────────────────────────────────────────────

function buildSystemPrompt(options: LLMOutreachOptions): string {
  return `你是一个专业的招聘触达话术生成器。你的核心目标：**让候选人感觉到他被真正看见了**。

## 四个话术层次
1. Level 1: 通用话术 — 效率最低，最后手段
2. Level 2: 针对本人的细节 — 提及简历具体细节
3. Level 3: 站在候选人角度 — 推断他的处境和诉求
4. Level 4: 有温度 — 信息量 + 针对性 + 像真人写的

## 你的任务
生成 Level 3-4 的话术（Level 1-2 作为 fallback）。

## 核心原则
- 看完简历再写，每条消息至少有一个只有看了简历才能写出来的细节
- 公司亮点要真实，不说"行业领先"，说具体在做什么
- 越短越好，目的是让他想回复
- 语气跟着人走：严谨型→专业直接，跳脱型→轻松
- 像真人写的，不是 HR 模板或营销文案

## 精力分配
- 顶级候选人（critical）：深挖背景，多角度
- 优秀候选人（high）：研究背景，有针对性
- 普通候选人（medium）：一条消息，不纠缠${options.brandTone ? '\n\n## 公司调性\n' + options.brandTone : ''}`;
}

function buildUserPrompt(options: LLMOutreachOptions): string {
  const { candidate, evaluation, job, tier, attemptNumber, previousMessages } = options;
  const profile = candidate.profile;

  // Serialize candidate
  const educationStr = (profile.education ?? [])
    .map(e => `- ${e.school}${e.degree ? ' ' + e.degree : ''}${e.major ? '·' + e.major : ''}${e.gpa ? ' GPA:' + e.gpa : ''}`)
    .join('\n');

  const experienceStr = (profile.experience ?? [])
    .map(e => `- ${e.company} | ${e.title}${e.description ? ': ' + e.description.slice(0, 200) : ''}`)
    .join('\n');

  const skillsStr = (profile.skills ?? []).join('、');

  const evalSummary = `评估总分: ${evaluation.score}/100 | 段位: ${tier} | ${evaluation.passed ? '通过' : '未通过'}
${evaluation.summary ? '综合评价: ' + evaluation.summary : ''}
${evaluation.vetoed.length > 0 ? '否决项: ' + evaluation.vetoed.join('、') : ''}
${evaluation.bonuses.length > 0 ? '加分项: ' + evaluation.bonuses.map(b => b.rule).join('、') : ''}
各维度: ${evaluation.dimensions.map(d => `${d.name}=${d.score}(${d.notes.slice(0, 20)})`).join(', ')}`;

  const previousStr = previousMessages && previousMessages.length > 0
    ? `\n\n## 已发送过的消息（不要重复）\n${previousMessages.map((m, i) => `#${i + 1}: ${m}`).join('\n')}`
    : '';

  const attemptNote = attemptNumber > 1
    ? `\n\n## 注意\n这是第 ${attemptNumber} 次触达。必须换角度、换内容，不能重复之前的消息。`
    : '';

  return `## 候选人信息
姓名: ${candidate.name}
来源: ${candidate.platform}
教育: ${educationStr || '（无）'}
经历: ${experienceStr || '（无）'}
技能: ${skillsStr || '（无）'}

## 评估结果
${evalSummary}

## 目标岗位
职位: ${job.title}${job.department ? '（' + job.department + '）' : ''}
${job.location ? '地点: ' + job.location : ''}
${job.description ? '描述: ' + job.description.slice(0, 200) : ''}
${job.outreach?.companyHighlights ? '公司亮点: ' + job.outreach.companyHighlights.join('、') : ''}
${previousStr}${attemptNote}

请严格按照以下JSON格式输出（不要输出其他内容）：
{
  "content": "<生成的触达消息>",
  "level": <1|2|3|4>,
  "reasoning": "<为什么这么写>",
  "suggestedTime": "<建议触达时间>" 或 null
}`;
}

// ────────────────────────────────────────────────────────────
// Response Parsing
// ────────────────────────────────────────────────────────────

function parseResponse(raw: Record<string, unknown>): OutreachMessage {
  const content = typeof raw.content === 'string' ? raw.content : '';
  if (!content) {
    throw new Error('LLM returned empty message content');
  }

  const rawLevel = Number(raw.level);
  const validLevels = [1, 2, 3, 4] as const;
  const level = validLevels.includes(rawLevel as 1 | 2 | 3 | 4)
    ? (rawLevel as 1 | 2 | 3 | 4)
    : 2; // Default to level 2 if invalid

  return {
    content,
    level,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    suggestedTime: typeof raw.suggestedTime === 'string' && raw.suggestedTime
      ? raw.suggestedTime
      : undefined,
  };
}
