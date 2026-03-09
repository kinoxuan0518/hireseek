import cron from 'node-cron';
import { config } from './config';
import { runChannel } from './orchestrator';
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

export function startScheduler(): void {
  const jobs = [
    { cron: config.schedule.boss,    channel: 'boss' as Channel,    label: 'BOSS直聘' },
    { cron: config.schedule.maimai,  channel: 'maimai' as Channel,  label: '脉脉'     },
    { cron: config.schedule.followup, channel: 'followup' as Channel, label: '跟进未回复' },
  ];

  for (const job of jobs) {
    cron.schedule(job.cron, () => {
      console.log(`\n[Scheduler] ⏰ 触发: ${job.label}`);
      safeRun(job.channel);
    });
    console.log(`  ${job.label.padEnd(20)} → ${job.cron}`);
  }
}
