/**
 * HireSeek 常驻守护进程
 *
 * 一个进程整合三件事，让 HireSeek 真正"住下来"而不是开终端才活着：
 *   1. 定时调度器（startScheduler）—— BOSS / 脉脉 / 跟进 / 心跳 / 每周进化的 cron
 *   2. 飞书双向 Bot（startFeishuBot）—— 手机上发一句话就能指挥它
 *   3. 主动通知出口 —— 心跳/调度/后台任务结果经飞书 Bot 推送
 *
 * 用 launchd 托管：开机自启、崩溃自拉起、日志落 ~/.hireseek/daemon.log。
 *
 *   hireseek daemon run        前台运行（launchd 调用的就是这个）
 *   hireseek daemon install    安装 launchd 开机自启服务
 *   hireseek daemon uninstall  卸载服务
 *   hireseek daemon status     查看服务运行状态
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { config } from './config';

const LABEL = 'com.hireseek.daemon';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), '.hireseek');
const LOG_PATH = path.join(LOG_DIR, 'daemon.log');

// ── 前台运行：拉起调度器 + 飞书 Bot，常驻不退 ─────────────────────────
export async function runDaemon(): Promise<void> {
  console.log(chalk.green('🔱 HireSeek 守护进程启动'));
  console.log(chalk.gray(`   时间：${new Date().toLocaleString('zh-CN')}`));

  // 1. 定时调度（含心跳、每周进化）
  const { startScheduler } = await import('./scheduler');
  console.log(chalk.cyan('\n⏰ 定时调度：'));
  startScheduler();

  // 2. 网页指挥台 —— 守护进程的"脸"：零配置、零终端就能看见它、指挥它
  console.log(chalk.cyan('\n🖥  网页指挥台：'));
  try {
    const { startWebConsole } = await import('./web-console');
    // 守护进程常驻后台，不抢用户焦点，默认不自动弹浏览器（首次安装时由 install 引导）
    startWebConsole({ openBrowser: process.env.HIRESEEK_CONSOLE_OPEN === 'true' });
  } catch (err) {
    console.error(chalk.red('   指挥台启动失败：'), err instanceof Error ? err.message : err);
  }

  // 3. 飞书双向 Bot（可选）
  if (config.feishu.bot.enabled) {
    console.log(chalk.cyan('\n💬 飞书 Bot：'));
    try {
      const { startFeishuBot } = await import('./channels/feishu-bot');
      await startFeishuBot();
    } catch (err) {
      console.error(chalk.red('   飞书 Bot 启动失败：'), err instanceof Error ? err.message : err);
    }
  } else {
    console.log(chalk.gray('\n💬 飞书 Bot：未启用（设 FEISHU_BOT_ENABLED=true 开启）'));
  }

  console.log(chalk.green('\n✓ 守护进程就绪，常驻运行中\n'));

  // 优雅退出
  const shutdown = () => {
    console.log(chalk.gray('\n[HireSeek] 守护进程退出'));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 永不主动退出（cron + 长连接持有事件循环；兜底再加一个 keep-alive）
  setInterval(() => {}, 1 << 30);
}

// ── launchd plist 生成 ─────────────────────────────────────────────────
function resolveRuntime(): { node: string; tsx: string; entry: string } {
  const projectRoot = path.join(__dirname, '..');
  const entry = path.join(projectRoot, 'src', 'index.ts');
  const tsx = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
  // 优先用启动 daemon 的同一个 node 可执行文件
  const node = process.execPath;
  return { node, tsx, entry };
}

function buildPlist(): string {
  const { node, tsx, entry } = resolveRuntime();
  const projectRoot = path.join(__dirname, '..');

  // 把当前进程的关键环境变量带进 launchd（API key 等），launchd 不读 shell profile
  const envKeys = [
    'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
    'ANTHROPIC_API_KEY', 'CUSTOM_API_KEY', 'CUSTOM_BASE_URL',
    'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_WEBHOOK_URL',
    'FEISHU_BOT_ENABLED', 'FEISHU_BOT_ALLOW_USERS', 'FEISHU_BOT_NOTIFY_CHAT_ID',
    'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_BITABLE_TABLE_ID',
  ];
  const envEntries = envKeys
    .filter(k => process.env[k])
    .map(k => `    <key>${k}</key>\n    <string>${escapeXml(process.env[k]!)}</string>`)
    .join('\n');

  // PATH 也带上，保证子进程能找到 node / git
  const pathVar = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${tsx}</string>
    <string>${entry}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(pathVar)}</string>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isLoaded(): boolean {
  try {
    const out = execSync(`launchctl list ${LABEL}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.includes(LABEL) || out.includes('PID');
  } catch {
    return false;
  }
}

// ── install / uninstall / status ───────────────────────────────────────
export function installDaemon(): void {
  if (!process.env.DEEPSEEK_API_KEY && !config.deepseek.apiKey) {
    console.log(chalk.yellow('⚠️  当前 shell 没有 DEEPSEEK_API_KEY 环境变量。'));
    console.log(chalk.gray('   launchd 不读 shell 配置，请先 export 好 key 再安装，否则守护进程拿不到 key。\n'));
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });

  if (isLoaded()) {
    try { execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' }); } catch { /* 可能未加载 */ }
  }

  fs.writeFileSync(PLIST_PATH, buildPlist(), 'utf-8');
  execSync(`launchctl load "${PLIST_PATH}"`);

  console.log(chalk.green('\n✓ HireSeek 守护进程已安装为开机自启服务'));
  console.log(chalk.gray(`   plist：${PLIST_PATH}`));
  console.log(chalk.gray(`   日志：${LOG_PATH}`));
  console.log(chalk.gray('   现在它会随登录自启、崩溃自拉起。'));
  console.log(chalk.cyan('\n   👉 打开指挥台就能看见它、指挥它：http://localhost:7799'));
  console.log(chalk.gray('   查看状态：hireseek daemon status'));
  console.log(chalk.gray(`   看日志：tail -f ${LOG_PATH}\n`));

  // 安装完顺手打开指挥台，让用户立刻"看见它活着"
  setTimeout(() => { try { execSync('open http://localhost:7799'); } catch { /* 无浏览器忽略 */ } }, 1500);
}

export function uninstallDaemon(): void {
  if (fs.existsSync(PLIST_PATH)) {
    try { execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' }); } catch { /* 可能未加载 */ }
    fs.unlinkSync(PLIST_PATH);
    console.log(chalk.green('\n✓ 已卸载 HireSeek 守护进程服务\n'));
  } else {
    console.log(chalk.yellow('\n守护进程服务未安装\n'));
  }
}

export function daemonStatus(): void {
  console.log(chalk.cyan('\n🔱 HireSeek 守护进程状态\n'));
  const installed = fs.existsSync(PLIST_PATH);
  console.log(`  服务已安装：${installed ? chalk.green('是') : chalk.gray('否')}`);
  if (installed) {
    console.log(`  plist：${chalk.gray(PLIST_PATH)}`);
    const loaded = isLoaded();
    console.log(`  正在运行：${loaded ? chalk.green('是') : chalk.red('否')}`);
    if (fs.existsSync(LOG_PATH)) {
      const size = (fs.statSync(LOG_PATH).size / 1024).toFixed(1);
      console.log(`  日志：${chalk.gray(LOG_PATH)}（${size} KB）`);
      try {
        const tail = execSync(`tail -n 5 "${LOG_PATH}"`).toString().trim();
        if (tail) {
          console.log(chalk.gray('\n  最近日志：'));
          tail.split('\n').forEach(l => console.log(chalk.gray(`    ${l}`)));
        }
      } catch { /* 读日志失败忽略 */ }
    }
  }
  console.log(`  飞书 Bot：${config.feishu.bot.enabled ? chalk.green('已启用') : chalk.gray('未启用')}`);
  console.log('');
}
