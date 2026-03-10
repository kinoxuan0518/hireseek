import cron from 'node-cron';
import { config } from './config';
import { runChannel } from './orchestrator';
import { db } from './db';
import { loadActiveJob } from './skills/loader';
import { notify } from './notifier';
import type { Channel } from './types';

// 防止同时跑多个任务
let isRunning = false;

async function safeRun(channel: Channel): Promise<void> {
  if (isRunning) {
    console.log(`[Scheduler] 上一个任务仍在运行，跳过 ${channel}`);
    return;
  }
  isRunning = true;
  try {
    await runChannel(channel);
  } finally {
    isRunning = false;
  }
}

// ── 主动检查逻辑 ──────────────────────────────────────────
async function proactiveCheck(): Promise<void> {
  const job   = loadActiveJob();
  const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';

  // 1. 超过 7 天未回复的候选人
  const stale = db.prepare(`
    SELECT name, company, contacted_at FROM candidates
    WHERE job_id = ? AND status = 'contacted'
      AND julianday('now') - julianday(contacted_at) >= 7
    ORDER BY contacted_at ASC LIMIT 5
  `).all(jobId) as { name: string; company: string; contacted_at: string }[];

  if (stale.length > 0) {
    const names = stale.map(c => `${c.name}（${c.company || '未知'}）`).join('、');
    await notify('🦞 HireClaw 提醒', `以下候选人联系超过 7 天未回复，考虑跟进或放弃：\n${names}`);
  }

  // 2. 今天还没跑 sourcing（早上 10 点后检查）
  const hour = new Date().getHours();
  if (hour >= 10) {
    const todayRun = db.prepare(`
      SELECT id FROM task_runs
      WHERE date(started_at) = date('now') AND status = 'completed'
      LIMIT 1
    `).get();
    if (!todayRun) {
      await notify('🦞 HireClaw 提醒', '今天还没有跑 sourcing，要现在开始吗？\n运行 hireclaw run');
    }
  }

  // 3. 漏斗告警：contacted 阶段为 0（说明很久没 sourcing）
  const contacted = db.prepare(`
    SELECT COUNT(*) as count FROM candidates
    WHERE job_id = ? AND status = 'contacted'
      AND contacted_at >= datetime('now', '-3 days')
  `).get(jobId) as { count: number };

  if (contacted.count === 0 && hour >= 9) {
    await notify('🦞 HireClaw 提醒', '最近 3 天没有新触达候选人，漏斗顶部快空了。');
  }
}

// ── 启动调度器 ────────────────────────────────────────────
export function startScheduler(): void {
  const jobs = [
    { cron: config.schedule.boss,     channel: 'boss' as Channel,     label: 'BOSS直聘'   },
    { cron: config.schedule.maimai,   channel: 'maimai' as Channel,   label: '脉脉'       },
    { cron: config.schedule.followup, channel: 'followup' as Channel, label: '跟进未回复' },
  ];

  for (const job of jobs) {
    cron.schedule(job.cron, () => {
      console.log(`\n[Scheduler] ⏰ 触发: ${job.label}`);
      safeRun(job.channel);
    });
    console.log(`  ${job.label.padEnd(20)} → ${job.cron}`);
  }

  // 每小时做一次主动检查
  cron.schedule('0 * * * *', () => {
    console.log('[Scheduler] 🔍 主动检查...');
    proactiveCheck().catch(e => console.error('[Scheduler] 检查出错:', e.message));
  });
  console.log(`  ${'主动检查'.padEnd(20)} → 每小时`);

  // 启动后立即跑一次，别等到整点
  setTimeout(() => proactiveCheck().catch(() => {}), 5000);
}
