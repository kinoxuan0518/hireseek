import dayjs from 'dayjs';
import { getPage, createNewPage, createPageForAccount, saveAccountState } from './browser-runner';
import { createRunner } from './runners';
import { loadSkill, loadWorkspaceFile, loadActiveJob, jobToPrompt, getEnabledChannels } from './skills/loader';
import { sendReport } from './channels/feishu';
import { taskRunOps, reflectionOps, candidateOps, db } from './db';
import { buildMemoryContext, buildReflectionPrompt } from './memory';
import { emitLog, emitStatus } from './events';
import { getAccountId, hasStorageState } from './accounts';
import { generatePlan, confirmPlan } from './planner';
import { detectErrors } from './error-detector';
import { retryWithBackoff, saveCheckpoint, loadCheckpoint, removeCheckpoint, waitForUserIntervention } from './retry-handler';
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
  emitLog(`▶ 开始 ${label} sourcing`);
  emitStatus('running');

  const startedAt = dayjs().toISOString();
  const runResult = taskRunOps.start.run({ job_id: jobId, channel, started_at: startedAt });
  const runId = runResult.lastInsertRowid as number;
  const startMs = Date.now();

  try {
    const page = await getPage();

    // 导航到对应招聘平台
    await page.goto(CHANNEL_URL[channel], { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 登录检测：检查是否成功进入目标页（而非被重定向到其他页面）
    const currentUrl = page.url();
    const targetUrl = CHANNEL_URL[channel];
    const isOnTargetPage = currentUrl.startsWith(targetUrl) || currentUrl.includes(new URL(targetUrl).pathname);
    if (!isOnTargetPage) {
      console.log(`\n[HireClaw] ⚠️  未能进入目标页（当前：${currentUrl}）`);
      console.log('[HireClaw] 请在浏览器窗口中完成登录，登录完成后按 Enter 继续...');
      await new Promise<void>(resolve => {
        process.stdin.once('data', () => resolve());
      });
      // 登录后再跳转到目标页
      await page.goto(CHANNEL_URL[channel], { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // 组装系统提示：SOUL + 职位上下文 + 记忆 + Skill
    const soul      = loadWorkspaceFile('SOUL.md');
    const job       = loadActiveJob();
    const jobCtx    = job ? jobToPrompt(job) : '';
    const wisdom     = loadWorkspaceFile('references/founders-wisdom.md');
    const evaluation = loadWorkspaceFile('references/candidate-evaluation.md');
    const outreach   = loadWorkspaceFile('references/outreach-guide.md');
    const memory    = buildMemoryContext(channel, jobId);
    const skill     = loadSkill(channel);
    const systemPrompt = [soul, jobCtx, wisdom, evaluation, outreach, memory, '---', skill].filter(Boolean).join('\n\n');

    const runner = createRunner();
    const result = await runner.runSkill(
      page,
      systemPrompt,
      TASK_PROMPT(label),
      (msg) => process.stdout.write(`\r  ${msg}`.padEnd(80))
    );

    const durationSec = Math.round((Date.now() - startMs) / 1000);

    console.log(`\n[Orchestrator] ✓ ${label} 完成 (${durationSec}s)`);
    emitLog(`✓ ${label} 完成 (${durationSec}s)`);
    emitStatus('idle');

    taskRunOps.complete.run({
      id: runId,
      finished_at: dayjs().toISOString(),
      status: 'completed',
      contacted_count: result.contacted,
      skipped_count: result.skipped,
      error: null,
    });

    // 生成反思并存储
    try {
      const reflectionPrompt = buildReflectionPrompt(label, result.contacted, result.skipped, result.summary);
      const runner = createRunner();
      const reflectionResult = await runner.runSkill(
        await getPage(),
        '你是一个正在学习成长的招聘助手，请认真反思自己的执行过程。',
        reflectionPrompt,
      );
      reflectionOps.save.run({ job_id: jobId, channel, run_id: runId, content: reflectionResult.summary });
      console.log(`[Orchestrator] 💭 反思已记录`);
    } catch {
      // 反思失败不影响主流程
    }

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
    emitLog(`✗ ${label} 失败: ${error}`);
    emitStatus('idle');

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

/**
 * 扫描 BOSS 收件箱，检测回复并更新候选人状态。
 */
export async function scanInbox(jobId: string = 'default'): Promise<void> {
  console.log('\n[Scanner] 🔍 开始扫描收件箱...');
  const page = await getPage();
  await page.goto('https://www.zhipin.com/web/im/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const currentUrl = page.url();
  if (!currentUrl.includes('zhipin.com/web')) {
    console.log('\n[HireClaw] ⚠️  请先登录 BOSS直聘，登录完成后按 Enter 继续...');
    await new Promise<void>(resolve => { process.stdin.once('data', () => resolve()); });
    await page.goto('https://www.zhipin.com/web/im/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  const soul  = loadWorkspaceFile('SOUL.md');
  const skill = loadWorkspaceFile('skills/scan.md');
  const systemPrompt = [soul, skill].filter(Boolean).join('\n\n');

  const runner = createRunner();
  const result = await runner.runSkill(
    page,
    systemPrompt,
    '请扫描收件箱，找出所有已回复的候选人，按格式输出名单。',
    (msg) => process.stdout.write(`\r  ${msg}`.padEnd(80))
  );

  // 解析回复名单
  const repliedNames: string[] = [];
  const lines = result.summary.split('\n');
  let inList = false;
  for (const line of lines) {
    if (line.includes('已回复候选人')) { inList = true; continue; }
    if (inList && line.startsWith('- ')) {
      const name = line.replace(/^-\s+/, '').trim();
      if (name && name !== '（无）') repliedNames.push(name);
    }
    if (inList && line.trim() === '') inList = false;
  }

  // 批量更新状态
  let updated = 0;
  for (const name of repliedNames) {
    const matches = candidateOps.findByName.all(`%${name}%`) as any[];
    for (const c of matches) {
      if (c.status === 'contacted') {
        candidateOps.updateStatus.run({ status: 'replied', id: c.id });
        updated++;
        console.log(`\n[Scanner] ✓ ${c.name} → 已回复`);
      }
    }
  }

  console.log(`\n[Scanner] 完成：检测到 ${repliedNames.length} 人回复，更新 ${updated} 条记录`);
}

/**
 * 自主模式：读取 active job，决定今天跑哪些渠道，按顺序执行。
 * 判断逻辑：
 * - 今天已跑过的渠道跳过
 * - 日触达量已达目标的渠道跳过
 * - 按 job.channels 顺序执行剩余渠道
 *
 * @param usePlan 是否使用计划模式（先分析、用户确认、再执行）
 */
export async function runJob(usePlan: boolean = false): Promise<void> {
  const job = loadActiveJob();
  if (!job) {
    console.error('[Orchestrator] 未找到 workspace/jobs/active.yaml，请先配置职位');
    return;
  }

  const jobId = job.title.replace(/\s+/g, '_');
  const enabledChannels = getEnabledChannels(job);
  const dailyGoal = job.daily_goal?.contact ?? 30;

  if (enabledChannels.length === 0) {
    console.error('[Orchestrator] 未配置任何启用的渠道，请在 active.yaml 中设置');
    return;
  }

  // 计划模式：先分析、用户确认、再执行
  if (usePlan) {
    const plan = await generatePlan(jobId);
    const confirmed = await confirmPlan(plan);

    if (!confirmed) {
      return;
    }

    // 根据计划筛选要执行的任务
    const plannedTasks = plan.channels
      .filter(c => !c.skipReason)
      .map(c => ({
        channel: c.channel,
        accountIndex: c.accountIndex,
        accountId: c.accountId,
        page: null as any,
      }));

    if (plannedTasks.length === 0) {
      console.log('[Orchestrator] 📭 今日无需执行任务');
      return;
    }

    // 执行计划任务（复用下面的执行逻辑）
    await executeTasks(plannedTasks, jobId);
    return;
  }

  console.log(`\n🦞 HireClaw 并行模式`);
  console.log(`职位：${job.title}  |  今日目标：${dailyGoal} 人`);

  // 构建任务列表（每个账号一个任务）
  const tasks: Array<{ channel: Channel; accountIndex: number; accountId: string; page: any }> = [];
  for (const { channel, accounts } of enabledChannels) {
    for (let i = 0; i < accounts; i++) {
      const accountId = getAccountId(channel, i);
      tasks.push({ channel, accountIndex: i, accountId, page: null });
    }
  }

  console.log(`并行任务：${tasks.map(t => `${CHANNEL_LABEL[t.channel]}[${t.accountIndex + 1}]`).join(' | ')}\n`);

  // 执行任务
  await executeTasks(tasks, jobId);
}

/**
 * 执行任务列表（计划模式和普通模式共用）
 */
async function executeTasks(
  tasks: Array<{ channel: Channel; accountIndex: number; accountId: string; page: any }>,
  jobId: string
): Promise<void> {
  // 登录引导：检查并引导用户登录每个账号
  const loggedInAccounts = await ensureAccountsLoggedIn(tasks);

  // 过滤出已登录的任务
  const activeTasks = tasks.filter(t => loggedInAccounts.has(t.accountId));

  if (activeTasks.length === 0) {
    console.log('[Orchestrator] ⚠️  没有可用的已登录账号，退出');
    return;
  }

  console.log(`\n[Orchestrator] 📋 实际并行任务：${activeTasks.map(t => `${CHANNEL_LABEL[t.channel]}[${t.accountIndex + 1}]`).join(' | ')}\n`);

  // 为每个任务创建独立的标签页（带有对应账号的登录状态）
  for (const task of activeTasks) {
    task.page = await createPageForAccount(task.accountId);
  }

  // 并行执行所有任务
  const results = await Promise.allSettled(
    activeTasks.map(async ({ channel, accountIndex, page }) => {
      const label = `${CHANNEL_LABEL[channel]}[${accountIndex + 1}]`;

      // 检查今天是否已跑过（同一渠道的所有账号共享此检查）
      if (accountIndex === 0) {
        const alreadyRan = db.prepare(`
          SELECT id FROM task_runs
          WHERE channel = ? AND job_id = ? AND date(started_at) = date('now') AND status = 'completed'
        `).get(channel, jobId);

        if (alreadyRan) {
          console.log(`[Orchestrator] ⏭  ${label} 今天已执行，跳过`);
          return;
        }

        // 检查今日触达量
        const job = loadActiveJob();
        const dailyGoal = job?.daily_goal?.contact ?? 30;
        const todayCount = (db.prepare(`
          SELECT COUNT(*) as n FROM candidates
          WHERE channel = ? AND job_id = ? AND date(contacted_at) = date('now')
        `).get(channel, jobId) as { n: number }).n;

        if (todayCount >= dailyGoal) {
          console.log(`[Orchestrator] ✅ ${label} 今日已触达 ${todayCount} 人，目标达成，跳过`);
          return;
        }
      }

      // 执行任务（使用独立的 page）
      console.log(`[Orchestrator] 🚀 启动 ${label}`);
      const accountId = getAccountId(channel, accountIndex);
      await runChannelWithPage(channel, jobId, page, accountId);
    })
  );

  // 汇总结果
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`\n[Orchestrator] 并行执行完毕：成功 ${succeeded} / 失败 ${failed}`);
}

/** 使用指定 page 执行渠道任务（用于并行） */
async function runChannelWithPage(channel: Channel, jobId: string, page: any, accountId?: string): Promise<void> {
  // 这里复用 runChannel 的逻辑，但用指定的 page
  const label = CHANNEL_LABEL[channel];
  const startedAt = dayjs().toISOString();
  const runResult = taskRunOps.start.run({ job_id: jobId, channel, started_at: startedAt });
  const runId = runResult.lastInsertRowid as number;
  const startMs = Date.now();

  // 生成账号 ID（用于检查点）
  const checkpointAccountId = accountId || `${channel}_1`;

  // 检查是否有未完成的检查点
  const checkpoint = loadCheckpoint(jobId, channel, checkpointAccountId);
  if (checkpoint && checkpoint.status === 'in_progress') {
    console.log(`\n[Recovery] 📂 发现未完成的任务，继续执行...`);
    console.log(`  已完成：${checkpoint.contactedCandidates.length} 人`);
  }

  try {
    // 导航到对应招聘平台
    await page.goto(CHANNEL_URL[channel], { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 登录检测
    const currentUrl = page.url();
    const targetHost = new URL(CHANNEL_URL[channel]).host;
    const isLoggedIn = currentUrl.includes(targetHost);

    if (!isLoggedIn) {
      console.error(`\n[Orchestrator] ✗ ${label} 未登录，请先在浏览器登录 ${CHANNEL_URL[channel]}`);
      taskRunOps.complete.run({
        id: runId,
        finished_at: dayjs().toISOString(),
        status: 'failed',
        contacted_count: 0,
        skipped_count: 0,
        error: '未登录',
      });
      return;
    }

    // 构建 prompt
    const job = loadActiveJob();
    const soul = loadWorkspaceFile('SOUL.md');
    const skillContent = loadSkill(channel);
    const evaluationDoc = loadWorkspaceFile('references/candidate-evaluation.md');
    const outreachDoc = loadWorkspaceFile('references/outreach-guide.md');
    const wisdomDoc = loadWorkspaceFile('references/founders-wisdom.md');
    const jobContext = job ? jobToPrompt(job) : '';
    const memory = buildMemoryContext(channel, jobId);

    const systemPrompt = [soul, jobContext, evaluationDoc, outreachDoc, wisdomDoc, memory, skillContent]
      .filter(Boolean)
      .join('\n\n---\n\n');

    const runner = createRunner();

    // 带错误恢复的执行
    const result = await retryWithBackoff(
      async () => {
        // 执行前检测错误
        const errorBefore = await detectErrors(page, channel);
        if (errorBefore.detected) {
          console.log(`\n[Recovery] 检测到问题：${errorBefore.message}`);

          if (errorBefore.type === 'captcha' || errorBefore.type === 'login_expired') {
            // 需要用户介入
            await waitForUserIntervention(errorBefore.suggestedAction!);
          } else if (errorBefore.type === 'rate_limit') {
            // 触达限制，直接结束
            throw new Error('触达限制：' + errorBefore.message);
          } else if (errorBefore.type === 'network_error') {
            // 网络错误，等待后重试
            console.log('[Recovery] 网络错误，等待 5 秒后重试...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        // 执行任务
        return await runner.runSkill(page, systemPrompt, TASK_PROMPT(label), (msg) => {
          console.log(`[${label}] ${msg}`);
          emitLog(`[${label}] ${msg}`);
        });
      },
      {
        maxRetries: 2,
        initialDelayMs: 3000,
        shouldRetry: (error: any) => {
          // 网络错误可以重试，触达限制不重试
          const message = error.message || '';
          return !message.includes('触达限制');
        },
      }
    );

    const durationSec = Math.round((Date.now() - startMs) / 1000);
    console.log(`\n[Orchestrator] ✓ ${label} 完成 (${durationSec}s)`);
    emitLog(`✓ ${label} 完成 (${durationSec}s)`);

    taskRunOps.complete.run({
      id: runId,
      finished_at: dayjs().toISOString(),
      status: 'completed',
      contacted_count: result.contacted,
      skipped_count: result.skipped,
      error: null,
    });

    // 删除检查点（任务已完成）
    removeCheckpoint(jobId, channel, checkpointAccountId);

    // 生成反思
    const reflectionPrompt = buildReflectionPrompt(channel, result.contacted, result.skipped, result.summary);
    try {
      const reflectionRunner = createRunner();
      const reflection = await reflectionRunner.runSkill(page, '', reflectionPrompt, () => {});
      reflectionOps.save.run({ job_id: jobId, channel, run_id: runId, content: reflection.summary });
    } catch {
      // 反思生成失败不影响主流程
    }

  } catch (err: any) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`\n[Orchestrator] ✗ ${label} 失败: ${error}`);
    emitLog(`✗ ${label} 失败: ${error}`);

    // 保存检查点（可选恢复）
    if (!error.includes('触达限制')) {
      saveCheckpoint({
        jobId,
        channel,
        accountId: checkpointAccountId,
        contactedCandidates: [],  // TODO: 从 result 中提取
        currentPosition: 0,
        timestamp: new Date().toISOString(),
        status: 'error',
        errorMessage: error,
      });
      console.log('[Recovery] 💾 已保存执行状态，可以稍后继续');
    }

    taskRunOps.complete.run({
      id: runId,
      finished_at: dayjs().toISOString(),
      status: 'failed',
      contacted_count: 0,
      skipped_count: 0,
      error,
    });
  }
}

/**
 * 确保所有账号都已登录
 * 对于没有保存登录状态的账号，依次引导用户登录
 * @returns 已登录的账号 ID 集合
 */
async function ensureAccountsLoggedIn(
  tasks: Array<{ channel: Channel; accountIndex: number; accountId: string; page: any }>
): Promise<Set<string>> {
  const loggedInAccounts = new Set<string>();

  // 先添加所有已有登录状态的账号
  for (const task of tasks) {
    if (hasStorageState(task.accountId)) {
      loggedInAccounts.add(task.accountId);
    }
  }

  const needsLogin = tasks.filter(t => !hasStorageState(t.accountId));

  if (needsLogin.length === 0) {
    console.log('[Accounts] ✓ 所有账号均已登录\n');
    return loggedInAccounts;
  }

  console.log(`\n[Accounts] 🔐 检测到 ${needsLogin.length} 个账号需要登录，开始引导...\n`);

  for (const task of needsLogin) {
    const label = `${CHANNEL_LABEL[task.channel]}[${task.accountIndex + 1}]`;
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`正在配置账号：${label} (${task.accountId})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // 如果是同一渠道的第 2+ 个账号，提示用户可以跳过
    if (task.accountIndex > 0) {
      console.log(`💡 提示：这是 ${CHANNEL_LABEL[task.channel]} 的第 ${task.accountIndex + 1} 个账号`);
      console.log(`   如果你只有 1 个账号，输入 'skip' 并按 Enter 跳过`);
      console.log(`   如果有多个账号，直接按 Enter 继续配置\n`);

      const skipCheck = await new Promise<string>(resolve => {
        process.stdin.once('data', (data) => resolve(data.toString().trim().toLowerCase()));
      });

      if (skipCheck === 'skip' || skipCheck === 's') {
        console.log(`[Accounts] ⏭️  已跳过 ${label}\n`);
        continue;
      }
    }

    // 创建该账号的专属页面
    const page = await createPageForAccount(task.accountId);

    // 导航到登录页
    const loginUrl = CHANNEL_URL[task.channel];
    console.log(`[Accounts] 📍 正在打开 ${loginUrl}...`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待用户登录
    console.log(`\n⏳ 请在浏览器中完成 ${label} 的登录`);
    console.log(`   ⚠️  请使用不同的账号登录（如果是第 2+ 个账号）`);
    console.log(`   登录完成后，按 Enter 继续...\n`);

    await new Promise<void>(resolve => {
      process.stdin.once('data', () => resolve());
    });

    // 保存登录状态
    await saveAccountState(task.accountId);
    loggedInAccounts.add(task.accountId);
    console.log(`[Accounts] ✓ ${label} 登录成功\n`);

    // 关闭临时页面
    await page.close();
  }

  console.log(`[Accounts] 🎉 账号登录配置完成！实际可用账号：${loggedInAccounts.size} 个\n`);
  return loggedInAccounts;
}
