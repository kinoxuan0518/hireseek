import axios from 'axios';
import { config } from '../config';

export async function sendMessage(text: string): Promise<void> {
  if (!config.feishu.webhookUrl) {
    // 未配置时只打印到终端
    console.log('\n─────────────────────────────────');
    console.log(text);
    console.log('─────────────────────────────────\n');
    return;
  }

  try {
    await axios.post(config.feishu.webhookUrl, {
      msg_type: 'text',
      content: { text },
    });
  } catch (err) {
    console.error('[飞书] 推送失败:', err instanceof Error ? err.message : err);
  }
}

export async function sendReport(report: {
  channel: string;
  contacted: number;
  skipped: number;
  summary: string;
  durationSec: number;
}): Promise<void> {
  const channelLabel: Record<string, string> = {
    boss: 'BOSS直聘',
    maimai: '脉脉',
    linkedin: 'LinkedIn',
  };

  const lines = [
    `🦞 HireClaw 执行完成`,
    `渠道：${channelLabel[report.channel] ?? report.channel}`,
    `触达：${report.contacted} 人`,
    `跳过：${report.skipped} 人`,
    `耗时：${report.durationSec}s`,
    `──────────────`,
    report.summary || '（无摘要）',
  ];

  await sendMessage(lines.join('\n'));
}
