/**
 * 流程合规验证器 —— 第二道验证轴：不只验"找的人对不对"，还验"它干活的方法对不对"
 *
 * 结果验证器（verifier.ts）看的是产出：候选人合不合适、有没有为凑数注水。
 * 但一个会钻空子的 agent，作弊往往发生在过程里——不用平台筛选项就瞎翻、筛选条件
 * 跟岗位硬性要求对不上、为偷懒乱开计划外的网页。这些是"软规则"，代码硬门卡不住，
 * 只有一个会读执行轨迹的智能体才判得出。
 *
 *   执行轨迹（run_actions）+ 过程规则集 + 岗位画像 → v4-pro 独立审计 → 违规清单
 *
 * 规则来源两层：默认规则（本文件，覆盖通用 SOP 与 Harness 护栏）+ 可选的
 * workspace/references/process-rules.md（用户按渠道补充/覆盖，无需改代码）。
 *
 * 这是把 Loop Engineering 里 "Harness（护栏）" 这一层，交给一个验证器去事后核查
 * 有没有被真正遵守——做的和验的分开，连"怎么做"也分开验。
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { config } from './config';
import { db } from './db';
import { loadActiveJob, jobToPrompt } from './skills/loader';
import type { TraceStep, Channel } from './types';
import type { Verdict } from './verifier';
import { getPlatformProtocol } from './platform-protocols';
import { contractNameForChannel, contractWritesForChannel } from './contracts';

// ── 轨迹与合规留痕表 ───────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS run_actions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  INTEGER NOT NULL,
    job_id  TEXT NOT NULL,
    channel TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    action  TEXT NOT NULL,
    target  TEXT,
    detail  TEXT,
    ok      INTEGER NOT NULL DEFAULT 1,
    at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_run_actions_run ON run_actions(run_id);

  CREATE TABLE IF NOT EXISTS compliance_checks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER,
    job_id          TEXT NOT NULL,
    channel         TEXT NOT NULL,
    steps           INTEGER NOT NULL,
    verdict         TEXT NOT NULL,
    violation_count INTEGER NOT NULL DEFAULT 0,
    detail          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// ── orchestrator 调用：把一轮执行轨迹落库 ──────────────────────────────
export function saveRunTrace(runId: number, jobId: string, channel: string, trace: TraceStep[]): void {
  if (!trace.length) return;
  const ins = db.prepare(`
    INSERT INTO run_actions (run_id, job_id, channel, seq, action, target, detail, ok)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((steps: TraceStep[]) => {
    for (const s of steps) {
      ins.run(runId, jobId, channel, s.seq, s.action, s.target ?? null, s.detail ?? null, s.ok ? 1 : 0);
    }
  });
  tx(trace);
}

function loadTrace(runId: number): TraceStep[] {
  return (db.prepare(
    `SELECT seq, action, target, detail, ok FROM run_actions WHERE run_id = ? ORDER BY seq`,
  ).all(runId) as Array<{ seq: number; action: string; target: string | null; detail: string | null; ok: number }>)
    .map(r => ({ seq: r.seq, action: r.action, target: r.target ?? undefined, detail: r.detail ?? undefined, ok: !!r.ok }));
}

/** 最近一次有轨迹的 run。无 runId 时用它兜底。 */
function latestRunWithTrace(): number | null {
  const r = db.prepare(`SELECT run_id FROM run_actions ORDER BY id DESC LIMIT 1`).get() as { run_id: number } | undefined;
  return r?.run_id ?? null;
}

// ── 过程规则集：默认规则 + 可选 workspace 覆盖 ──────────────────────────
const DEFAULT_RULES = `
通用过程规则（所有渠道）：
1. 必须先用平台的筛选项收窄人群，再逐个看人——直接翻列表、不设条件就开始联系，是低效且不合规的（轨迹里应能看到对筛选控件的 click/type，且发生在大量"看人/打招呼"动作之前）。
2. 筛选条件必须对应岗位硬性要求（must_have / deal_breaker）——比如岗位要"3-5年经验、供应链SaaS背景"，筛选项就该体现经验区间与行业/职能，而不是只按城市草草一筛。
3. 不打开计划外的新网页：除登录态所需，goto 只应停留在该渠道域内的搜索/沟通页；轨迹里若出现跳去无关站点（搜索引擎、社交媒体、其他招聘站）的 goto，需要解释。
4. 节奏合规：打招呼/发起沟通之间应有合理间隔（≥5秒），不应连续高频点击"打招呼"。
5. 触达前应真正看过候选人详情（轨迹里"打招呼"动作前应有对应的查看/快照），而不是列表页无差别群发。
`.trim();

function loadProcessRules(channel?: Channel): string {
  const parts = [DEFAULT_RULES];
  const protocol = channel ? getPlatformProtocol(channel) : null;
  if (protocol?.processRules) {
    parts.push(protocol.processRules());
  }
  try {
    const p = path.join(config.workspace.dir, 'references', 'process-rules.md');
    if (fs.existsSync(p)) {
      const extra = fs.readFileSync(p, 'utf-8').trim();
      if (extra) parts.push(`补充/覆盖规则（来自 process-rules.md）：\n${extra}`);
    }
  } catch { /* 读取失败用默认 */ }
  return parts.join('\n\n');
}

export interface Violation {
  rule: string;           // 违反了哪条（简述）
  severity: 'low' | 'medium' | 'high';
  evidence: string;       // 轨迹中的依据（第几步做了什么）
}

export interface ComplianceResult {
  verdict: Verdict;
  runId: number | null;
  steps: number;
  violations: Violation[];
  summary: string;
}

const COMPLIANCE_SYSTEM = `
你是 HireSeek 的**流程合规审计官**。寻源 agent 已经跑完一轮，下面是它这一轮的
完整浏览器执行轨迹。你不评判它找的人好不好（那是另一个验证器的事），你只审
**它干活的方法合不合规**——对照下面的过程规则，逐条检查轨迹有没有违反。

判断要拿轨迹当证据，不要臆测：
- 指出违规时，必须引用具体是第几步、做了什么动作作为 evidence
- 轨迹信息不足以判断某条规则时，不要硬扣帽子，跳过即可
- severity：high=明显违背护栏或会导致风控/无效触达（如完全没用筛选项、乱开无关网页、连续高频打招呼）；medium=方法明显次优；low=轻微
- 没有违规就返回空数组，别为凑数硬找

只输出 JSON：
{"violations":[{"rule":"一句话","severity":"high|medium|low","evidence":"第N步…"}]}
`.trim();

function summarizeTrace(trace: TraceStep[]): string {
  // 给模型一个紧凑但完整的轨迹视图
  const counts: Record<string, number> = {};
  trace.forEach(s => { counts[s.action] = (counts[s.action] ?? 0) + 1; });
  const tally = Object.entries(counts).map(([a, n]) => `${a}×${n}`).join('、');
  const steps = trace.map(s =>
    `${s.seq}. ${s.action}${s.target ? ` ${s.target}` : ''}${s.detail ? ` 「${s.detail}」` : ''}${s.ok ? '' : ' [失败]'}`,
  ).join('\n');
  return `动作统计：${tally}\n\n逐步轨迹：\n${steps}`;
}

// ── 主入口：审计一轮执行流程 ───────────────────────────────────────────
export async function complianceCheck(opts: { runId?: number } = {}): Promise<ComplianceResult> {
  const runId = opts.runId ?? latestRunWithTrace();
  const trace = runId != null ? loadTrace(runId) : [];

  if (runId == null) {
    return { verdict: 'skip', runId, steps: 0, violations: [], summary: '没有可审计的执行轨迹（这一轮可能没产生浏览器动作，或用的是非 DOM runner）。' };
  }

  const job = loadActiveJob();
  const runRow = db.prepare(`SELECT job_id, channel, mode FROM task_runs WHERE id = ?`).get(runId) as { job_id: string; channel: string; mode?: string } | undefined;
  const channelRow = db.prepare(`SELECT channel FROM run_actions WHERE run_id = ? LIMIT 1`).get(runId) as { channel: string } | undefined;
  const channel = (runRow?.channel ?? channelRow?.channel ?? 'boss') as Channel;
  const runMode = runRow?.mode === 'dry_run' ? 'dry_run' : 'execute';
  const jobId = runRow?.job_id ?? (job ? job.title.replace(/\s+/g, '_') : 'default');

  // 契约履约检查（manifest 即清单）：boss-greeting.v1 声明 writes 了哪些产物，
  // 就机械核对本轮 run 是否真写了。少写 = 结构性违规（high），不靠 LLM 判。
  const contractViolations: Violation[] = [];
  try {
    const contractName = contractNameForChannel(channel);
    const promised = runMode === 'dry_run' ? [] : contractWritesForChannel(channel);
    const wrote: Record<string, number> = {
      contacted_candidates: (db.prepare(`SELECT COUNT(*) n FROM run_candidates WHERE run_id = ?`).get(runId) as { n: number }).n,
      run_trace: trace.length,
      interaction_log: (db.prepare(`SELECT COUNT(*) n FROM interaction_log WHERE run_id = ?`).get(runId) as { n: number }).n,
    };
    for (const w of promised) {
      if ((wrote[w] ?? 0) === 0) {
        contractViolations.push({
          rule: `契约 ${contractName ?? 'unknown'} 声明会写 ${w}，但本轮 run 没写`,
          severity: 'high',
          evidence: `run #${runId} 的 ${w} 计数为 0`,
        });
      }
    }
    if (runMode !== 'dry_run') {
      const incompleteOutreach = (db.prepare(`
        SELECT COUNT(*) n FROM run_candidates
        WHERE run_id = ?
          AND (
            COALESCE(TRIM(evidence), '') = ''
            OR COALESCE(TRIM(personalization_evidence), '') = ''
            OR COALESCE(TRIM(message_intent), '') = ''
            OR COALESCE(TRIM(greeting_text), '') = ''
          )
      `).get(runId) as { n: number }).n;
      if (incompleteOutreach > 0) {
        contractViolations.push({
          rule: `触达输出协议 outreach-output.v1 缺少可审计字段`,
          severity: 'high',
          evidence: `run #${runId} 有 ${incompleteOutreach} 条 contacted_candidates 缺 evidence/personalization_evidence/message_intent/greeting_text`,
        });
      }
    }
  } catch { /* 契约不可用则跳过履约检查 */ }

  if (trace.length === 0) {
    if (contractViolations.length > 0) {
      const verdict: Verdict = contractViolations.some(v => v.severity === 'high') ? 'fail' : 'warn';
      const summary = buildSummary(verdict, contractViolations, 0);
      db.prepare(`
        INSERT INTO compliance_checks (run_id, job_id, channel, steps, verdict, violation_count, detail)
        VALUES (?, ?, ?, 0, ?, ?, ?)
      `).run(runId, jobId, channel, verdict, contractViolations.length, JSON.stringify({ summary, violations: contractViolations }).slice(0, 4000));
      return { verdict, runId, steps: 0, violations: contractViolations, summary };
    }
    return { verdict: 'skip', runId, steps: 0, violations: [], summary: '没有可审计的执行轨迹（这一轮可能没产生浏览器动作，或用的是非 DOM runner）。' };
  }

  const userPrompt = [
    `## 岗位画像\n\n${job ? jobToPrompt(job) : '（岗位画像缺失）'}`,
    `## 过程规则\n\n${loadProcessRules(channel)}`,
    `## 本轮执行轨迹（渠道：${channel}，共 ${trace.length} 步）\n\n${summarizeTrace(trace)}`,
    '请对照过程规则审计这条轨迹，输出 JSON。',
  ].join('\n\n');

  const client = new OpenAI({ apiKey: config.verifier.apiKey, baseURL: config.verifier.baseUrl });
  const res = await client.chat.completions.create({
    model: config.verifier.model,   // 验证器专用模型（可配异构厂商）
    messages: [
      { role: 'system', content: COMPLIANCE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1600,
    temperature: 0.1,
  });

  const raw = res.choices[0]?.message?.content ?? '';
  const finishReason = res.choices[0]?.finish_reason;
  const parsed = parseViolations(raw);

  // 解析失败/被截断 ≠ 合规：不能把"读不懂模型回答"静默判成 pass（假绿灯）。
  // 但契约履约是代码判定的，即便 LLM 审计没解析出来，结构性违规仍要照报。
  if (parsed === null || finishReason === 'length') {
    const why = finishReason === 'length' ? '模型输出被截断' : '输出无法解析';
    const verdict: Verdict = contractViolations.some(v => v.severity === 'high') ? 'fail' : 'skip';
    const summary = contractViolations.length
      ? buildSummary(verdict, contractViolations, trace.length) + `\n（过程合规部分未完成：${why}，请重跑）`
      : `🟡 流程合规：本轮审计未完成（${why}），未下结论——请重跑一次质检。`;
    db.prepare(`
      INSERT INTO compliance_checks (run_id, job_id, channel, steps, verdict, violation_count, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, jobId, channel, trace.length, verdict, contractViolations.length, JSON.stringify({ summary, violations: contractViolations }).slice(0, 4000));
    return { verdict, runId, steps: trace.length, violations: contractViolations, summary };
  }

  // 合并：契约履约（结构性，代码判）+ 过程合规（软规则，LLM 判）
  const violations = [...contractViolations, ...parsed];
  const high = violations.filter(v => v.severity === 'high').length;
  const verdict: Verdict = high > 0 ? 'fail' : violations.length > 0 ? 'warn' : 'pass';
  const summary = buildSummary(verdict, violations, trace.length);

  db.prepare(`
    INSERT INTO compliance_checks (run_id, job_id, channel, steps, verdict, violation_count, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, jobId, channel, trace.length, verdict, violations.length,
    JSON.stringify({ summary, violations }).slice(0, 4000));

  return { verdict, runId, steps: trace.length, violations, summary };
}

/** 返回 null = 无法解析（不可信，调用方应判 skip）；返回数组 = 解析成功（可能为空=真无违规） */
function parseViolations(text: string): Violation[] | null {
  // 优先围栏块；兜底取**最后**一个 JSON 对象（模型可能先吐思考对象再吐答案）
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const lastObj = text.match(/\{[^{}]*"violations"[\s\S]*\}\s*$/);
  const m = fenced ?? lastObj ?? text.match(/(\{[\s\S]*\})/);
  if (!m) return null;
  try {
    const obj = JSON.parse((m[1] ?? m[0]).trim()) as { violations?: Array<{ rule?: string; severity?: string; evidence?: string }> };
    if (!Array.isArray(obj.violations)) return null;
    return obj.violations.map(v => ({
      rule: String(v.rule ?? '').slice(0, 100),
      severity: (['low', 'medium', 'high'].includes(String(v.severity)) ? v.severity : 'medium') as Violation['severity'],
      evidence: String(v.evidence ?? '').slice(0, 160),
    })).filter(v => v.rule);
  } catch {
    return null;
  }
}

function buildSummary(verdict: Verdict, violations: Violation[], steps: number): string {
  if (verdict === 'pass') return `🟢 流程合规：${steps} 步执行轨迹，未发现违规。`;
  const head = verdict === 'fail' ? '🔴 流程违规' : '🟡 流程有隐患';
  const top = violations.slice(0, 4).map(v => {
    const icon = v.severity === 'high' ? '⛔' : v.severity === 'medium' ? '⚠️' : '·';
    return `${icon} ${v.rule}（依据：${v.evidence}）`;
  }).join('\n');
  return `${head}：${steps} 步轨迹里发现 ${violations.length} 处问题\n${top}`;
}

/** 人话报告（CLI / 通知共用）。 */
export function formatCompliance(c: ComplianceResult): string {
  if (c.verdict === 'skip') return c.summary;
  return `🧭 HireSeek 流程合规审计（run #${c.runId}）\n\n${c.summary}`;
}

/** 最近一次合规结论（供生命体征展示）。 */
export function lastCompliance(): { verdict: string; violations: number; at: string } | null {
  try {
    const r = db.prepare(
      `SELECT verdict, violation_count, created_at FROM compliance_checks ORDER BY id DESC LIMIT 1`,
    ).get() as { verdict: string; violation_count: number; created_at: string } | undefined;
    return r ? { verdict: r.verdict, violations: r.violation_count, at: r.created_at.slice(5, 16) } : null;
  } catch {
    return null;
  }
}
