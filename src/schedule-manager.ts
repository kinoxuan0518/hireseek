/**
 * 调度管理层：让 HR 能看懂、能修改定时计划
 *
 * - 人话化 cron（"0 9 * * 1-5" → "工作日 09:00"）+ 下次执行时间
 * - 修改/禁用单项计划，写回 .env（cron 设为 off 即禁用）
 * - daemon 存活检测（pid 文件）
 */

import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { config } from './config';
import { db } from './db';

export interface ScheduleTask {
  /** 任务标识（env 后缀小写） */
  name: 'boss' | 'maimai' | 'followup' | 'evolve';
  label: string;
  envKey: string;
  defaultCron: string;
}

export const SCHEDULE_TASKS: ScheduleTask[] = [
  { name: 'boss',     label: 'BOSS直聘寻源', envKey: 'SCHEDULE_BOSS',     defaultCron: '0 9 * * 1-5' },
  { name: 'maimai',   label: '脉脉寻源',     envKey: 'SCHEDULE_MAIMAI',   defaultCron: '0 10 * * 1-5' },
  { name: 'followup', label: '跟进未回复',   envKey: 'SCHEDULE_FOLLOWUP', defaultCron: '0 14 * * 1-5' },
  { name: 'evolve',   label: '每周进化复盘', envKey: 'SCHEDULE_EVOLVE',   defaultCron: '0 18 * * 5' },
];

export function currentCron(task: ScheduleTask): string {
  return (config.schedule as Record<string, string>)[task.name] ?? task.defaultCron;
}

// ── 人话化 ───────────────────────────────────────────────────────────

const DOW_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dowLabel(dow: string): string {
  if (dow === '*') return '每天';
  if (dow === '1-5') return '工作日';
  if (dow === '0,6' || dow === '6,0') return '周末';
  const single = dow.match(/^(\d)$/);
  if (single) return `每${DOW_NAMES[parseInt(single[1], 10)]}`;
  const range = dow.match(/^(\d)-(\d)$/);
  if (range) return `${DOW_NAMES[parseInt(range[1], 10)]}至${DOW_NAMES[parseInt(range[2], 10)]}`;
  if (/^[\d,]+$/.test(dow)) {
    return dow.split(',').map(d => DOW_NAMES[parseInt(d, 10)] ?? d).join('、');
  }
  return dow;
}

/** 常见 cron 模式转人话；复杂表达式原样返回 */
export function humanizeCron(expr: string): string {
  if (expr === 'off') return '已关闭';
  const m = expr.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\S+)$/);
  if (!m) return expr;
  const [, min, hour, dow] = m;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return `${dowLabel(dow)} ${time}`;
}

/** 计算下次执行时间（仅支持 分 时 * * 周 的固定模式，其余返回 null） */
export function nextRun(expr: string): Date | null {
  if (expr === 'off') return null;
  const m = expr.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\S+)$/);
  if (!m) return null;
  const minute = parseInt(m[1], 10);
  const hour = parseInt(m[2], 10);
  const dow = m[3];

  const dowMatch = (d: number): boolean => {
    if (dow === '*') return true;
    return dow.split(',').some(part => {
      const range = part.match(/^(\d)-(\d)$/);
      if (range) return d >= parseInt(range[1], 10) && d <= parseInt(range[2], 10);
      return parseInt(part, 10) === d;
    });
  };

  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hour, minute, 0, 0);
    if (candidate > now && dowMatch(candidate.getDay())) return candidate;
  }
  return null;
}

// ── 状态查询 ─────────────────────────────────────────────────────────

function lastRunOf(task: ScheduleTask): string {
  try {
    if (task.name === 'evolve') {
      const row = db.prepare(
        `SELECT created_at FROM evolution_log ORDER BY id DESC LIMIT 1`,
      ).get() as { created_at: string } | undefined;
      return row ? row.created_at.slice(5, 16) : '从未';
    }
    const row = db.prepare(
      `SELECT started_at, contacted_count, status FROM task_runs
       WHERE channel = ? ORDER BY id DESC LIMIT 1`,
    ).get(task.name) as { started_at: string; contacted_count: number; status: string } | undefined;
    if (!row) return '从未';
    const flag = row.status === 'completed' ? `触达${row.contacted_count}` : row.status;
    return `${row.started_at.slice(5, 16)}（${flag}）`;
  } catch {
    return '—';
  }
}

const PID_FILE = path.join(path.dirname(config.db.path), 'scheduler.pid');

export function writeDaemonPid(): void {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch { /* pid 写入失败不影响调度 */ }
}

export function daemonAlive(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0); // 信号 0 仅探测存活
    return true;
  } catch {
    return false;
  }
}

/** 完整调度面板（CLI 与 chat 共用） */
export function describeSchedule(): string {
  const lines: string[] = [];
  const running = daemonAlive();
  lines.push(running
    ? '🟢 定时守护进程运行中'
    : '⚪ 定时守护进程未运行（执行 hireseek start 启动，计划才会生效）');
  lines.push('');

  const fmt = (d: Date | null): string => {
    if (!d) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  for (const task of SCHEDULE_TASKS) {
    const expr = currentCron(task);
    const human = humanizeCron(expr);
    const next = expr === 'off' ? '—' : fmt(nextRun(expr));
    lines.push(`${task.label.padEnd(8)} ${human.padEnd(14)} 下次 ${next.padEnd(13)} 上次 ${lastRunOf(task)}`);
  }

  lines.push('');
  lines.push('修改：hireseek sched set <boss|maimai|followup|evolve> "<cron>"');
  lines.push('开关：hireseek sched off <任务> / hireseek sched on <任务>');
  return lines.join('\n');
}

// ── 修改计划 ─────────────────────────────────────────────────────────

function upsertEnv(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let raw = '';
  try { raw = fs.readFileSync(envPath, 'utf-8'); } catch { /* 无则新建 */ }
  const line = `${key}=${value}`;
  raw = new RegExp(`^${key}=.*$`, 'm').test(raw)
    ? raw.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : raw + (raw === '' || raw.endsWith('\n') ? '' : '\n') + line + '\n';
  fs.writeFileSync(envPath, raw);
}

export function findTask(name: string): ScheduleTask | null {
  return SCHEDULE_TASKS.find(t => t.name === name) ?? null;
}

/**
 * 设置任务计划。cronExpr 传 'off' 禁用，传 'default' 恢复默认。
 * 返回人话结果；daemon 需重启生效。
 */
export function setSchedule(name: string, cronExpr: string): string {
  const task = findTask(name);
  if (!task) {
    return `未知任务 "${name}"。可选：${SCHEDULE_TASKS.map(t => t.name).join(' / ')}`;
  }

  let expr = cronExpr.trim();
  if (expr === 'default') expr = task.defaultCron;

  if (expr !== 'off' && !cron.validate(expr)) {
    return `cron 表达式无效："${expr}"。格式：分 时 日 月 周，如 "0 9 * * 1-5"（工作日 09:00）`;
  }

  upsertEnv(task.envKey, expr);

  const human = humanizeCron(expr);
  const daemonNote = daemonAlive() ? '（守护进程需重启生效：先停掉再 hireseek start）' : '（hireseek start 启动后生效）';
  return expr === 'off'
    ? `✓ ${task.label} 已关闭 ${daemonNote}`
    : `✓ ${task.label} → ${human}（${expr}）${daemonNote}`;
}
