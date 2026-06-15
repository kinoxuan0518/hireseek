/**
 * 心跳主动决策循环 —— daemon 哲学的 HireSeek 移植
 * （参考 github.com/kinoxuan0518/daemon：主动性 + 自进化）
 *
 * 不等指令：心跳醒来 → 读 STATE.md + 实时数据信号 → 模型决策
 * "当下最有价值的一件事" → 守护栏内执行 → 更新 STATE → 留痕。
 * 空闲不是休息，空闲是明确判断"现在没有值得做的事"并说出为什么。
 *
 * 主动但不越权（代码层守护栏，不依赖模型自觉）：
 * - 工作时间窗之外不跑渠道任务
 * - 每日触达配额满了不再寻源
 * - 单日心跳主动行动次数有上限
 * - 改写资产类动作（进化）只允许 dry-run + 通知，落盘必须用户确认
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { config } from './config';
import { db } from './db';
import { loadActiveJob } from './skills/loader';

// ── 守护栏参数 ───────────────────────────────────────────────────────
const WORK_HOUR_START = 9;
const WORK_HOUR_END = 19;
/** 单日心跳最多主动发起的"重动作"（跑渠道/派调研）次数 */
const MAX_ACTIONS_PER_DAY = 6;

const STATE_PATH = path.join(config.workspace.dir, 'STATE.md');

// ── 心跳留痕表 ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS heartbeat_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    reason     TEXT,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── STATE 读写 ───────────────────────────────────────────────────────

export function readState(): string {
  try {
    return fs.readFileSync(STATE_PATH, 'utf-8');
  } catch {
    return '# STATE\n\n（尚未初始化）';
  }
}

function writeState(content: string): void {
  fs.writeFileSync(STATE_PATH, content, 'utf-8');
}

// ── 数据信号收集（原 proactiveCheck 规则并入，作为决策证据） ─────────────

function gatherSignals(): string {
  const job = loadActiveJob();
  const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';
  const signals: string[] = [];
  const hour = new Date().getHours();

  // 今日触达 vs 目标
  const today = db.prepare(
    `SELECT COUNT(*) AS n FROM candidates WHERE date(contacted_at) = date('now', 'localtime')`,
  ).get() as { n: number };
  const goal = job?.daily_goal?.contact ?? 30;
  signals.push(`今日触达 ${today.n}/${goal} 人`);

  // 今天是否跑过任务
  const ranToday = db.prepare(
    `SELECT channel, status FROM task_runs WHERE date(started_at) = date('now', 'localtime')`,
  ).all() as { channel: string; status: string }[];
  signals.push(ranToday.length === 0
    ? '今天还没有跑过任何渠道任务'
    : `今天已跑：${ranToday.map(r => `${r.channel}(${r.status})`).join(', ')}`);

  // 超 7 天未回复的候选人
  const stale = db.prepare(`
    SELECT name, company FROM candidates
    WHERE job_id = ? AND status = 'contacted'
      AND julianday('now') - julianday(contacted_at) >= 7
    ORDER BY contacted_at ASC LIMIT 5
  `).all(jobId) as { name: string; company: string }[];
  if (stale.length > 0) {
    signals.push(`${stale.length} 位候选人联系超 7 天未回复：${stale.map(c => c.name).join('、')}`);
  }

  // 漏斗顶部 3 天断流
  const recent = db.prepare(`
    SELECT COUNT(*) AS n FROM candidates
    WHERE job_id = ? AND contacted_at >= datetime('now', '-3 days')
  `).get(jobId) as { n: number };
  if (recent.n === 0) signals.push('⚠️ 最近 3 天没有新触达，漏斗顶部断流');

  // 人才记忆库规模（积累的人脉资产）
  try {
    const { memoryOps } = require('./db') as typeof import('./db');
    const m = memoryOps.stats();
    signals.push(`人才库累计 ${m.total} 人，其中 ${m.withNotes} 人有沟通笔记`);
  } catch { /* 人才库统计失败忽略 */ }

  // 今日心跳已执行的重动作数
  const acted = db.prepare(`
    SELECT COUNT(*) AS n FROM heartbeat_log
    WHERE date(created_at) = date('now', 'localtime')
      AND action IN ('run_channel', 'spawn_research')
  `).get() as { n: number };
  signals.push(`今日心跳已主动行动 ${acted.n}/${MAX_ACTIONS_PER_DAY} 次`);

  signals.push(`当前时间 ${new Date().toLocaleString('zh-CN')}，工作时间窗 ${WORK_HOUR_START}-${WORK_HOUR_END} 点`);
  return signals.map(s => `- ${s}`).join('\n');
}

// ── 决策 ─────────────────────────────────────────────────────────────

interface HeartbeatDecision {
  action: 'run_channel' | 'spawn_research' | 'evolve_dry' | 'notify_user' | 'update_state' | 'idle';
  /** run_channel: boss|maimai|followup；spawn_research: 任务指令；notify_user: 通知内容 */
  detail: string;
  reason: string;
  /** 更新后的 STATE.md 全文（必填，哪怕只更新时间戳） */
  newState: string;
}

const HEARTBEAT_SYSTEM = `
你是 HireSeek 的心跳决策循环——一个不等指令的招聘 agent 的"主动性大脑"。

你每次醒来，读当前 STATE 和数据信号，决定**当下最有价值的一件事**。
空闲不是休息：选 idle 必须说清楚为什么现在没有值得做的事。

## 可选动作（只能选一个）

- run_channel：跑一轮渠道寻源。detail 填 boss / maimai / followup
- spawn_research：派后台调研任务。detail 填完整自包含的任务指令
- evolve_dry：触发进化复盘（只出报告不落盘，结果会通知用户）。detail 填触发理由
- notify_user：仅向用户推送发现/建议（飞书）。detail 填通知内容（招聘语言，具体可行动）
- update_state：只更新 STATE（梳理状态，无外部动作）
- idle：什么都不做。reason 说明判断依据

## 决策原则

1. 缺什么补什么：今日触达没达标且在工作时间 → 优先 run_channel
2. 别重复：今天已跑过且达标的渠道不再跑；同样的通知一天只发一次（看 STATE）
3. 数据驱动：超 7 天未回复的人多 → 建议跟进；漏斗断流 → 优先寻源
4. 越权的事不做：你不能直接改话术/规则（只能 evolve_dry），不能替用户做承诺
5. 不确定就 notify_user 把选择权给用户，而不是擅自行动

## 输出（严格 JSON）

{"action": "...", "detail": "...", "reason": "...", "newState": "更新后的 STATE.md 全文"}

newState 保持原有四段结构（当前在推进的事/下一步该做什么/待用户确认的事项/最近学到的），
更新时间戳，把本次决策与理由写进对应段落。
`.trim();

export async function decideHeartbeat(): Promise<HeartbeatDecision> {
  const client = new OpenAI({
    apiKey: config.deepseek.apiKey,
    baseURL: config.deepseek.baseUrl,
  });

  const res = await client.chat.completions.create({
    model: config.deepseek.model,
    messages: [
      { role: 'system', content: HEARTBEAT_SYSTEM },
      {
        role: 'user',
        content: `## 当前 STATE\n\n${readState()}\n\n## 数据信号\n\n${gatherSignals()}\n\n请决策并输出 JSON。`,
      },
    ],
    max_tokens: 3000,
    temperature: 0.2,
  });

  const text = res.choices[0]?.message?.content ?? '';
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!m) throw new Error(`心跳决策输出无法解析：${text.slice(0, 200)}`);

  const parsed = JSON.parse(m[1].trim()) as Partial<HeartbeatDecision>;
  const VALID = ['run_channel', 'spawn_research', 'evolve_dry', 'notify_user', 'update_state', 'idle'];
  if (!parsed.action || !VALID.includes(parsed.action)) {
    throw new Error(`心跳决策动作无效：${parsed.action}`);
  }

  return {
    action: parsed.action,
    detail: String(parsed.detail ?? ''),
    reason: String(parsed.reason ?? ''),
    newState: String(parsed.newState ?? readState()),
  };
}

// ── 守护栏 + 执行 ────────────────────────────────────────────────────

/** 代码层守护栏：返回 null 表示放行，否则返回拦截原因 */
function guard(d: HeartbeatDecision): string | null {
  const hour = new Date().getHours();

  if (d.action === 'run_channel') {
    if (hour < WORK_HOUR_START || hour >= WORK_HOUR_END) {
      return `工作时间窗（${WORK_HOUR_START}-${WORK_HOUR_END}点）之外不跑渠道任务`;
    }
    if (!['boss', 'maimai', 'followup'].includes(d.detail)) {
      return `无效渠道：${d.detail}`;
    }
    const job = loadActiveJob();
    const goal = job?.daily_goal?.contact ?? 30;
    const today = db.prepare(
      `SELECT COUNT(*) AS n FROM candidates WHERE date(contacted_at) = date('now', 'localtime')`,
    ).get() as { n: number };
    if (today.n >= goal) return `今日触达 ${today.n} 已达目标 ${goal}，不再寻源`;
  }

  if (d.action === 'run_channel' || d.action === 'spawn_research') {
    const acted = db.prepare(`
      SELECT COUNT(*) AS n FROM heartbeat_log
      WHERE date(created_at) = date('now', 'localtime')
        AND action IN ('run_channel', 'spawn_research')
    `).get() as { n: number };
    if (acted.n >= MAX_ACTIONS_PER_DAY) return `今日心跳主动行动已达上限 ${MAX_ACTIONS_PER_DAY} 次`;
  }

  return null;
}

export interface HeartbeatResult {
  decision: HeartbeatDecision;
  executed: boolean;
  outcome: string;
}

/**
 * 跑一次完整心跳。dryRun=true 时只决策不执行（不更新 STATE，不留痕）。
 */
export async function runHeartbeat(opts: { dryRun?: boolean } = {}): Promise<HeartbeatResult> {
  const decision = await decideHeartbeat();

  if (opts.dryRun) {
    return { decision, executed: false, outcome: '[dry-run] 仅决策，未执行' };
  }

  const blocked = guard(decision);
  let outcome: string;
  let executed = false;

  if (blocked) {
    outcome = `守护栏拦截：${blocked}`;
  } else {
    try {
      outcome = await execute(decision);
      executed = true;
    } catch (err) {
      outcome = `执行失败：${err instanceof Error ? err.message : err}`;
    }
  }

  // 更新 STATE + 留痕（被拦截也记录，模型下次能看到自己被拦的原因）
  writeState(decision.newState);
  db.prepare(`INSERT INTO heartbeat_log (action, reason, detail) VALUES (?, ?, ?)`)
    .run(blocked ? `blocked:${decision.action}` : decision.action, decision.reason, `${decision.detail.slice(0, 300)} | ${outcome.slice(0, 200)}`);

  return { decision, executed, outcome };
}

async function execute(d: HeartbeatDecision): Promise<string> {
  switch (d.action) {
    case 'run_channel': {
      const { runChannel } = await import('./orchestrator');
      await runChannel(d.detail as 'boss' | 'maimai' | 'followup');

      // 做的和验的分开：跑完立刻派独立验证器（换 v4-pro）反向质检本轮触达
      let verifyNote = '';
      try {
        const { verifyRun, formatVerification } = await import('./verifier');
        const v = await verifyRun();
        verifyNote = v.verdict === 'skip' ? '' : `；质检：${v.summary}`;
        // 质检不通过/有隐患 → 主动报给用户（凑数注水正是把触达数当目标的副作用）
        if (v.verdict === 'fail' || v.verdict === 'warn') {
          const { notify } = await import('./notifier');
          await notify('HireSeek 触达质检告警', formatVerification(v));
        }
      } catch (err) {
        verifyNote = `；质检未完成（${err instanceof Error ? err.message : err}）`;
      }
      return `渠道任务 ${d.detail} 已执行完成${verifyNote}`;
    }
    case 'spawn_research': {
      const { spawnSubAgent } = await import('./sub-agent');
      const t = spawnSubAgent({ task: d.detail, label: '心跳调研' });
      return `已派后台任务 #${t.id}`;
    }
    case 'evolve_dry': {
      const { evolve } = await import('./evolution');
      const report = await evolve({ dryRun: true, notify: true });
      return `进化复盘完成（dry-run，报告已推送）：${report.slice(0, 150)}`;
    }
    case 'notify_user': {
      const { sendMessage } = await import('./channels/feishu');
      await sendMessage(`🔱 HireSeek 主动汇报\n\n${d.detail}\n\n（依据：${d.reason}）`);
      return '已推送用户通知';
    }
    case 'update_state':
      return 'STATE 已更新';
    case 'idle':
      return `本轮空闲：${d.reason}`;
    default:
      return '未知动作';
  }
}

/** 心跳历史（CLI / chat 查看） */
export function heartbeatHistory(limit = 10): string {
  const rows = db.prepare(
    `SELECT action, reason, detail, created_at FROM heartbeat_log ORDER BY id DESC LIMIT ?`,
  ).all(limit) as Array<{ action: string; reason: string; detail: string; created_at: string }>;

  if (rows.length === 0) return '暂无心跳记录。';
  return rows.map(r =>
    `[${r.created_at.slice(5, 16)}] ${r.action}\n   ${(r.reason ?? '').slice(0, 120)}`,
  ).join('\n');
}
