import { createRunner } from './runners';
import { loadActiveJob, jobToPrompt, getEnabledChannels } from './skills/loader';
import { loadWorkspaceFile } from './skills/loader';
import { db } from './db';
import type { Channel } from './types';

export interface ChannelPlan {
  channel: Channel;
  accountId: string;
  accountIndex: number;
  targetCount: number;
  strategy: string;
  priority: number;
  skipReason?: string;  // 如果跳过，记录原因
}

export interface ExecutionPlan {
  jobTitle: string;
  dailyGoal: number;
  totalTargetToday: number;
  channels: ChannelPlan[];
  estimatedDurationMin: number;
  reasoning: string;  // LLM 生成的策略解释
  createdAt: string;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  boss: 'BOSS直聘',
  maimai: '脉脉',
  linkedin: 'LinkedIn',
  followup: '跟进未回复',
};

/**
 * 生成今日执行计划
 * 使用 LLM 分析历史数据、职位要求、今日目标，生成最优执行策略
 */
export async function generatePlan(jobId: string = 'default'): Promise<ExecutionPlan> {
  const job = loadActiveJob();
  if (!job) {
    throw new Error('未找到 active.yaml 职位配置');
  }

  const enabledChannels = getEnabledChannels(job);
  const dailyGoal = job.daily_goal?.contact ?? 30;

  // 获取今日已触达数据
  const todayStats = enabledChannels.map(({ channel }) => {
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM candidates
      WHERE channel = ? AND job_id = ? AND date(contacted_at) = date('now')
    `).get(channel, jobId) as { count: number };

    return { channel, contacted: result.count };
  });

  // 获取最近 3 天的执行历史
  const recentRuns = db.prepare(`
    SELECT channel, contacted_count, skipped_count, status, started_at
    FROM task_runs
    WHERE job_id = ? AND date(started_at) >= date('now', '-3 days')
    ORDER BY started_at DESC
    LIMIT 10
  `).all(jobId);

  // 构建上下文给 LLM 分析
  const context = `
# 当前职位
${jobToPrompt(job)}

# 今日已触达情况
${todayStats.map(s => `- ${CHANNEL_LABEL[s.channel]}: 已触达 ${s.contacted} 人`).join('\n')}
今日总目标: ${dailyGoal} 人

# 最近 3 天执行历史
${recentRuns.map((r: any) =>
  `- ${CHANNEL_LABEL[r.channel as Channel]} (${r.started_at.split('T')[0]}): 触达 ${r.contacted_count} / 跳过 ${r.skipped_count} (${r.status})`
).join('\n') || '（暂无历史）'}

# 可用渠道和账号
${enabledChannels.map(({ channel, accounts }) =>
  `- ${CHANNEL_LABEL[channel]}: ${accounts} 个账号`
).join('\n')}
`;

  const planningPrompt = `
你是一个招聘执行规划师。请根据上述信息，为今天的 sourcing 任务制定执行计划。

要求：
1. 分析哪些渠道需要执行、优先级如何
2. 如果某个渠道今天已达目标或已执行过，可以跳过并说明原因
3. 为每个要执行的渠道设定目标触达人数（加起来达到日目标即可）
4. 给出筛选策略建议（基于历史跳过率和职位要求）
5. 预估总执行时间（分钟）

请严格按照以下 JSON 格式输出（只输出 JSON，不要其他内容）：

{
  "channels": [
    {
      "channel": "boss",
      "action": "execute",
      "targetCount": 20,
      "priority": 1,
      "strategy": "重点关注 3 年以上 AI 经验，985/211 优先",
      "reasoning": "历史数据显示 BOSS 质量较高，今日还需触达 20 人"
    },
    {
      "channel": "maimai",
      "action": "skip",
      "skipReason": "今日已触达 15 人，达到该渠道目标"
    }
  ],
  "estimatedDurationMin": 25,
  "overallStrategy": "总体策略和执行建议的总结"
}
`.trim();

  console.log('[Planner] 🧠 正在生成执行计划...\n');

  const runner = createRunner();
  const response = await runner.runSkill(
    null as any,  // 不需要 page
    context,
    planningPrompt
  );

  // 解析 LLM 返回的 JSON
  let planData: any;
  try {
    const jsonMatch = response.summary.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM 返回格式不正确');
    }
    planData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[Planner] ✗ 解析计划失败:', err);
    throw new Error('计划生成失败，请重试');
  }

  // 构建最终计划
  const channelPlans: ChannelPlan[] = [];
  let totalTarget = 0;

  for (const item of planData.channels) {
    const channelInfo = enabledChannels.find(c => c.channel === item.channel);
    if (!channelInfo) continue;

    if (item.action === 'skip') {
      channelPlans.push({
        channel: item.channel,
        accountId: '',
        accountIndex: 0,
        targetCount: 0,
        strategy: '',
        priority: 999,
        skipReason: item.skipReason,
      });
    } else {
      // 为每个账号创建一个计划项
      for (let i = 0; i < channelInfo.accounts; i++) {
        channelPlans.push({
          channel: item.channel,
          accountId: `${item.channel}_${i + 1}`,
          accountIndex: i,
          targetCount: Math.ceil(item.targetCount / channelInfo.accounts),
          strategy: item.strategy || '',
          priority: item.priority || 1,
        });
        totalTarget += Math.ceil(item.targetCount / channelInfo.accounts);
      }
    }
  }

  const plan: ExecutionPlan = {
    jobTitle: job.title,
    dailyGoal,
    totalTargetToday: totalTarget,
    channels: channelPlans,
    estimatedDurationMin: planData.estimatedDurationMin || 30,
    reasoning: planData.overallStrategy || '',
    createdAt: new Date().toISOString(),
  };

  return plan;
}

/**
 * 展示执行计划并等待用户确认
 * @returns true 表示确认执行，false 表示取消
 */
export async function confirmPlan(plan: ExecutionPlan): Promise<boolean> {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    📋 今日执行计划                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`职位：${plan.jobTitle}`);
  console.log(`今日目标：${plan.dailyGoal} 人  |  本次计划触达：${plan.totalTargetToday} 人`);
  console.log(`预计耗时：${plan.estimatedDurationMin} 分钟\n`);

  console.log('─────────────────────────────────────────────────────────────');
  console.log('策略思路：');
  console.log(plan.reasoning);
  console.log('─────────────────────────────────────────────────────────────\n');

  console.log('执行任务：\n');

  const executeChannels = plan.channels.filter(c => !c.skipReason);
  const skipChannels = plan.channels.filter(c => c.skipReason);

  // 按优先级排序
  executeChannels.sort((a, b) => a.priority - b.priority);

  if (executeChannels.length > 0) {
    executeChannels.forEach((c, idx) => {
      console.log(`  ${idx + 1}. ${CHANNEL_LABEL[c.channel]}[${c.accountIndex + 1}]`);
      console.log(`     目标: ${c.targetCount} 人  |  策略: ${c.strategy}`);
      console.log('');
    });
  }

  if (skipChannels.length > 0) {
    console.log('跳过任务：\n');
    skipChannels.forEach(c => {
      console.log(`  ⏭️  ${CHANNEL_LABEL[c.channel]}: ${c.skipReason}`);
    });
    console.log('');
  }

  console.log('─────────────────────────────────────────────────────────────');
  console.log('\n💡 确认执行此计划吗？');
  console.log('   [Enter] 确认执行  |  [n] 取消  |  [e] 编辑配置后重新生成\n');

  const answer = await new Promise<string>(resolve => {
    process.stdin.once('data', data => resolve(data.toString().trim().toLowerCase()));
  });

  if (answer === 'n' || answer === 'no') {
    console.log('\n[Planner] 已取消执行\n');
    return false;
  }

  if (answer === 'e' || answer === 'edit') {
    console.log('\n[Planner] 请修改 workspace/jobs/active.yaml，然后重新运行\n');
    return false;
  }

  console.log('\n[Planner] ✓ 计划已确认，开始执行...\n');
  return true;
}
