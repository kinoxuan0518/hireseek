/**
 * 通知模块：主动推送消息到用户。
 * 优先用 macOS 系统通知，可选飞书 webhook。
 */

import { exec } from 'child_process';
import { sendMessage as feishuSend } from './channels/feishu';
import { config } from './config';

export async function notify(title: string, body: string): Promise<void> {
  // macOS 系统通知
  const escaped = body.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const titleEsc = title.replace(/"/g, '\\"');
  exec(`osascript -e 'display notification "${escaped}" with title "${titleEsc}" sound name "Ping"'`);

  // 飞书双向 Bot 主动推送（守护进程内运行时，优先走 Bot，能在飞书里直接对话跟进）
  let pushedViaBot = false;
  if (config.feishu.bot.enabled && config.feishu.bot.notifyChatId) {
    try {
      const { pushToBot } = await import('./channels/feishu-bot');
      pushedViaBot = await pushToBot(`${title}\n${body}`);
    } catch { /* Bot 未启动则回退 webhook */ }
  }

  // 飞书 webhook（未走 Bot 且配置了 webhook 时）
  if (!pushedViaBot && config.feishu.webhookUrl) {
    await feishuSend(`${title}\n${body}`).catch(() => {});
  }

  console.log(`\n🔔 ${title}\n   ${body}\n`);
}
