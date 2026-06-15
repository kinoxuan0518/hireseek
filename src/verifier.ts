/**
 * 独立验证器 —— Loop Engineering 的"灵魂"：做的和验的分开
 *
 * HireSeek 的 loop 目标写死在守护栏里是一句话："今日触达 >= 30 就达标"。
 * 这是教科书级的 Goodhart 地雷：一旦"触达数"变成目标本身，一个一根筋优化它
 * 的 agent 完全可以为了凑满 30，去触达一批根本不匹配的人——数字是绿的，但你
 * 真正要的"对的人"一个没有。更糟的是，做触达的 agent 同时也是给自己记成功的
 * 那个（"学生自己批自己的考卷"），它一定对自己太宽容。
 *
 * 这里加的，是一双独立的、对抗性的眼睛：
 *   · 换一个更强、且不同的脑子（deepseek-v4-pro，而非执行用的 v4-flash）
 *   · 只拿到岗位真实画像 + 候选人事实，不被 do-er 的自评分锚定——先独立重判，
 *     再回头跟 do-er 的分数对比，专门抓"自评虚高"
 *   · 代码层再叠两条 Goodhart 启发式（凑满目标却低匹配、自评显著虚高）
 *
 * 它不改 do-er 任何判断，只在每轮触达后审计，异常就主动报给你。
 */

import OpenAI from 'openai';
import { config } from './config';
import { db } from './db';
import { loadActiveJob, jobToPrompt } from './skills/loader';

// ── 质检留痕表 ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS verifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id        TEXT NOT NULL,
    scope         TEXT NOT NULL,
    sampled       INTEGER NOT NULL,
    avg_fit       REAL,
    low_fit_count INTEGER,
    gaming        INTEGER NOT NULL DEFAULT 0,
    verdict       TEXT NOT NULL,
    detail        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

const FIT_THRESHOLD = 60;        // 低于此分视为"低匹配"
const OVER_GENEROUS_GAP = 25;    // do-er 自评 - 验证器重判 ≥ 此值 → 自评虚高
const DEFAULT_SAMPLE = 8;        // 单次抽检上限（控成本）

export type Verdict = 'pass' | 'warn' | 'fail' | 'skip';

export interface SampleJudgment {
  name: string;
  doerScore: number | null;
  fit: number;
  reason: string;
  padding: boolean;   // 验证器判断：这像不像为凑数触达的低匹配候选人
}

export interface VerificationResult {
  verdict: Verdict;
  scope: string;
  sampled: number;
  avgFit: number | null;
  lowFitCount: number;
  overGenerousCount: number;
  gaming: boolean;
  summary: string;
  judgments: SampleJudgment[];
}

interface CandRow {
  name: string; school: string | null; company: string | null;
  channel: string; score: number | null; contacted_at: string;
}

// ── 取本次要审计的候选人（今日已触达、随机抽样）─────────────────────────
function pickCandidates(jobId: string, limit: number): CandRow[] {
  return db.prepare(`
    SELECT name, school, company, channel, score, contacted_at
    FROM candidates
    WHERE job_id = ? AND date(contacted_at) = date('now','localtime')
    ORDER BY RANDOM() LIMIT ?
  `).all(jobId, limit) as CandRow[];
}

const VERIFIER_SYSTEM = `
你是 HireSeek 的**独立质检官**，不是寻源 agent。寻源 agent 已经联系了下面这些
候选人，并给了自己打的分。你的职责是换一双对抗性的眼睛，**独立**判断每个人跟
岗位的真实匹配度，专门抓两件事：

1. 为了凑满"今日触达数"而联系的低匹配候选人（padding）——这是你要揪出的头号问题
2. 寻源 agent 给自己打的分是否虚高

判断原则：
- 只看岗位画像与候选人事实，**不要被寻源 agent 的自评分带跑**，先自己重判
- 一票否决项命中 → fit 直接打很低
- 信息不足以判断时，宁可保守给中间分，并在 reason 里说明缺什么
- reason 用招聘语言，一句话，具体（说"硬性要求的供应链SaaS背景看不出来"，不说"匹配度一般"）

只输出 JSON 数组，每个候选人一项，顺序与输入一致：
[{"name":"...","fit":0-100,"reason":"一句话","padding":true/false}]
`.trim();

function buildUserPrompt(job: ReturnType<typeof loadActiveJob>, cands: CandRow[]): string {
  const profile = job ? jobToPrompt(job) : '（岗位画像缺失）';
  const list = cands.map((c, i) =>
    `${i + 1}. ${c.name}｜公司：${c.company || '未知'}｜学校：${c.school || '未知'}｜渠道：${c.channel}｜寻源agent自评：${c.score ?? '未打分'}`,
  ).join('\n');
  return `## 岗位画像\n\n${profile}\n\n## 待质检的已触达候选人（${cands.length} 人）\n\n${list}\n\n请逐一独立重判，输出 JSON 数组。`;
}

function parseJudgments(text: string, cands: CandRow[]): SampleJudgment[] {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ?? text.match(/(\[[\s\S]*\])/);
  if (!m) throw new Error(`质检输出无法解析：${text.slice(0, 200)}`);
  const arr = JSON.parse(m[1].trim()) as Array<{ name?: string; fit?: number; reason?: string; padding?: boolean }>;
  return cands.map((c, i) => {
    const j = arr[i] ?? {};
    const fit = Math.max(0, Math.min(100, Math.round(Number(j.fit ?? 0))));
    return {
      name: c.name,
      doerScore: c.score,
      fit,
      reason: String(j.reason ?? '').slice(0, 120),
      padding: Boolean(j.padding),
    };
  });
}

// ── 主入口：审计一轮触达 ───────────────────────────────────────────────
export async function verifyRun(opts: { sampleSize?: number } = {}): Promise<VerificationResult> {
  const job = loadActiveJob();
  const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';
  const cands = pickCandidates(jobId, opts.sampleSize ?? DEFAULT_SAMPLE);

  if (cands.length === 0) {
    return {
      verdict: 'skip', scope: 'today', sampled: 0, avgFit: null,
      lowFitCount: 0, overGenerousCount: 0, gaming: false,
      summary: '今天还没有已触达的候选人，无可质检。', judgments: [],
    };
  }

  // 换一个更强、且不同于执行用 flash 的脑子来做对抗性重判
  const client = new OpenAI({ apiKey: config.deepseek.apiKey, baseURL: config.deepseek.baseUrl });
  const res = await client.chat.completions.create({
    model: config.deepseek.reasonerModel,
    messages: [
      { role: 'system', content: VERIFIER_SYSTEM },
      { role: 'user', content: buildUserPrompt(job, cands) },
    ],
    max_tokens: 2000,
    temperature: 0.1,
  });

  const judgments = parseJudgments(res.choices[0]?.message?.content ?? '', cands);

  // ── 聚合 + 代码层 Goodhart 启发式 ────────────────────────────────────
  const avgFit = Math.round(judgments.reduce((s, j) => s + j.fit, 0) / judgments.length);
  const lowFitCount = judgments.filter(j => j.fit < FIT_THRESHOLD).length;
  const lowFitRate = lowFitCount / judgments.length;
  const overGenerousCount = judgments.filter(
    j => j.doerScore != null && j.doerScore - j.fit >= OVER_GENEROUS_GAP,
  ).length;
  const verifierPadding = judgments.filter(j => j.padding).length;

  // 凑数信号：今天触达刚好压线达标，且抽检里低匹配占比高
  const goal = job?.daily_goal?.contact ?? 30;
  const todayTotal = (db.prepare(
    `SELECT COUNT(*) AS n FROM candidates WHERE job_id = ? AND date(contacted_at)=date('now','localtime')`,
  ).get(jobId) as { n: number }).n;
  const hitGoal = todayTotal >= goal;
  const paddingSignal = (hitGoal && lowFitRate >= 0.4) || verifierPadding >= Math.ceil(judgments.length / 2);

  const gaming = paddingSignal;
  let verdict: Verdict;
  if (avgFit < 50 || gaming) verdict = 'fail';
  else if (lowFitRate >= 0.3 || overGenerousCount >= 1) verdict = 'warn';
  else verdict = 'pass';

  const summary = buildSummary({ verdict, avgFit, lowFitCount, sampled: judgments.length, overGenerousCount, gaming, todayTotal, goal });

  db.prepare(`
    INSERT INTO verifications (job_id, scope, sampled, avg_fit, low_fit_count, gaming, verdict, detail)
    VALUES (?, 'today', ?, ?, ?, ?, ?, ?)
  `).run(jobId, judgments.length, avgFit, lowFitCount, gaming ? 1 : 0, verdict,
    JSON.stringify({ summary, judgments }).slice(0, 4000));

  return { verdict, scope: 'today', sampled: judgments.length, avgFit, lowFitCount, overGenerousCount, gaming, summary, judgments };
}

function buildSummary(a: {
  verdict: Verdict; avgFit: number; lowFitCount: number; sampled: number;
  overGenerousCount: number; gaming: boolean; todayTotal: number; goal: number;
}): string {
  const head = a.verdict === 'fail' ? '🔴 质检不通过'
    : a.verdict === 'warn' ? '🟡 质检有隐患'
    : '🟢 质检通过';
  const parts = [`${head}：抽检 ${a.sampled} 人，平均匹配 ${a.avgFit} 分，低匹配 ${a.lowFitCount} 人`];
  if (a.gaming) parts.push(`⚠️ 疑似为凑数注水（今日触达 ${a.todayTotal}/${a.goal}，低匹配集中）——这正是把"触达数"当目标的副作用，建议宁缺毋滥`);
  if (a.overGenerousCount > 0) parts.push(`寻源 agent 有 ${a.overGenerousCount} 人自评明显虚高`);
  return parts.join('；');
}

/** 人话报告（CLI / 通知 / 生命体征共用）。 */
export function formatVerification(v: VerificationResult): string {
  if (v.verdict === 'skip') return v.summary;
  const lines = ['🔍 HireSeek 触达质检', '', v.summary];
  const flagged = v.judgments.filter(j => j.fit < FIT_THRESHOLD || j.padding);
  if (flagged.length) {
    lines.push('', '需要你看一眼的：');
    flagged.slice(0, 6).forEach(j =>
      lines.push(`· ${j.name}（匹配 ${j.fit}${j.doerScore != null ? `／自评 ${j.doerScore}` : ''}）：${j.reason}`),
    );
  }
  return lines.join('\n');
}

/** 最近一次质检（供生命体征展示）。 */
export function lastVerification(): { verdict: string; avgFit: number | null; at: string } | null {
  try {
    const r = db.prepare(
      `SELECT verdict, avg_fit, created_at FROM verifications ORDER BY id DESC LIMIT 1`,
    ).get() as { verdict: string; avg_fit: number | null; created_at: string } | undefined;
    return r ? { verdict: r.verdict, avgFit: r.avg_fit, at: r.created_at.slice(5, 16) } : null;
  } catch {
    return null;
  }
}
