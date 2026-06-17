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
import { loadActiveJob, loadWorkspaceFile } from '../skills/loader';
import { calibrationReport } from '../feedback';
import { EVOLVABLE_FILES, type Retrospective, type EvolutionProposal } from './retrospect';

/** 启动重校所需的最小"既预测又有结果"样本量——低于此不改写 */
const MIN_MATCHED = 8;
/** 至少要有这么多**误判**（假阳+假阴）才值得重写——没有误判就没有可学的东西 */
const MIN_MISJUDGED = 3;
/** 证据样本至少要跨这么多天，避免把"某一两天某面试官的口味"当成普适规律 */
const MIN_SPAN_DAYS = 3;
const FIT_THRESHOLD = 60;

interface OutcomeRow {
  name: string;
  company: string | null;
  school: string | null;
  predicted_fit: number;
  result: 'passed' | 'failed';
  created_at: string;
}

function gatherOutcomeEvidence(jobId: string): OutcomeRow[] {
  return db.prepare(`
    SELECT c.name, c.company, c.school, p.predicted_fit, o.result, o.created_at
    FROM interview_outcomes o
    JOIN fit_predictions p ON p.fingerprint = o.fingerprint AND p.job_id = o.job_id
    JOIN candidates c       ON c.fingerprint = o.fingerprint AND c.job_id = o.job_id
    WHERE o.job_id = ? AND o.fingerprint IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT 60
  `).all(jobId) as OutcomeRow[];
}

/** 证据时间跨度（天）——太集中说明可能是单一时间窗/单一面试官口味 */
function spanDays(rows: OutcomeRow[]): number {
  const ts = rows.map(r => new Date(r.created_at).getTime()).filter(n => !Number.isNaN(n));
  if (ts.length < 2) return 0;
  return (Math.max(...ts) - Math.min(...ts)) / 86_400_000;
}

const RECALIBRATE_SYSTEM = `
你是 HireSeek 的"合适"定义校准官。下面给你：现行的候选人评估 rubric 全文，外加
一批**既被验证器预测过、又有真实面试结果**的候选人——每个人都有：事实（公司/学校）、
验证器当时判的匹配分、以及真实是过面还是挂面。

你的任务：用真实结果反推 rubric 哪里错了，产出**修订版 rubric**。重点盯**误判**：
- 判合适(分≥60)却挂面 → rubric 把不该要的当合适了，要补"排除/降权"规则
- 判不合适(分<60)却过面 → rubric 漏了真正能过的人，要补"别误杀"的规则

原则：
- **只基于这批数据里看得出的模式改**，看不出就别编（宁可少改）。一两个个例不算模式。
- 改的是判断框架（哪些信号该加权/降权/不再一票否决），不是堆砌正确的废话
- 保留 rubric 原有结构与风格，做**增量修订**而非推倒重来
- 如果数据还看不出清晰模式，proposals 留空，diagnosis 说明为什么

**关键的统计陷阱，务必警惕：**
- **别信"判合适的人过面率高"这种总体数字**——判合适的人本来就拿到更走心的触达、被更用力地推进面试，过面率高一半是"被重视"造成的，不是 rubric 准。把它当成 rubric 正确的证据，就是自证。
- **真正干净、可学的信号是误判**：判合适却挂面（拿了全力推还是挂）、判不合适却过面（没怎么被推还是过了）——这两类几乎不受"推进力度"干扰，是最可信的纠偏依据。**优先从误判里学，而不是从总体过面率里学。**
- 这批样本只来自当前这一个岗位、且无法区分面试官；别把可能是"某个面试官口味/某岗位特例"的东西，写成对所有人普适的硬规则。

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
  const job = loadActiveJob();
  const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';
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

  const fmt = (r: OutcomeRow) =>
    `${r.name}｜${r.company || '公司未知'}｜${r.school || '学校未知'}｜判分${r.predicted_fit}｜实际${r.result === 'passed' ? '过面✅' : '挂面❌'}`;
  const evidence = [
    `校准（注意：总体过面率可能被"推进力度"污染，仅供参考，不作为改写依据）：${cal.summary}`,
    `样本时间跨度 ${span.toFixed(1)} 天，共 ${rows.length} 人（均来自岗位「${jobId}」，无面试官维度）`,
    `★ 纠偏主依据·误判 ${misjudged} 人 ★`,
    `判合适却挂面（假阳性）${fp.length} 人：\n${fp.map(fmt).join('\n') || '（无）'}`,
    `判不合适却过面（假阴性）${fn.length} 人：\n${fn.map(fmt).join('\n') || '（无）'}`,
    `全部样本 ${rows.length} 人（背景参考）：\n${rows.map(fmt).join('\n')}`,
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
