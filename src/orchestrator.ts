import dayjs from 'dayjs';
import type { Page } from 'playwright';
import { getPage, createNewPage, createPageForAccount, saveAccountState } from './browser-runner';
import { config } from './config';
import type { BrowserTarget } from './browser-session';
import { isDomBrowserSession } from './browser-session';
import { connectRealChrome } from './real-chrome-session';
import { createRunner } from './runners';
import { loadSkill, loadWorkspaceFile, jobToPrompt, getEnabledChannels, type JobConfig } from './skills/loader';
import { sendReport } from './channels/feishu';
import { taskRunOps, reflectionOps, candidateOps, db } from './db';
import { buildMemoryContext, buildReflectionPrompt } from './memory';
import { emitLog, emitStatus } from './events';
import { getAccountId, hasStorageState } from './accounts';
import { generatePlan, confirmPlan } from './planner';
import { detectErrors } from './error-detector';
import { retryWithBackoff, saveCheckpoint, loadCheckpoint, removeCheckpoint, waitForUserIntervention } from './retry-handler';
import type { Channel, SkillResult } from './types';
import { createRuntimeContext } from './agent-core/runtime-context';
import { getPlatformProtocol } from './platform-protocols';
import { buildRecruitingCapabilityContext } from './capabilities';
import type { RunSkillOptions } from './runners/interface';
import { saveRunTrace } from './agent-core/run-trace-store';

type ChannelRunMode = 'execute' | 'dry_run' | 'prepare';

/**
 * 履约 canonical 契约 boss-greeting.v1 的 writes: [contacted_candidates, run_trace, interaction_log]。
 * 三样产物都按 runId 落库，让 verifier/compliance 能按 runId 审【本轮】。
 */
export function persistRunResult(
  runId: number,
  jobId: string,
  channel: Channel,
  result: SkillResult,
  opts: { mode?: ChannelRunMode } = {},
): void {
  // 非 execute 模式只保留过程轨迹。即便模型总结被误解析成候选人，也不能污染主档、
  // run_candidates 或 interaction_log。
  const list = opts.mode && opts.mode !== 'execute' ? [] : result.contactedList ?? [];
  const now = dayjs().toISOString();

  // ① 结构化候选人落库：主档 upsert + run 级快照（fingerprint = 姓名|公司|渠道）
  try {
    const runCandStmt = db.prepare(`
      INSERT INTO run_candidates
        (run_id, candidate_fingerprint, job_id, channel, score, evidence, personalization_evidence, message_intent, risk_flags, fit_tags, greeting_text, profile_url, contacted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, candidate_fingerprint) DO UPDATE SET
        score = excluded.score,
        evidence = excluded.evidence,
        personalization_evidence = excluded.personalization_evidence,
        message_intent = excluded.message_intent,
        risk_flags = excluded.risk_flags,
        fit_tags = excluded.fit_tags,
        greeting_text = excluded.greeting_text,
        profile_url = excluded.profile_url,
        contacted_at = excluded.contacted_at
    `);

    for (const c of list) {
      if (!c.name || c.greetingSent === false) continue;
      const fingerprint = `${c.name}|${c.company ?? ''}|${channel}`;
      // better-sqlite3 命名参数需要 null（不接受 undefined），故缺失字段显式给 null
      candidateOps.upsert.run({
        fingerprint,
        name: c.name,
        school: null,
        company: c.company ?? null,
        channel,
        job_id: jobId,
        status: 'contacted',
        score: c.score ?? null,
        run_id: runId,
        contacted_at: now,
      } as unknown as Parameters<typeof candidateOps.upsert.run>[0]);

      runCandStmt.run(
        runId,
        fingerprint,
        jobId,
        channel,
        c.score ?? null,
        c.evidence ?? c.reason ?? null,
        c.personalizationEvidence ?? null,
        c.messageIntent ?? null,
        c.riskFlags?.length ? JSON.stringify(c.riskFlags) : null,
        c.fitTags?.length ? JSON.stringify(c.fitTags) : null,
        c.greetingText ?? null,
        c.profileUrl ?? null,
        now,
      );
    }
  } catch (err) {
    emitLog(`⚠️ 候选人落库失败（不影响任务）：${err instanceof Error ? err.message : err}`);
  }

  // ② 交互记录落库（每个实际打了招呼的候选人一条；供合规验证器查群发感）
  try {
    const logStmt = db.prepare(
      `INSERT INTO interaction_log (run_id, candidate_fingerprint, action, note) VALUES (?, ?, ?, ?)`,
    );
    for (const c of list) {
      if (!c.name || c.greetingSent === false) continue;
      const fingerprint = `${c.name}|${c.company ?? ''}|${channel}`;
      const note = [
        c.greetingText ? `message=${c.greetingText}` : '',
        c.personalizationEvidence ? `personalization=${c.personalizationEvidence}` : '',
        c.messageIntent ? `intent=${c.messageIntent}` : '',
        c.evidence || c.reason ? `evidence=${c.evidence ?? c.reason}` : '',
        c.riskFlags?.length ? `risk=${c.riskFlags.join(',')}` : '',
      ].filter(Boolean).join(' | ').slice(0, 600);
      logStmt.run(runId, fingerprint, 'greeting', note);
    }
  } catch { /* 交互记录失败不影响主流程 */ }

  // ③ 执行轨迹落库
  try {
    saveRunTrace(runId, jobId, channel, result.trace ?? []);
  } catch { /* 轨迹落库失败不影响主流程 */ }
}

export function normalizeResultForRunMode(
  result: SkillResult,
  mode: ChannelRunMode,
): SkillResult {
  if (mode === 'execute') return result;
  return {
    ...result,
    contacted: 0,
    contactedList: (result.contactedList ?? []).map(candidate => ({
      ...candidate,
      greetingSent: false,
    })),
  };
}

const TASK_PROMPT = (channelLabel: string) => `
请开始执行 ${channelLabel} 的招聘 sourcing 任务。

任务完成后，请严格按照以下格式输出总结（每行一项）：
触达人数: <数字>
跳过人数: <数字>
主要跳过原因: <简短描述>
候选人摘要: <简短描述，如"5人来自大厂，3人学历985">
`.trim();

// "就地接管"模式：从用户当前真实浏览器页面开始，不新开浏览器、不切换 profile。
// 这不是业务规则；是否需要站内流转、如何流转，由后续中层平台协议决定。
const TASK_PROMPT_HERE = (channelLabel: string) => `
你正在就地接管用户当前真实 Chrome 里的 ${channelLabel} 页面。

**铁律（这是本模式的全部要点）：**
- 不要打开新的浏览器、不要创建新的登录态、不要切到另一个 profile。
- 可以读取当前页、点击页面内已有入口、输入、滚动、等待；旧 ref 失效后必须重新 snapshot。
- 不要用直接深链 URL 取巧代替页面内真实操作；如当前状态不足以继续，请输出当前状态和需要的下一步。
- 每完成一次真实触达，必须立刻调用 record_contacted 登记结构化候选人。

任务完成后，按格式输出总结：
触达人数: <数字>
跳过人数: <数字>
主要跳过原因: <简短描述>
候选人摘要: <简短描述>
`.trim();

const CHANNEL_LABEL: Record<Channel, string> = {
  boss:     'BOSS直聘',
  maimai:   '脉脉',
  linkedin: 'LinkedIn',
  followup: '跟进未回复',
};

const CHANNEL_URL: Record<Channel, string> = {
  boss:     'https://www.zhipin.com/web/chat/index',
  maimai:   'https://maimai.cn/ent/v41/recruit/talents?tab=1',
  linkedin: 'https://www.linkedin.com/talent/hire',
  followup: 'https://www.zhipin.com/web/chat/index',
};

const LOGIN_OR_MISSING_PATTERNS: Partial<Record<Channel, RegExp>> = {
  boss: /访问的资源不存在|登录\/注册|扫码登录|密码登录|请登录|我要招聘/,
  maimai: /登录|扫码|手机号/,
  linkedin: /Sign in|Join LinkedIn|登录/,
};

function taskPromptForChannel(
  channel: Channel,
  label: string,
  fromCurrent = false,
  dryRun = false,
  prepare = false,
  activeJob?: JobConfig | null,
): string {
  const protocol = getPlatformProtocol(channel);
  const base = protocol
    ? protocol.buildTaskPrompt({ channelLabel: label, fromCurrent, activeJob })
    : fromCurrent ? TASK_PROMPT_HERE(label) : TASK_PROMPT(label);
  if (prepare) {
    return [
      base,
      [
        '## Prepare 安全验收约束',
        '',
        '本轮必须自行通过 BOSS 页面内交互切到 active job，并完成筛选面板逐项设置与激活态验收。',
        '如果筛选面板显示“确定/应用/确认”，必须成功点击提交；仅看到 active 状态不能算完成。',
        '完成筛选后立即停止；禁止进入候选人处理、禁止打招呼、禁止发送消息、禁止调用 record_contacted。',
      ].join('\n'),
    ].join('\n\n---\n\n');
  }
  if (!dryRun) return base;
  return [
    base,
    [
      '## Dry-run 预检约束',
      '',
      '本轮只做真实 Chrome 页面预检，不允许打招呼、不允许点击会发起沟通的按钮、不允许输入触达话术。',
      '请输出当前页面状态、目标岗位是否匹配、是否能安全开始正式执行，以及正式执行前需要调整什么。',
    ].join('\n'),
  ].join('\n\n---\n\n');
}

export function runSkillOptionsForChannel(
  channel: Channel,
  runId: number | null,
  fromCurrent = false,
  dryRun = false,
  prepare = false,
  activeJobTitle?: string,
): RunSkillOptions {
  const protocol = getPlatformProtocol(channel);
  const base: RunSkillOptions = {
    runId: runId ?? undefined,
    executionMode: prepare ? 'prepare' : dryRun ? 'dry_run' : 'execute',
    initialStageId: protocol?.stageManifest?.()[0]?.id,
    requiredStagesBeforeContact: channel === 'boss' ? ['prefilter', 'candidate-screen'] : [],
    targetJobTitle: activeJobTitle,
    completionPolicy: protocol?.completionPolicy,
  };
  if (protocol?.browserActionPolicy) {
    return {
      ...base,
      browserActionPolicy: protocol.browserActionPolicy,
    };
  }
  if (fromCurrent) {
    return {
      ...base,
      blockedBrowserActions: ['goto', 'back'],
    };
  }
  return base;
}

function platformSystemContextForChannel(channel: Channel): string {
  const protocol = getPlatformProtocol(channel);
  return protocol?.buildSystemContext?.() ?? '';
}

export interface ChannelSkillAssetContext {
  mode: 'preloaded' | 'fallback-only';
  content: string;
}

export function channelSkillAssetContext(channel: Channel): ChannelSkillAssetContext {
  const protocol = getPlatformProtocol(channel);
  if (!protocol || config.skills.preloadLegacyForProductizedChannels) {
    return { mode: 'preloaded', content: loadSkill(channel) };
  }
  return {
    mode: 'fallback-only',
    content: [
      '# Legacy skill fallback',
      `渠道 ${channel} 已由 HireSeek 产品协议 ${protocol.name} 接管。`,
      '完整 legacy skill 不预加载进本轮 prompt，避免历史规则覆盖产品协议。',
      'skill 文件仍保留在外部 skill homes，供 CC/Codex 原生使用，也可通过显式回退配置重新启用。',
    ].join('\n'),
  };
}

async function createBrowserTarget(channel: Channel): Promise<BrowserTarget> {
  if (config.browser.control === 'hireseek') {
    return await getPage();
  }

  if (config.browser.control !== 'chrome') {
    throw new Error(`不支持的 HIRESEEK_BROWSER_CONTROL=${config.browser.control}，可选 chrome / hireseek`);
  }

  try {
    return await connectRealChrome(channel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `无法接管真实 Chrome：${message}\n` +
      '请确认：1) Google Chrome 已打开；2) 已登录对应招聘平台；' +
      '3) Chrome 菜单「视图 > 开发者 > 允许 Apple 事件中的 JavaScript」已开启。'
    );
  }
}

async function targetGoto(target: BrowserTarget, url: string): Promise<void> {
  if (isDomBrowserSession(target)) {
    await target.goto(url);
  } else {
    await target.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
}

async function currentTargetUrl(target: BrowserTarget): Promise<string> {
  return isDomBrowserSession(target) ? await target.url() : target.url();
}

async function targetText(target: BrowserTarget): Promise<string> {
  return isDomBrowserSession(target)
    ? await target.bodyText()
    : await target.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function ensurePlatformSession(target: BrowserTarget, channel: Channel): Promise<void> {
  const channelUrl = CHANNEL_URL[channel];
  const targetPath = new URL(channelUrl).pathname;
  const pattern = LOGIN_OR_MISSING_PATTERNS[channel];

  for (let attempt = 0; attempt < 2; attempt++) {
    const currentUrl = await currentTargetUrl(target);
    const isOnTargetPage = currentUrl.startsWith(channelUrl) || currentUrl.includes(targetPath);
    const body = await targetText(target);
    const looksUnavailable = pattern ? pattern.test(body) : false;

    if (isOnTargetPage && !looksUnavailable) return;

    console.log(`\n[HireSeek] ⚠️  当前 Chrome 还没有可用的 ${CHANNEL_LABEL[channel]} 登录态（当前：${currentUrl}）`);
    console.log('[HireSeek] 请在你已打开的 Chrome 里完成登录/切到正确页面，登录完成后回到终端按 Enter 继续...');
    await new Promise<void>(resolve => {
      process.stdin.once('data', () => resolve());
    });

    await targetGoto(target, channelUrl);
  }

  throw new Error(`${CHANNEL_LABEL[channel]} 登录态仍不可用，已停止本轮 sourcing，避免产生 0 触达假成功。`);
}

export async function runChannel(
  channel: Channel,
  jobId?: string,
  opts: { fromCurrent?: boolean; dryRun?: boolean; prepare?: boolean; progress?: (msg: string) => void } = {}
): Promise<number> {
  // 默认绑定当前 active job，而不是字面量 'default'。否则心跳/CLI 不传 jobId 时，
  // 候选人落到 job_id='default'，而 verifier 按 active job 查 → 永远查不到（落库错位）。
  const runtime = createRuntimeContext();
  const activeJob = runtime.activeJob;
  if (!jobId) jobId = runtime.activeJobId;
  const label = CHANNEL_LABEL[channel];
  const dryRun = !!opts.dryRun;
  const prepare = !!opts.prepare;
  if (dryRun && prepare) throw new Error('dry-run 与 prepare 不能同时启用');
  const runMode: ChannelRunMode = prepare ? 'prepare' : dryRun ? 'dry_run' : 'execute';
  const modeLabel = runMode === 'dry_run' ? '（dry-run 预检）' : runMode === 'prepare' ? '（prepare 安全验收）' : '';
  console.log(`\n[Orchestrator] ▶ 开始 ${label} sourcing${modeLabel}`);
  emitLog(`▶ 开始 ${label} sourcing${modeLabel}`);
  emitStatus('running');

  const startMs = Date.now();
  let runId: number | null = null;

  try {
    const page = await createBrowserTarget(channel);

    if (opts.fromCurrent) {
      // 就地接管：不跳转、不做登录态导航，直接从用户已开好的页面开始
      const here = await currentTargetUrl(page).catch(() => '(未知)');
      console.log(`[Orchestrator] 📍 就地接管当前页面（--here），不跳转：${here}`);
      emitLog(`📍 就地接管当前页面：${here}`);
    } else {
      // 导航到对应招聘平台
      await targetGoto(page, CHANNEL_URL[channel]);
      await ensurePlatformSession(page, channel);
    }

    const startedAt = dayjs().toISOString();
    const runResult = taskRunOps.start.run({ job_id: jobId, channel, mode: runMode, started_at: startedAt });
    runId = runResult.lastInsertRowid as number;

    // 组装系统提示：SOUL + 职位上下文 + 中层能力 + 记忆 + Skill资产
    const soul      = loadWorkspaceFile('SOUL.md');
    const job       = activeJob;
    const jobCtx    = job ? jobToPrompt(job) : '';
    const capabilities = buildRecruitingCapabilityContext({
      channel,
      includeKinds: ['principles', 'evaluation', 'outreach', 'search'],
    });
    const memory    = buildMemoryContext(channel, jobId);
    const skillAsset = channelSkillAssetContext(channel);
    const protocolContext = platformSystemContextForChannel(channel);
    const systemPrompt = [soul, jobCtx, skillAsset.content, protocolContext, capabilities, memory].filter(Boolean).join('\n\n---\n\n');

    const runner = createRunner();
    const rawResult = await runner.runSkill(
      page,
      systemPrompt,
      taskPromptForChannel(channel, label, !!opts.fromCurrent, dryRun, prepare, activeJob),
      opts.progress ?? ((msg) => process.stdout.write(`\r  ${msg}`.padEnd(80))),
      runSkillOptionsForChannel(channel, runId, !!opts.fromCurrent, dryRun, prepare, activeJob?.title),
    );
    const result = normalizeResultForRunMode(rawResult, runMode);

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

    // 统一落库：结构化候选人（verifier 数据来源）+ 执行轨迹（合规审计来源）
    persistRunResult(runId, jobId, channel, result, { mode: runMode });

    if (runMode === 'execute') {
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
        // 反思生成失败不影响主流程
      }

      await sendReport({
        channel,
        contacted: result.contacted,
        skipped: result.skipped,
        summary: result.summary,
        durationSec,
      });
    } else {
      console.log(`[Orchestrator] ${runMode} 完成：未发送报告、未生成反思、未触达候选人`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`\n[Orchestrator] ✗ ${label} 失败: ${error}`);
    emitLog(`✗ ${label} 失败: ${error}`);
    emitStatus('idle');

    if (runId == null) {
      throw err;
    }

    taskRunOps.complete.run({
      id: runId,
      finished_at: dayjs().toISOString(),
      status: 'failed',
      contacted_count: 0,
      skipped_count: 0,
      error,
    });

    if (runMode === 'execute') {
      await sendReport({
        channel,
        contacted: 0,
        skipped: 0,
        summary: `执行失败: ${error}`,
        durationSec: Math.round((Date.now() - startMs) / 1000),
      });
    }
  }
  return runId; // 供调用方把 verify/compliance 绑定到【本轮】
}

/**
 * 扫描 BOSS 收件箱，检测回复并更新候选人状态。
 */
export async function scanInbox(jobId: string = 'default'): Promise<void> {
  console.log('\n[Scanner] 🔍 开始扫描收件箱...');
  const page = await getPage();
  await page.goto('https://www.zhipin.com/web/chat/index', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const currentUrl = page.url();
  if (!currentUrl.includes('zhipin.com/web')) {
    console.log('\n[HireSeek] ⚠️  请先登录 BOSS直聘，登录完成后按 Enter 继续...');
    await new Promise<void>(resolve => { process.stdin.once('data', () => resolve()); });
    await page.goto('https://www.zhipin.com/web/chat/index', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
  const runtime = createRuntimeContext();
  const job = runtime.activeJob;
  if (!job) {
    console.error('[Orchestrator] 未找到 workspace/jobs/active.yaml，请先配置职位');
    return;
  }

  const jobId = runtime.activeJobId;
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

  console.log(`\n🦞 HireSeek 并行模式`);
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
  const dailyGoal = createRuntimeContext().activeJob?.daily_goal?.contact ?? 30;
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
  const runResult = taskRunOps.start.run({ job_id: jobId, channel, mode: 'execute', started_at: startedAt });
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
    const job = createRuntimeContext().activeJob;
    const soul = loadWorkspaceFile('SOUL.md');
    const skillAsset = channelSkillAssetContext(channel);
    const jobContext = job ? jobToPrompt(job) : '';
    const memory = buildMemoryContext(channel, jobId);
    const protocolContext = platformSystemContextForChannel(channel);
    const capabilities = buildRecruitingCapabilityContext({
      channel,
      includeKinds: ['principles', 'evaluation', 'outreach', 'search'],
    });

    const systemPrompt = [soul, jobContext, skillAsset.content, protocolContext, capabilities, memory]
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
        return await runner.runSkill(
          page,
          systemPrompt,
          taskPromptForChannel(channel, label, false, false, false, job),
          (msg) => {
            console.log(`[${label}] ${msg}`);
            emitLog(`[${label}] ${msg}`);
          },
          runSkillOptionsForChannel(channel, runId, false),
        );
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

    // 统一落库：结构化候选人 + 执行轨迹（并行路径同样必须落，否则验证器空转）
    persistRunResult(runId, jobId, channel, result);

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
