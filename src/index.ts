import 'dotenv/config';
import chalk from 'chalk';
import { startScheduler } from './scheduler';
import { runChannel, runJob, scanInbox } from './orchestrator';
import { startChat } from './chat';
import { runSetup } from './setup';
import { startDashboard } from './dashboard';
import { db, candidateOps } from './db';
import { loadActiveJob } from './skills/loader';
import { createTask, updateTask, deleteTask, displayTaskBoard, displayTask, listAllTasks } from './tasks';
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
  hireclaw run --plan          计划模式：先分析生成计划，用户确认后执行
  hireclaw run <渠道>          指定渠道立即执行
  hireclaw scan                扫描收件箱，更新已回复候选人
  hireclaw update <姓名> <状态>  手动更新候选人状态
  hireclaw funnel              查看招聘漏斗
  hireclaw tasks               查看任务看板
  hireclaw tasks <ID>          查看任务详情
  hireclaw start               启动定时守护进程

渠道: boss | maimai | linkedin | followup
状态: replied | interviewed | offered | joined | rejected | dropped
`.trim();

async function checkSetup(): Promise<boolean> {
  const issues: string[] = [];
  const hints:  string[] = [];

  // 检查 API key
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.CUSTOM_API_KEY;
  if (!hasKey) {
    issues.push('未配置 API Key');
  }

  // 检查职位文件
  const job = loadActiveJob();
  if (!job) {
    issues.push('未配置招聘职位');
  } else if (job.title === 'AI 算法工程师') {
    hints.push(`  ℹ️  当前职位：${job.title}（示例职位，记得改成你真实要招的）`);
  }

  // 如果有配置缺失，显示欢迎信息并引导 setup
  if (issues.length > 0) {
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('👋 欢迎使用 HireClaw！'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.white('看起来这是你第一次使用 HireClaw 🦞\n'));
    console.log(chalk.gray('HireClaw 是一个智能招聘助手，可以帮你：'));
    console.log(chalk.gray('  • 自动在 BOSS直聘、脉脉等平台寻找候选人'));
    console.log(chalk.gray('  • 智能筛选和评估候选人'));
    console.log(chalk.gray('  • 追踪招聘进展和数据分析'));
    console.log(chalk.gray('  • 自然对话控制所有功能\n'));

    console.log(chalk.yellow('🔧 开始前需要完成初始化：\n'));
    issues.forEach(i => console.log(chalk.red(`  ✗ ${i}`)));
    console.log('');

    console.log(chalk.white('现在让我引导你完成设置（约 3 分钟）...\n'));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // 自动运行 setup
    await runSetup();

    console.log(chalk.green('\n✨ 配置完成！HireClaw 已准备就绪\n'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    return true; // 表示运行了 setup
  }

  // 显示提示信息
  if (hints.length > 0) {
    hints.forEach(h => console.log(chalk.gray(h)));
    console.log('');
  }

  return false; // 表示没有运行 setup
}

async function main(): Promise<void> {
  console.log(chalk.cyan('\n🦞 HireClaw - 智能招聘 Agent\n'));
  console.log(`数据库: ${chalk.gray(db.name)}\n`);

  const args = process.argv.slice(2);
  const command = args[0];
  const channel = args[1] as Channel | undefined;

  if (!command || command === 'chat') {
    await checkSetup();
    await startChat();

  } else if (command === 'setup') {
    await runSetup();

  } else if (command === 'dashboard' || command === 'ui') {
    startDashboard();
    process.on('SIGINT', () => { db.close(); process.exit(0); });

  } else if (command === 'run') {
    // 检查是否使用计划模式
    const usePlan = args.includes('--plan') || args.includes('-p');
    const channelArg = args.find(a => !a.startsWith('-'));

    if (!channelArg) {
      // 自主模式：由 active.yaml 决定渠道
      await runJob(usePlan);
    } else if (CHANNELS.includes(channelArg as Channel)) {
      // 指定渠道模式
      if (usePlan) {
        console.log(chalk.yellow('⚠️  计划模式仅支持 "hireclaw run --plan"（全渠道），指定渠道时不支持'));
        process.exit(1);
      }
      await runChannel(channelArg as Channel);
    } else {
      console.error(chalk.red(`渠道无效: "${channelArg}"`));
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

  } else if (command === 'tasks') {
    const taskId = args[1];

    if (taskId) {
      // 显示任务详情
      displayTask(parseInt(taskId, 10));
    } else {
      // 显示任务看板
      const job = loadActiveJob();
      const jobId = job ? job.title.replace(/\s+/g, '_') : undefined;
      displayTaskBoard(jobId);
    }

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
