/**
 * 学习闭环 —— 让"合适"的定义自己长
 *
 * 校准（feedback.ts）告诉我们"判断准不准"；这一步更进一层：把真实过面结果回喂，
 * **自动重写"合适"的定义本身**（references/candidate-evaluation.md）。
 *
 *   既被验证器预测过、又有真实过面结果的候选人  →  尤其是**误判**：
 *     · 判合适(fit≥60) 却挂面 = 假阳性（定义把不该要的当成了合适）
 *     · 判不合适(fit<60) 却过面 = 假阴性（定义漏掉了真正能过的人）
 *   →  v4-pro 分析"过面者共性 vs 挂面者共性"、现行 rubric 哪里欠校准
 *   →  产出修订版 rubric（复用 evolution 的安全写盘：每次独立 git commit、可回滚）
 *
 * 铁律（与既有进化系统一致）：**无数据支撑不改写**。样本不足 → 不产出提案。
 * 自主路径只允许 dry-run + 通知；落盘由 CLI/人确认。
 */

import OpenAI from 'openai';
import { config } from '../config';
import { db } from '../db';
import { loadWorkspaceFile } from '../skills/loader';
import { calibrationReport } from '../feedback';
import { EVOLVABLE_FILES, type Retrospective, type EvolutionProposal } from './retrospect';
import { createRuntimeContext } from '../agent-core/runtime-context';

/** 启动重校所需的最小"既预测又有结果"样本量——低于此不改写 */
const MIN_MATCHED = 8;
/** 至少要有这么多**误判**（假阳+假阴）才值得重写——没有误判就没有可学的东西 */
const MIN_MISJUDGED = 3;
/** 证据样本至少要跨这么多天，避免把"某一两天某面试官的口味"当成普适规律 */
const MIN_SPAN_DAYS = 3;
const FIT_THRESHOLD = 60;

export interface OutcomeRow {
  name: string;
  company: string | null;
  school: string | null;
  predicted_fit: number;
  result: 'passed' | 'failed';
  created_at: string;
  interviewer: string | null;
  feedback: string | null;
  screen_evidence: string | null;
  screen_fit_tags: string | null;
  screen_risk_flags: string | null;
  reading_depth: string | null;
  resume_digest: string | null;
  coherence_verdict: string | null;
  coherence_note: string | null;
  contact_evidence: string | null;
}

/**
 * 把当初"凭什么这么判"和"后来真的怎么样"接在一起。
 *
 * 只给姓名/公司/学校的话，模型最多学到「X 公司的人挂了」这种粗糙关联；
 * 带上筛选阶段用过的证据、标签、风险和合拍性判断，它才可能回答真正的问题：
 * 哪些信号确实预测了结果，哪些一直是噪音。
 */
export function gatherOutcomeEvidence(jobId: string): OutcomeRow[] {
  return db.prepare(`
    SELECT c.name, c.company, c.school, p.predicted_fit, o.result, o.created_at,
           o.interviewer, o.feedback,
           s.evidence          AS screen_evidence,
           s.fit_tags          AS screen_fit_tags,
           s.risk_flags        AS screen_risk_flags,
           s.reading_depth     AS reading_depth,
           s.resume_digest     AS resume_digest,
           s.coherence_verdict AS coherence_verdict,
           s.coherence_note    AS coherence_note,
           r.evidence          AS contact_evidence
    FROM interview_outcomes o
    JOIN fit_predictions p ON p.fingerprint = o.fingerprint AND p.job_id = o.job_id
    JOIN candidates c       ON c.fingerprint = o.fingerprint AND c.job_id = o.job_id
    LEFT JOIN screen_candidates s
      ON s.candidate_fingerprint = o.fingerprint AND s.job_id = o.job_id
     AND s.id = (SELECT MAX(s2.id) FROM screen_candidates s2
                  WHERE s2.candidate_fingerprint = o.fingerprint AND s2.job_id = o.job_id)
    LEFT JOIN run_candidates r
      ON r.candidate_fingerprint = o.fingerprint AND r.job_id = o.job_id
     AND r.id = (SELECT MAX(r2.id) FROM run_candidates r2
                  WHERE r2.candidate_fingerprint = o.fingerprint AND r2.job_id = o.job_id)
    WHERE o.job_id = ? AND o.fingerprint IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT 60
  `).all(jobId) as OutcomeRow[];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const COHERENCE_LABEL: Record<string, string> = {
  aligned: '整体合拍',
  mixed: '部分对上',
  misaligned: '整体不合拍',
};

/** 一个候选人的完整卷宗：当初的判断依据 + 真实结果 + 面试官怎么说 */
export function formatOutcomeRow(r: OutcomeRow): string {
  const head = `${r.name}｜${r.company || '公司未知'}｜${r.school || '学校未知'}｜判分${r.predicted_fit}｜实际${r.result === 'passed' ? '过面✅' : '挂面❌'}`;
  const lines = [head];

  const depth = r.reading_depth === 'detail' ? '通读简历详情' : r.reading_depth === 'card' ? '仅看列表卡片' : null;
  if (depth) lines.push(`  · 判断时读到：${depth}`);
  if (r.screen_evidence) lines.push(`  · 筛选依据：${r.screen_evidence.slice(0, 300)}`);

  const tags = parseTags(r.screen_fit_tags);
  if (tags.length) lines.push(`  · 命中标签：${tags.join('、')}`);
  const risks = parseTags(r.screen_risk_flags);
  if (risks.length) lines.push(`  · 当时的风险标记：${risks.join('、')}`);

  if (r.coherence_verdict) {
    const label = COHERENCE_LABEL[r.coherence_verdict] ?? r.coherence_verdict;
    lines.push(`  · 整份简历合拍性：${label}${r.coherence_note ? `——${r.coherence_note.slice(0, 200)}` : ''}`);
  }
  if (r.resume_digest) lines.push(`  · 简历摘要：${r.resume_digest.slice(0, 400)}`);
  if (!r.screen_evidence && r.contact_evidence) lines.push(`  · 触达时的理由：${r.contact_evidence.slice(0, 300)}`);
  if (r.feedback) lines.push(`  · 面试官评语${r.interviewer ? `（${r.interviewer}）` : ''}：${r.feedback.slice(0, 500)}`);
  else if (r.interviewer) lines.push(`  · 面试官：${r.interviewer}（无评语文本）`);

  return lines.join('\n');
}

/** 有多少人带回了当初的筛选依据——没有依据就学不到信号层面的东西 */
function signalCoverage(rows: OutcomeRow[]): { withScreen: number; withDetail: number; withFeedback: number } {
  return {
    withScreen: rows.filter(r => r.screen_evidence || r.contact_evidence).length,
    withDetail: rows.filter(r => r.reading_depth === 'detail').length,
    withFeedback: rows.filter(r => r.feedback).length,
  };
}

/** 证据时间跨度（天）——太集中说明可能是单一时间窗/单一面试官口味 */
function spanDays(rows: OutcomeRow[]): number {
  const ts = rows.map(r => new Date(r.created_at).getTime()).filter(n => !Number.isNaN(n));
  if (ts.length < 2) return 0;
  return (Math.max(...ts) - Math.min(...ts)) / 86_400_000;
}

const RECALIBRATE_SYSTEM = `
你是 Seeya 的"合适"定义校准官。下面给你：现行的候选人评估 rubric 全文，外加
一批**既被验证器预测过、又有真实面试结果**的候选人。每个人尽可能带着一份完整卷宗：

- 事实（公司/学校）与验证器当时判的匹配分
- **当初凭什么这么判**：筛选依据、命中的标签、当时标记的风险
- **判断时读到多深**：只看了列表卡片，还是通读了简历详情
- **整份简历的合拍性判断**（若有）：选择逻辑自不自洽、和岗位是不是同一种人
- 真实结果：过面还是挂面
- **面试官评语原文**（若有）——这是信息量最大的一项，面试官说的"为什么"往往
  直接点破 rubric 漏看了什么

你的任务：用真实结果反推 rubric 哪里错了，产出**修订版 rubric**。重点盯**误判**：
- 判合适(分≥60)却挂面 → rubric 把不该要的当合适了，要补"排除/降权"规则
- 判不合适(分<60)却过面 → rubric 漏了真正能过的人，要补"别误杀"的规则

**要学到信号层面，不要停在标签层面。** 你现在能看到每个人当初用的判断依据，所以
该回答的是：*哪些依据真的预测了结果，哪些一直是噪音*。比如"命中'大厂背景'标签的人
挂了 4 个、过了 1 个，而写明有端到端交付经历的 3 个人全过了"——这才是可落进 rubric 的
结论。只说"某公司的人挂了"是把相关当因果。若面试官评语反复指向同一个 rubric 没写的
维度，那是最强的改写依据。

原则：
- **只基于这批数据里看得出的模式改**，看不出就别编（宁可少改）。一两个个例不算模式。
- 改的是判断框架（哪些信号该加权/降权/不再一票否决），不是堆砌正确的废话
- 保留 rubric 原有结构与风格，做**增量修订**而非推倒重来
- 如果数据还看不出清晰模式，proposals 留空，diagnosis 说明为什么

**关键的统计陷阱，务必警惕：**
- **别信"判合适的人过面率高"这种总体数字**——判合适的人本来就拿到更走心的触达、被更用力地推进面试，过面率高一半是"被重视"造成的，不是 rubric 准。把它当成 rubric 正确的证据，就是自证。
- **真正干净、可学的信号是误判**：判合适却挂面（拿了全力推还是挂）、判不合适却过面（没怎么被推还是过了）——这两类几乎不受"推进力度"干扰，是最可信的纠偏依据。**优先从误判里学，而不是从总体过面率里学。**
- **注意"读得深浅"这个混淆变量**：只看了列表卡片就下的判断，本来就比通读简历后的判断更可能错。如果误判集中在"仅看卡片"那批人身上，正确结论是"这些人当初看得太浅"，**不是** rubric 的标准错了——这种情况要在 diagnosis 里说清楚，不要顺手去改 rubric。
- 这批样本只来自当前这一个岗位；面试官维度（如果给了）往往只覆盖少数几个人。别把可能是"某个面试官口味/某岗位特例"的东西，写成对所有人普适的硬规则。

只输出 JSON：
{
  "diagnosis": ["每条都要有数据支撑，如'判合适却挂面的3人都来自X背景，rubric未对此降权'"],
  "rewrite": true/false,
  "newContent": "修订后的 candidate-evaluation.md 完整全文（rewrite=true 时必填，≥200字）",
  "reason": "一句话说清这次依据什么数据改了什么"
}
`.trim();

function extractJSON(text: string): any | null {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1];
  if (!m) return null;
  try { return JSON.parse(m.trim()); } catch { return null; }
}

/**
 * 跑一轮"合适"定义重校。返回 Retrospective（复用 applyProposals 落盘）。
 * 样本不足或模型判无需改 → proposals 为空（不改写）。
 */
export async function recalibrateFromOutcomes(): Promise<Retrospective> {
  const jobId = createRuntimeContext().activeJobId;
  const rows = gatherOutcomeEvidence(jobId);

  if (rows.length < MIN_MATCHED) {
    return {
      diagnosis: [`样本不足：仅 ${rows.length} 人"既被预测又有面试结果"（需 ≥${MIN_MATCHED}）——无数据支撑不改写"合适"的定义。先攒几条过面/挂面结果回流。`],
      proposals: [],
      evidence: `matched=${rows.length}`,
    };
  }

  const cal = calibrationReport(jobId);
  const fp = rows.filter(r => r.predicted_fit >= FIT_THRESHOLD && r.result === 'failed'); // 假阳性
  const fn = rows.filter(r => r.predicted_fit < FIT_THRESHOLD && r.result === 'passed');  // 假阴性
  const misjudged = fp.length + fn.length;
  const span = spanDays(rows);

  // 误判太少 → 验证器在这批上判得基本对，没有可学的"错"，不改（避免无错强改）
  if (misjudged < MIN_MISJUDGED) {
    return {
      diagnosis: [`验证器在这 ${rows.length} 人上仅 ${misjudged} 处误判（需 ≥${MIN_MISJUDGED} 才值得重写）——判断已基本校准，本轮不改 rubric。`],
      proposals: [],
      evidence: `matched=${rows.length}, misjudged=${misjudged}`,
    };
  }
  // 样本时间太集中 → 可能是单一时间窗/单一面试官口味，不足以提炼"普适"规律（数据无面试官字段，只能用时间跨度兜底）
  if (span < MIN_SPAN_DAYS) {
    return {
      diagnosis: [`证据时间跨度仅 ${span.toFixed(1)} 天（需 ≥${MIN_SPAN_DAYS} 天）——样本太集中，可能只反映某一阵子/某面试官的口味，不足以改写全局"合适"定义。先让结果在更长时间里积累。`],
      proposals: [],
      evidence: `matched=${rows.length}, spanDays=${span.toFixed(1)}`,
    };
  }

  const fmt = formatOutcomeRow;
  const coverage = signalCoverage(rows);
  const interviewers = new Set(rows.map(r => r.interviewer).filter(Boolean));
  const evidence = [
    `校准（注意：总体过面率可能被"推进力度"污染，仅供参考，不作为改写依据）：${cal.summary}`,
    [
      `样本时间跨度 ${span.toFixed(1)} 天，共 ${rows.length} 人（均来自岗位「${jobId}」）`,
      `其中 ${coverage.withScreen} 人带回了当初的筛选依据，${coverage.withDetail} 人是通读简历详情后判的，${coverage.withFeedback} 人有面试官评语`,
      interviewers.size > 0 ? `覆盖 ${interviewers.size} 位面试官` : '无面试官维度',
    ].join('；'),
    `★ 纠偏主依据·误判 ${misjudged} 人 ★`,
    `判合适却挂面（假阳性）${fp.length} 人：\n${fp.map(fmt).join('\n\n') || '（无）'}`,
    `判不合适却过面（假阴性）${fn.length} 人：\n${fn.map(fmt).join('\n\n') || '（无）'}`,
    `全部样本 ${rows.length} 人（背景参考）：\n${rows.map(fmt).join('\n\n')}`,
  ].join('\n\n');

  const currentRubric = loadWorkspaceFile(EVOLVABLE_FILES['candidate-evaluation']);

  // 重校官：尽量异构于 verifier（避免"同一个脑子分析自己的预测、改自己的标准"）
  const client = new OpenAI({ apiKey: config.recalibrator.apiKey, baseURL: config.recalibrator.baseUrl });
  const res = await client.chat.completions.create({
    model: config.recalibrator.model,
    messages: [
      { role: 'system', content: RECALIBRATE_SYSTEM },
      { role: 'user', content: `## 数据证据\n\n${evidence}\n\n---\n\n## 现行 rubric 全文\n\n${currentRubric}\n\n请反推并输出 JSON。` },
    ],
    max_tokens: 8000,
    temperature: 0.2,
  });

  const parsed = extractJSON(res.choices[0]?.message?.content ?? '');
  if (!parsed || !Array.isArray(parsed.diagnosis)) {
    throw new Error(`重校输出无法解析：${(res.choices[0]?.message?.content ?? '').slice(0, 200)}`);
  }

  const diagnosis: string[] = parsed.diagnosis.map(String);
  const proposals: EvolutionProposal[] = [];
  if (parsed.rewrite === true && typeof parsed.newContent === 'string' && parsed.newContent.length > 200) {
    proposals.push({
      file: 'candidate-evaluation',
      reason: `[校准学习] ${String(parsed.reason ?? '基于真实过面结果重校').slice(0, 200)}`,
      newContent: parsed.newContent,
    });
  } else {
    diagnosis.push('模型判定：当前数据看不出需要改写的清晰模式，本轮不改 rubric。');
  }

  return { diagnosis, proposals, evidence };
}
