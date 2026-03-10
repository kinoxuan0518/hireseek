import 'dotenv/config';
import chalk from 'chalk';
import { startScheduler } from './scheduler';
import { runChannel, runJob, scanInbox } from './orchestrator';
import { startChat } from './chat';
import { runSetup } from './setup';
import { startDashboard } from './dashboard';
import { db, candidateOps } from './db';
import { loadActiveJob } from './skills/loader';
import type { Channel } from './types';

const VALID_STATUSES = ['contacted', 'replied', 'interviewed', 'offered', 'joined', 'rejected', 'dropped'];
const STATUS_LABEL: Record<string, string> = {
  contacted:   '已触达',
  replied:     '已回复',
  interviewed: '已面试',
  offered:     '已 Offer',
  joined:      '已入职',
  rejected:    '已淘汰',
  dropped:     '已放弃',
};

const CHANNELS: Channel[] = ['boss', 'maimai', 'linkedin', 'followup'];

const USAGE = `
用法:
  hireclaw                     对话模式（默认）
  hireclaw setup               初始化向导：一步步配置好一切
  hireclaw dashboard           启动本地控制台（实时截图 + 日志 + 任务控制）
  hireclaw run                 自主模式：自动决定今天跑哪些渠道
  hireclaw run <渠道>          指定渠道立即执行
  hireclaw scan                扫描收件箱，更新已回复候选人
  hireclaw update <姓名> <状态>  手动更新候选人状态
  hireclaw funnel              查看招聘漏斗
  hireclaw start               启动定时守护进程

渠道: boss | maimai | linkedin | followup
状态: replied | interviewed | offered | joined | rejected | dropped
`.trim();

function checkSetup(): void {
  const issues: string[] = [];
  const hints:  string[] = [];

  // 检查 API key
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.CUSTOM_API_KEY;
  if (!hasKey) {
    issues.push('未配置 API Key');
    hints.push('  → 前往 console.anthropic.com 获取 Key，填入 .env 的 ANTHROPIC_API_KEY');
  }

  // 检查职位文件
  const job = loadActiveJob();
  if (!job) {
    issues.push('未配置招聘职位');
    hints.push('  → 编辑 workspace/jobs/active.yaml，填写你要招的职位信息');
  } else if (job.title === 'AI 算法工程师') {
    hints.push(`  ℹ️  当前职位：${job.title}（示例职位，记得改成你真实要招的）`);
  }

  if (issues.length > 0) {
    console.log(chalk.yellow('⚠️  首次使用，需要完成以下配置：\n'));
    issues.forEach(i => console.log(chalk.red(`  ✗ ${i}`)));
    console.log('');
    hints.forEach(h => console.log(chalk.gray(h)));
    console.log(chalk.gray('\n  完整使用手册：workspace/PLAYBOOK.md\n'));
    process.exit(0);
  }

  if (hints.length > 0) {
    hints.forEach(h => console.log(chalk.gray(h)));
    console.log('');
  }
}

async function main(): Promise<void> {
  console.log(chalk.cyan('\n🦞 HireClaw - 智能招聘 Agent\n'));
  console.log(`数据库: ${chalk.gray(db.name)}\n`);

  const args = process.argv.slice(2);
  const command = args[0];
  const channel = args[1] as Channel | undefined;

  if (!command || command === 'chat') {
    checkSetup();
    await startChat();

  } else if (command === 'setup') {
    await runSetup();

  } else if (command === 'dashboard' || command === 'ui') {
    startDashboard();
    process.on('SIGINT', () => { db.close(); process.exit(0); });

  } else if (command === 'run') {
    if (!channel) {
      // 自主模式：由 active.yaml 决定渠道
      await runJob();
    } else if (CHANNELS.includes(channel)) {
      // 指定渠道模式
      await runChannel(channel);
    } else {
      console.error(chalk.red(`渠道无效: "${channel}"`));
      console.log(USAGE);
      process.exit(1);
    }
    db.close();
    process.exit(0);

  } else if (command === 'scan') {
    await scanInbox();
    db.close();
    process.exit(0);

  } else if (command === 'update') {
    const name   = args[1];
    const status = args[2];
    if (!name || !status || !VALID_STATUSES.includes(status)) {
      console.error(chalk.red(`用法: hireclaw update <姓名> <状态>`));
      console.log(`状态可选: ${VALID_STATUSES.join(' | ')}`);
      process.exit(1);
    }
    const matches = candidateOps.findByName.all(`%${name}%`) as any[];
    if (matches.length === 0) {
      console.error(chalk.red(`未找到候选人: ${name}`));
      process.exit(1);
    }
    for (const c of matches) {
      candidateOps.updateStatus.run({ status, id: c.id });
      console.log(chalk.green(`✓ ${c.name}（${c.company || c.channel}）→ ${STATUS_LABEL[status]}`));
    }
    db.close();
    process.exit(0);

  } else if (command === 'funnel') {
    const job   = loadActiveJob();
    const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';
    const stats = candidateOps.funnelStats.all(jobId) as { status: string; count: number }[];
    console.log(chalk.cyan(`\n招聘漏斗：${job?.title ?? jobId}\n`));
    if (stats.length === 0) {
      console.log('  暂无数据');
    } else {
      for (const s of stats) {
        const label = STATUS_LABEL[s.status] ?? s.status;
        const bar   = '█'.repeat(Math.min(s.count, 40));
        console.log(`  ${label.padEnd(8)} ${String(s.count).padStart(4)} 人  ${chalk.blue(bar)}`);
      }
    }
    console.log();
    db.close();
    process.exit(0);

  } else if (command === 'start') {
    console.log(chalk.green('守护进程启动，定时任务：'));
    startScheduler();
    console.log(chalk.gray('\n按 Ctrl+C 退出\n'));

    process.on('SIGINT', () => {
      console.log('\n[HireClaw] 退出');
      db.close();
      process.exit(0);
    });

  } else {
    console.log(USAGE);
  }
}

main().catch((err) => {
  console.error(chalk.red('[HireClaw] 启动失败:'), err.message);
  process.exit(1);
});
