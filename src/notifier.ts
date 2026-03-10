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

  // 飞书（如果配置了 webhook）
  if (config.feishu.webhookUrl) {
    await feishuSend(`${title}\n${body}`).catch(() => {});
  }

  console.log(`\n🔔 ${title}\n   ${body}\n`);
}
