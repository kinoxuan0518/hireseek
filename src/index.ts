import 'dotenv/config';
import chalk from 'chalk';
import { startScheduler } from './scheduler';
import { runChannel } from './orchestrator';
import { db } from './db';
import type { Channel } from './types';

const CHANNELS: Channel[] = ['boss', 'maimai', 'linkedin'];

const USAGE = `
用法:
  npm run dev run <渠道>   立即触发一次 sourcing
  npm run dev start        启动守护进程（按计划自动运行）

渠道: boss | maimai | linkedin

示例:
  npm run dev run boss
  npm run dev start
`.trim();

async function main(): Promise<void> {
  console.log(chalk.cyan('\n🦞 HireClaw - 智能招聘 Agent\n'));
  console.log(`数据库: ${chalk.gray(db.name)}\n`);

  const args = process.argv.slice(2);
  const command = args[0];
  const channel = args[1] as Channel | undefined;

  if (command === 'run') {
    if (!channel || !CHANNELS.includes(channel)) {
      console.error(chalk.red(`渠道无效: "${channel ?? ''}"`));
      console.log(USAGE);
      process.exit(1);
    }

    await runChannel(channel);
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
