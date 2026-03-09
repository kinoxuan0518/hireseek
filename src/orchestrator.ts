import dayjs from 'dayjs';
import { getPage } from './browser-runner';
import { createRunner } from './runners';
import { loadSkill, loadWorkspaceFile } from './skills/loader';
import { sendReport } from './channels/feishu';
import { taskRunOps } from './db';
import type { Channel } from './types';

const TASK_PROMPT = (channelLabel: string) => `
请开始执行 ${channelLabel} 的招聘 sourcing 任务。

任务完成后，请严格按照以下格式输出总结（每行一项）：
触达人数: <数字>
跳过人数: <数字>
主要跳过原因: <简短描述>
候选人摘要: <简短描述，如"5人来自大厂，3人学历985">
`.trim();

const CHANNEL_LABEL: Record<Channel, string> = {
  boss:     'BOSS直聘',
  maimai:   '脉脉',
  linkedin: 'LinkedIn',
  followup: '跟进未回复',
};

const CHANNEL_URL: Record<Channel, string> = {
  boss:     'https://www.zhipin.com/web/employer/talent/recommend',
  maimai:   'https://maimai.cn/ent/v41/recruit/talents?tab=1',
  linkedin: 'https://www.linkedin.com/talent/hire',
  followup: 'https://www.zhipin.com/web/im/',
};

export async function runChannel(
  channel: Channel,
  jobId: string = 'default'
): Promise<void> {
  const label = CHANNEL_LABEL[channel];
  console.log(`\n[Orchestrator] ▶ 开始 ${label} sourcing`);

  const startedAt = dayjs().toISOString();
  const runResult = taskRunOps.start.run({ job_id: jobId, channel, started_at: startedAt });
  const runId = runResult.lastInsertRowid as number;
  const startMs = Date.now();

  try {
    const page = await getPage();

    // 导航到对应招聘平台
    await page.goto(CHANNEL_URL[channel], { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 组装系统提示：SOUL + Skill
    const soul = loadWorkspaceFile('SOUL.md');
    const skill = loadSkill(channel);
    const systemPrompt = [soul, '---', skill].filter(Boolean).join('\n\n');

    const runner = createRunner();
    const result = await runner.runSkill(
      page,
      systemPrompt,
      TASK_PROMPT(label),
      (msg) => process.stdout.write(`\r  ${msg}`.padEnd(80))
    );

    const durationSec = Math.round((Date.now() - startMs) / 1000);

    console.log(`\n[Orchestrator] ✓ ${label} 完成 (${durationSec}s)`);

    taskRunOps.complete.run({
      id: runId,
      finished_at: dayjs().toISOString(),
      status: 'completed',
      contacted_count: result.contacted,
      skipped_count: result.skipped,
      error: null,
    });

    await sendReport({
      channel,
      contacted: result.contacted,
      skipped: result.skipped,
      summary: result.summary,
      durationSec,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`\n[Orchestrator] ✗ ${label} 失败: ${error}`);

    taskRunOps.complete.run({
      id: runId,
      finished_at: dayjs().toISOString(),
      status: 'failed',
      contacted_count: 0,
      skipped_count: 0,
      error,
    });

    await sendReport({
      channel,
      contacted: 0,
      skipped: 0,
      summary: `执行失败: ${error}`,
      durationSec: Math.round((Date.now() - startMs) / 1000),
    });
  }
}
