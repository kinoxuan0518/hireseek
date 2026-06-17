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
    await notify('🦞 HireSeek 提醒', `以下候选人联系超过 7 天未回复，考虑跟进或放弃：\n${names}`);
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
      await notify('🦞 HireSeek 提醒', '今天还没有跑 sourcing，要现在开始吗？\n运行 hireseek run');
    }
  }

  // 3. 漏斗告警：contacted 阶段为 0（说明很久没 sourcing）
  const contacted = db.prepare(`
    SELECT COUNT(*) as count FROM candidates
    WHERE job_id = ? AND status = 'contacted'
      AND contacted_at >= datetime('now', '-3 days')
  `).get(jobId) as { count: number };

  if (contacted.count === 0 && hour >= 9) {
    await notify('🦞 HireSeek 提醒', '最近 3 天没有新触达候选人，漏斗顶部快空了。');
  }
}

// ── 启动调度器 ────────────────────────────────────────────
export function startScheduler(): void {
  // 记录 pid，供 hireseek sched 检测 daemon 存活
  const { writeDaemonPid, humanizeCron } = require('./schedule-manager') as typeof import('./schedule-manager');
  writeDaemonPid();

  const jobs = [
    { cron: config.schedule.boss,     channel: 'boss' as Channel,     label: 'BOSS直聘'   },
    { cron: config.schedule.maimai,   channel: 'maimai' as Channel,   label: '脉脉'       },
    { cron: config.schedule.followup, channel: 'followup' as Channel, label: '跟进未回复' },
  ];

  for (const job of jobs) {
    if (job.cron === 'off') {
      console.log(`  ${job.label.padEnd(20)} → 已关闭`);
      continue;
    }
    if (!cron.validate(job.cron)) {
      console.error(`  ${job.label.padEnd(20)} → ⚠️ cron 表达式无效，跳过: "${job.cron}"`);
      continue;
    }
    cron.schedule(job.cron, () => {
      console.log(`\n[Scheduler] ⏰ 触发: ${job.label}`);
      safeRun(job.channel);
    });
    console.log(`  ${job.label.padEnd(20)} → ${humanizeCron(job.cron)}（${job.cron}）`);
  }

  // 心跳主动决策循环（daemon 哲学）：醒来 → 读 STATE+信号 → 自主决定当下最有价值的事
  if (config.schedule.heartbeat !== 'off' && cron.validate(config.schedule.heartbeat)) {
    cron.schedule(config.schedule.heartbeat, async () => {
      console.log('[Scheduler] 💓 心跳决策...');
      try {
        const { runHeartbeat } = await import('./heartbeat');
        const r = await runHeartbeat();
        console.log(`[Heartbeat] ${r.decision.action}：${r.outcome}`);

        // 生命体征：每次心跳都刷新"报平安"，并记下最近动作
        const { markAlive, reportVitals } = await import('./vitals');
        markAlive({ lastAction: `${r.decision.action} — ${r.outcome}`.slice(0, 80) });
        // 真正执行了"重动作"（跑渠道/派调研）才主动汇报，空闲心跳不打扰
        if (r.executed && r.decision.action !== 'idle' && r.decision.action !== 'update_state') {
          await reportVitals('刚做了一件事');
        }
      } catch (e) {
        console.error('[Heartbeat] 出错:', e instanceof Error ? e.message : e);
      }
    });
    console.log(`  ${'心跳决策'.padEnd(20)} → ${humanizeCron(config.schedule.heartbeat)}（${config.schedule.heartbeat}）`);
  } else {
    console.log(`  ${'心跳决策'.padEnd(20)} → 已关闭`);
  }

  // 兜底主动检查（心跳关闭时仍保留基础提醒）
  if (config.schedule.heartbeat === 'off') {
    cron.schedule('0 * * * *', () => {
      console.log('[Scheduler] 🔍 主动检查...');
      proactiveCheck().catch(e => console.error('[Scheduler] 检查出错:', e.message));
    });
    console.log(`  ${'主动检查'.padEnd(20)} → 每小时`);
  }

  // 每周进化：基于一周真实数据复盘并改写话术/筛选规则，报告推飞书
  if (config.schedule.evolve !== 'off' && cron.validate(config.schedule.evolve)) {
    cron.schedule(config.schedule.evolve, async () => {
      console.log('[Scheduler] 🧬 每周进化复盘...');
      try {
        const { evolve } = await import('./evolution');
        await evolve({ notify: true });
      } catch (e) {
        console.error('[Scheduler] 进化出错:', e instanceof Error ? e.message : e);
      }
    });
    console.log(`  ${'每周进化'.padEnd(20)} → ${humanizeCron(config.schedule.evolve)}（${config.schedule.evolve}）`);
  } else {
    console.log(`  ${'每周进化'.padEnd(20)} → 已关闭`);
  }

  // 晨间签到 / 傍晚收工：固定两条主动汇报，形成"它每天都在"的节律安全感
  const checkin = process.env.SCHEDULE_CHECKIN || '0 9 * * 1-5';
  const wrapup  = process.env.SCHEDULE_WRAPUP  || '0 19 * * 1-5';
  if (cron.validate(checkin)) {
    cron.schedule(checkin, async () => {
      try { (await import('./vitals')).reportVitals('上班签到').catch(() => {}); } catch { /* 忽略 */ }
    });
    console.log(`  ${'上班签到'.padEnd(20)} → ${humanizeCron(checkin)}（${checkin}）`);
  }
  if (cron.validate(wrapup)) {
    cron.schedule(wrapup, async () => {
      try { (await import('./vitals')).reportVitals('今日收工').catch(() => {}); } catch { /* 忽略 */ }
    });
    console.log(`  ${'今日收工'.padEnd(20)} → ${humanizeCron(wrapup)}（${wrapup}）`);
  }

  // 飞书招聘/多维表格：每天自动拉面试结果回流（给校准喂 ground truth）
  // 默认 dry-run + 通知（结论映射没确认前不擅自落库）；FEISHU_HIRE_AUTO_APPLY=true 才自动落库
  const hireSync = process.env.SCHEDULE_HIRESYNC || '0 20 * * 1-5';
  const hireSrcOn = process.env.FEISHU_HIRE_ENABLED === 'true'
    || Boolean(process.env.FEISHU_BITABLE_APP_TOKEN || config.feishu.bitable.appToken);
  if (hireSrcOn && cron.validate(hireSync)) {
    cron.schedule(hireSync, async () => {
      try {
        const autoApply = process.env.FEISHU_HIRE_AUTO_APPLY === 'true';
        const { syncInterviewOutcomes } = await import('./channels/feishu-hire');
        const r = await syncInterviewOutcomes({ dryRun: !autoApply });
        if (r.resolved.length > 0 || r.error) await notify('🔱 HireSeek 面试结果同步', r.text);
      } catch (e) { console.error('[HireSync] 出错:', e instanceof Error ? e.message : e); }
    });
    console.log(`  ${'面试结果同步'.padEnd(20)} → ${humanizeCron(hireSync)}（${hireSync}，${process.env.FEISHU_HIRE_AUTO_APPLY === 'true' ? '自动落库' : 'dry-run+通知'}）`);
  }

  // 启动后立即跑一次，别等到整点
  setTimeout(() => proactiveCheck().catch(() => {}), 5000);
}
