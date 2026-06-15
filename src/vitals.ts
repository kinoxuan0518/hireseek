/**
 * 生命体征（vitals）—— 让你对 HireSeek 有"安全感"的单一事实来源
 *
 * 安全感不是来自一个要你主动去看的网页，而是来自三个随时能回答、且它会主动
 * 报给你的问题：
 *   1. 它在线吗？          —— 守护进程是否活着、最后一次"报平安"是几分钟前
 *   2. 它做了什么？        —— 今天触达多少、最近一次心跳/渠道动作是什么
 *   3. 它接下来要做什么？  —— 下一个定时任务、STATE 里写的下一步
 *
 * 这套数据有两类消费者：
 *   · 拉取式：`hireseek alive` 命令、网页指挥台 /api/status —— 你想看时随时看
 *   · 推送式：daemon 上线/下线、晨间签到、傍晚收工、心跳重动作 —— 它主动来找你
 *
 * 关键设计：守护进程每分钟往 alive.json 写一个时间戳（markAlive）。这样即便
 * `hireseek alive` 是另一个独立进程，也能读到"它 30 秒前还活着"——这正是
 * "在线"二字的实感来源，而不是一句空泛的"已安装"。
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { db } from './db';
import { loadActiveJob } from './skills/loader';
import { SCHEDULE_TASKS, currentCron, nextRun, daemonAlive } from './schedule-manager';

const ALIVE_PATH = path.join(path.dirname(config.db.path), 'alive.json');
/** 超过这个时长没收到"报平安"，就认为它可能掉线了（心跳兜底是每分钟一次） */
const STALE_MS = 3 * 60 * 1000;

interface AliveFile {
  pid: number;
  startedAt: string;       // 守护进程本次上线时间
  lastSeen: string;        // 最后一次报平安
  lastAction?: string;     // 最近一次有意义的动作（人话）
  lastActionAt?: string;
}

// ── 守护进程侧：报平安 ─────────────────────────────────────────────────
export function markAlive(patch: Partial<AliveFile> = {}): void {
  try {
    const prev = readAliveRaw();
    const now = new Date().toISOString();
    const data: AliveFile = {
      pid: process.pid,
      startedAt: prev?.startedAt ?? now,
      lastSeen: now,
      lastAction: patch.lastAction ?? prev?.lastAction,
      lastActionAt: patch.lastAction ? now : prev?.lastActionAt,
      ...patch,
    };
    fs.mkdirSync(path.dirname(ALIVE_PATH), { recursive: true });
    fs.writeFileSync(ALIVE_PATH, JSON.stringify(data));
  } catch { /* 报平安失败不影响主流程 */ }
}

/** 守护进程退出时调用：抹掉 lastSeen 让外部立刻看出已下线 */
export function markOffline(): void {
  try { if (fs.existsSync(ALIVE_PATH)) fs.unlinkSync(ALIVE_PATH); } catch { /* 忽略 */ }
}

function readAliveRaw(): AliveFile | null {
  try {
    return JSON.parse(fs.readFileSync(ALIVE_PATH, 'utf-8')) as AliveFile;
  } catch {
    return null;
  }
}

// ── 读取侧：汇总生命体征 ───────────────────────────────────────────────
export interface Vitals {
  online: boolean;            // 有 HireSeek 进程活着且最近报过平安（可达）
  guarding: boolean;          // 守护进程（调度+心跳）在跑，定时任务才会自动触发
  staleness: string | null;   // "刚刚" / "2 分钟前" / null(离线)
  startedAt: string | null;
  uptime: string | null;
  job: string;
  todayContacted: number;
  goal: number;
  lastAction: string | null;
  lastActionAt: string | null;
  lastBeat: { action: string; reason: string; at: string } | null;
  next: { label: string; at: string; human: string } | null;
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function durationSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (h < 24) return rem ? `${h} 小时 ${rem} 分钟` : `${h} 小时`;
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
}

/** 计算下一个最早触发的定时任务 */
function soonestNext(): Vitals['next'] {
  let best: { label: string; date: Date; cron: string } | null = null;
  for (const t of SCHEDULE_TASKS) {
    const cron = currentCron(t);
    const d = nextRun(cron);
    if (d && (!best || d < best.date)) best = { label: t.label, date: d, cron };
  }
  if (!best) return null;
  const { humanizeCron } = require('./schedule-manager') as typeof import('./schedule-manager');
  return { label: best.label, at: best.date.toISOString(), human: humanizeCron(best.cron) };
}

export function collectVitals(): Vitals {
  const alive = readAliveRaw();
  const fresh = alive ? Date.now() - new Date(alive.lastSeen).getTime() < STALE_MS : false;
  const guarding = daemonAlive();          // 调度器写了 scheduler.pid 且进程存活
  const online = fresh || guarding;        // 有进程在报平安 / 守护进程在跑

  const job = loadActiveJob();
  const goal = (job as any)?.daily_goal?.contact ?? 30;
  const today = db.prepare(
    `SELECT COUNT(*) AS n FROM candidates WHERE date(contacted_at) = date('now','localtime')`,
  ).get() as { n: number };

  let lastBeat: Vitals['lastBeat'] = null;
  try {
    const r = db.prepare(
      `SELECT action, reason, created_at FROM heartbeat_log ORDER BY id DESC LIMIT 1`,
    ).get() as { action: string; reason: string; created_at: string } | undefined;
    if (r) lastBeat = { action: r.action, reason: (r.reason ?? '').slice(0, 120), at: r.created_at.slice(5, 16) };
  } catch { /* 尚无心跳表 */ }

  return {
    online,
    guarding,
    staleness: alive ? ago(alive.lastSeen) : null,
    startedAt: alive?.startedAt ?? null,
    uptime: alive?.startedAt ? durationSince(alive.startedAt) : null,
    job: job?.title ?? '（未设置职位）',
    todayContacted: today.n,
    goal,
    lastAction: alive?.lastAction ?? null,
    lastActionAt: alive?.lastActionAt ? ago(alive.lastActionAt) : null,
    lastBeat,
    next: soonestNext(),
  };
}

// ── 人话化：把生命体征说成一句让人安心的话 ──────────────────────────────
export function formatVitals(v: Vitals, trigger?: string): string {
  const head = trigger ? `🔱 HireSeek ${trigger}` : '🔱 HireSeek 生命体征';
  const lines: string[] = [head, ''];

  if (v.guarding) {
    lines.push(`✅ 在线守护中 · 已守护 ${v.uptime ?? '—'}（最后报平安：${v.staleness ?? '刚刚'}）`);
  } else if (v.online) {
    lines.push('🟡 我在，但未常驻守护 · 现在能指挥我，但定时任务要 `hireseek daemon install` 才会自动跑');
  } else if (v.staleness) {
    lines.push(`⚠️ 可能掉线 · 最后一次活动 ${v.staleness}，建议看一眼守护进程`);
  } else {
    lines.push('⏸ 未在守护 · 当前没有常驻进程在跑（hireseek daemon install 可让它常驻）');
  }

  lines.push(`📋 在岗：${v.job}`);
  lines.push(`📊 今天触达 ${v.todayContacted}/${v.goal} 人`);

  if (v.lastAction) lines.push(`🔧 最近动作：${v.lastAction}（${v.lastActionAt}）`);
  else if (v.lastBeat) lines.push(`💓 最近心跳：${v.lastBeat.action}（${v.lastBeat.at}）`);

  if (v.next) {
    const at = new Date(v.next.at);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    lines.push(`⏭ 下一步：${v.next.label} · ${v.next.human}（约 ${hhmm}）`);
  }

  return lines.join('\n');
}

/** 主动推送一次生命体征（走 notify：系统通知 + 飞书 Bot/webhook + 终端）。 */
export async function reportVitals(trigger: string): Promise<void> {
  const { notify } = await import('./notifier');
  const v = collectVitals();
  await notify(`HireSeek ${trigger}`, formatVitals(v, trigger));
}
