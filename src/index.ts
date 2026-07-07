import 'dotenv/config';
import chalk from 'chalk';
import { startScheduler } from './scheduler';
import { runChannel, runJob, scanInbox } from './orchestrator';
import { startChat } from './chat';
import { runSetup } from './setup';
import { startDashboard } from './dashboard';
import { db, candidateOps } from './db';
import { createRuntimeContext } from './agent-core/runtime-context';
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
  hireseek                     对话模式（默认）
  hireseek setup               初始化向导：一步步配置好一切
  hireseek goal                结果目标计分板：面试通过数 + "判断准不准"的校准对照
  hireseek feedback <名> pass|fail [备注]  手动回流面试结果（校准"合适"的判断）
  hireseek hire-sync [--apply]  从飞书招聘/多维表格自动拉面试结果回流（默认 dry-run 预览）
  hireseek verify              双轴独立质检：人选质量(反凑数) + 流程合规(用没用筛选项/乱开网页)（--push 推送）
  hireseek core                Agent Core 状态：工具注册 / trace / session / memory
  hireseek failures            Harness 失败复盘：环境 / 工具 / 协议 / 登录态优先级
  hireseek readiness [渠道]    只读检查当前 Chrome 是否适合跑真实渠道验收（不创建 run；--strict 可作脚本门禁）
  hireseek validate <渠道>     真实渠道验收：先 readiness，再依次 dry-run / prepare / screen
  hireseek runs [all|ID]       查看最近暂停/失败 run；all 显示最近全部；ID 显示详情
  hireseek runs cleanup [--apply]  收口超时 running run（默认预览，不删除 trace）
  hireseek doctor              产品结构体检：下层基座 / 中层协议 / skill 边界 / 真实验收缺口
  hireseek protocols           中层平台协议：已产品化渠道 / 契约 / 动作策略 / 合规规则
  hireseek capabilities        中层招聘能力：触达话术 / 候选人判断 / 搜索策略
  hireseek alive               查岗：一句话报告它在不在、做了什么、下一步（--push 推送一条）
  hireseek console             网页指挥台：打开浏览器就能看见它、打字指挥它
  hireseek dashboard           启动本地控制台（实时截图 + 日志 + 任务控制）
  hireseek run                 自主模式：自动决定今天跑哪些渠道
  hireseek run --plan          计划模式：先分析生成计划，用户确认后执行
  hireseek run <渠道>          指定渠道立即执行
  hireseek run <渠道> --dry-run  预检模式：接管真实页面但禁止打招呼/输入/点击副作用
  hireseek run <渠道> --here --prepare  安全验收：自动切到目标职位并设置筛选，但绝不触达候选人
  hireseek run <渠道> --here --screen   候选人筛选验收：可查看候选人，但禁止打招呼/发消息
  hireseek run boss --here     就地接管当前 BOSS 页面，由产品协议自行定位目标职位并执行
  hireseek scan                扫描收件箱，更新已回复候选人
  hireseek update <姓名> <状态>  手动更新候选人状态
  hireseek funnel              查看招聘漏斗
  hireseek tasks               查看任务看板
  hireseek tasks <ID>          查看任务详情
  hireseek evo                 进化：基于真实数据复盘并改写话术/筛选规则
  hireseek evo dry             只出复盘报告，不落盘
  hireseek evo back            回滚最近一次进化
  hireseek evo log             进化历史与效果对比
  hireseek learn               学习闭环：用真实过面结果自动重校"合适"的定义（dry 仅预览）
  hireseek beat                手动跑一次心跳决策（主动性循环）
  hireseek beat dry            只看决策不执行
  hireseek beat log            心跳历史
  hireseek sched               查看定时计划（人话时间 + 下次/上次执行）
  hireseek sched set <任务> "<cron>"  修改计划，如 sched set boss "0 8 * * 1-5"
  hireseek sched off|on <任务>  关闭/恢复某项计划
  hireseek start               启动定时守护进程（前台）
  hireseek daemon run          常驻守护进程：调度 + 网页指挥台 + 飞书 Bot（前台运行）
  hireseek daemon install      安装为开机自启服务（launchd，崩溃自拉起）
  hireseek daemon uninstall    卸载开机自启服务
  hireseek daemon status       查看守护进程运行状态

渠道: boss | maimai | linkedin | followup
状态: replied | interviewed | offered | joined | rejected | dropped
`.trim();

async function checkSetup(): Promise<boolean> {
  const issues: string[] = [];
  const hints:  string[] = [];

  // 检查 API key（DeepSeek 优先）
  const hasKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CUSTOM_API_KEY;
  if (!hasKey) {
    issues.push('未配置 API Key');
  }

  // 检查职位文件
  const job = createRuntimeContext().activeJob;
  if (!job) {
    issues.push('未配置招聘职位');
  } else if (job.title === 'AI 算法工程师') {
    hints.push(`  ℹ️  当前职位：${job.title}（示例职位，记得改成你真实要招的）`);
  }

  // 如果有配置缺失，显示欢迎信息并引导 setup
  if (issues.length > 0) {
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('👋 欢迎使用 HireSeek！'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.white('看起来这是你第一次使用 HireSeek 🔱\n'));
    console.log(chalk.gray('HireSeek 是一个智能招聘助手，可以帮你：'));
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

    console.log(chalk.green('\n✨ 配置完成！HireSeek 已准备就绪\n'));
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
  const args = process.argv.slice(2);
  const command = args[0];

  // chat 模式有自己的极简启动界面，这里只为其他命令打 banner
  if (command && command !== 'chat') {
    console.log(chalk.cyan('\n🔱 HireSeek - DeepSeek 驱动的智能招聘 Agent\n'));
    console.log(`数据库: ${chalk.gray(db.name)}\n`);
  }
  const channel = args[1] as Channel | undefined;

  if (!command || command === 'chat') {
    const ranSetup = await checkSetup();

    // 如果刚运行了 setup，重新加载环境变量和 config 模块
    if (ranSetup) {
      const dotenv = await import('dotenv');
      dotenv.config({ override: true });

      // 清除 config 模块缓存，强制重新加载
      const configPath = require.resolve('./config');
      delete require.cache[configPath];

      console.log(chalk.gray('环境变量已更新，配置已重新加载\n'));
    }

    await startChat();

  } else if (command === 'setup') {
    await runSetup();

  } else if (command === 'dashboard' || command === 'ui') {
    startDashboard();
    process.on('SIGINT', () => { db.close(); process.exit(0); });

  } else if (command === 'console' || command === 'panel') {
    // 网页指挥台：打开浏览器就能看见它、指挥它（不需要守护进程）
    const { startWebConsole } = await import('./web-console');
    startWebConsole({ openBrowser: true });
    process.on('SIGINT', () => { db.close(); process.exit(0); });

  } else if (command === 'feedback' || command === 'fb') {
    // 回流面试结果：hireseek feedback <姓名> pass|fail [备注]
    const name = args[1];
    const verdict = (args[2] || '').toLowerCase();
    if (!name || !['pass', 'passed', 'fail', 'failed', '过', '挂'].includes(verdict)) {
      console.log(chalk.yellow('用法：hireseek feedback <候选人姓名> pass|fail [备注]'));
      console.log(chalk.gray('  例：hireseek feedback 张三 pass 一面表现很好'));
      db.close(); process.exit(1);
    }
    const result = ['pass', 'passed', '过'].includes(verdict) ? 'passed' : 'failed';
    const note = args.slice(3).join(' ') || undefined;
    const { recordInterviewOutcome, goalBoard } = await import('./feedback');
    const r = recordInterviewOutcome({ name, result: result as 'passed' | 'failed', note });
    console.log('\n' + r.message + '\n');
    console.log(chalk.gray('— 当前计分板 —'));
    console.log(goalBoard().text + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'goal') {
    // 结果目标计分板：面试通过数 + 校准对照（判断准不准）
    const { goalBoard } = await import('./feedback');
    console.log(goalBoard().text + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'hire-sync' || command === 'sync') {
    // 从飞书招聘 ATS / 多维表格自动拉面试结果回流（默认 dry-run 预览，加 --apply 落库）
    const apply = args.includes('--apply') || args.includes('apply');
    const { syncInterviewOutcomes } = await import('./channels/feishu-hire');
    console.log(chalk.gray('📥 正在从飞书拉取面试结果…\n'));
    const r = await syncInterviewOutcomes({ dryRun: !apply });
    console.log(r.text + '\n');
    if (!apply && r.resolved.length > 0) console.log(chalk.gray('确认无误后加 --apply 真正落库。\n'));
    db.close();
    process.exit(0);

  } else if (command === 'verify' || command === 'qc') {
    // 双轴独立质检（换 v4-pro）：结果轴=人选有没有为凑数注水；过程轴=干活方法合不合规
    const { verifyRun, formatVerification } = await import('./verifier');
    const { complianceCheck, formatCompliance } = await import('./compliance');
    console.log(chalk.gray('🔍 独立验证器（deepseek-v4-pro）正在双轴审计…\n'));
    const v = await verifyRun();
    console.log(formatVerification(v) + '\n');
    const c = await complianceCheck();
    console.log(formatCompliance(c) + '\n');
    if (args.includes('--push') && (v.verdict !== 'skip' || c.verdict !== 'skip')) {
      const { notify } = await import('./notifier');
      const body = [v.verdict !== 'skip' ? formatVerification(v) : '', c.verdict !== 'skip' ? formatCompliance(c) : ''].filter(Boolean).join('\n\n');
      await notify('HireSeek 双轴质检', body);
      console.log(chalk.gray('（已推送一条到你的飞书/系统通知）\n'));
    }
    db.close();
    process.exit(0);

  } else if (command === 'core') {
    const { CHAT_TOOL_REGISTRY } = await import('./chat');
    const { collectCoreStatus, formatCoreStatus } = await import('./agent-core/core-status');
    console.log(formatCoreStatus(collectCoreStatus(CHAT_TOOL_REGISTRY)) + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'failures' || command === 'failure' || command === 'harness-failures') {
    const { collectHarnessFailureReview, formatHarnessFailureReview } = await import('./agent-core/failure-classifier');
    const limitArg = args.slice(1).find(a => /^\d+$/.test(a));
    console.log(formatHarnessFailureReview(collectHarnessFailureReview(limitArg ? Number(limitArg) : 20)) + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'readiness' || command === 'ready' || command === 'preflight') {
    const target = args[1] as Channel | undefined;
    const {
      probeBrowserReadiness,
      probeBrowserReadinessMany,
      formatBrowserReadiness,
      formatBrowserReadinessSummary,
    } = await import('./browser-readiness');
    if (!target) {
      const runtime = createRuntimeContext();
      const channels = runtime.enabledChannels.map(entry => entry.channel);
      if (channels.length === 0) {
        console.log(chalk.yellow('当前 active job 没有启用渠道。也可以指定：hireseek readiness <boss|maimai|linkedin|followup>'));
        db.close();
        process.exit(1);
      }
      const summary = await probeBrowserReadinessMany(channels);
      console.log(formatBrowserReadinessSummary(summary) + '\n');
      db.close();
      process.exit(args.includes('--strict') && !summary.ok ? 1 : 0);
    }
    if (!CHANNELS.includes(target)) {
      console.log(chalk.yellow('用法：hireseek readiness [boss|maimai|linkedin|followup]'));
      db.close();
      process.exit(1);
    }
    console.log(formatBrowserReadiness(await probeBrowserReadiness(target)) + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'validate' || command === 'acceptance') {
    const target = args[1] as Channel | undefined;
    if (!target || !CHANNELS.includes(target)) {
      console.log(chalk.yellow('用法：hireseek validate <boss|maimai|linkedin|followup> [--dry-run-only|--prepare-only|--screen-only]'));
      db.close();
      process.exit(1);
    }
    const {
      channelValidationSteps,
      formatChannelValidationPlan,
      formatChannelValidationResult,
      validateChannel,
    } = await import('./channel-validation');
    const steps = channelValidationSteps(args.slice(2));
    console.log(formatChannelValidationPlan(target, steps) + '\n');
    const result = await validateChannel(target, steps);
    console.log('\n' + formatChannelValidationResult(result) + '\n');
    db.close();
    process.exit(result.ok ? 0 : 1);

  } else if (command === 'runs' || command === 'run-state' || command === 'run-states') {
    if (args[1] === 'cleanup' || args[1] === 'reconcile') {
      const {
        formatInconsistentRunStates,
        formatStaleTaskRuns,
        formatStaleExecutionEnvironments,
        reconcileInconsistentRunStates,
        reconcileStaleExecutionEnvironments,
        reconcileStaleTaskRuns,
      } = await import('./agent-core/task-run-lifecycle');
      const apply = args.includes('--apply') || args.includes('apply');
      const stale = reconcileStaleTaskRuns({ apply });
      const inconsistent = reconcileInconsistentRunStates({ apply });
      const environments = reconcileStaleExecutionEnvironments({ apply });
      console.log(formatStaleTaskRuns(stale) + '\n');
      console.log(formatInconsistentRunStates(inconsistent) + '\n');
      console.log(formatStaleExecutionEnvironments(environments) + '\n');
      if (!apply && (stale.staleRuns.length > 0 || inconsistent.inconsistent.length > 0 || environments.stale.length > 0)) {
        console.log(chalk.gray('确认这些 run 已无活跃进程后，加 --apply 标记为 abandoned。不会删除 trace/tool_calls。\n'));
      }
      db.close();
      process.exit(0);
    }
    const {
      formatRunStateDetail,
      formatRunStateList,
      listAgentRunStates,
      listPendingAgentRunStates,
      loadAgentRunState,
    } = await import('./agent-core/run-state-store');
    const idArg = args.slice(1).find(a => /^\d+$/.test(a));
    if (idArg) {
      console.log(formatRunStateDetail(loadAgentRunState(Number(idArg))) + '\n');
      db.close();
      process.exit(0);
    }
    const showAll = args.includes('all') || args.includes('--all');
    const states = showAll ? listAgentRunStates(12) : listPendingAgentRunStates(12);
    console.log(formatRunStateList(
      states,
      showAll ? 'HireSeek 最近 Run States' : 'HireSeek 待处理 Run States',
      showAll ? '没有 run state。' : '没有待处理 run。',
    ) + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'doctor') {
    const { CHAT_TOOL_REGISTRY } = await import('./chat');
    const { collectDoctorReport, formatDoctorReport } = await import('./doctor');
    console.log(formatDoctorReport(collectDoctorReport(CHAT_TOOL_REGISTRY)) + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'protocols') {
    const { formatPlatformProtocols } = await import('./platform-protocols');
    console.log(formatPlatformProtocols() + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'capabilities') {
    const { formatRecruitingCapabilities } = await import('./capabilities');
    console.log(formatRecruitingCapabilities() + '\n');
    db.close();
    process.exit(0);

  } else if (command === 'alive' || command === 'vitals') {
    // 查岗：一句话回答"它在不在、做了什么、下一步"。--push 同时主动推一条到飞书/通知
    const { collectVitals, formatVitals, reportVitals } = await import('./vitals');
    console.log('\n' + formatVitals(collectVitals()) + '\n');
    if (args.includes('--push')) {
      await reportVitals('查岗');
      console.log(chalk.gray('（已推送一条到你的飞书/系统通知）\n'));
    }
    db.close();
    process.exit(0);

  } else if (command === 'run') {
    // 检查是否使用计划模式
    const usePlan = args.includes('--plan') || args.includes('-p');
    // 就地接管当前 BOSS 页面；目标职位定位由产品中层协议负责。
    const fromCurrent = args.includes('--here');
    // 干跑预检：真实接管当前页面/平台，但工具层禁止 click/type/press/goto/back 等外部副作用
    const dryRun = args.includes('--dry-run') || args.includes('--preview') || args.includes('--check');
    // 安全验收：允许 BOSS 站内职位定位与筛选动作，但代码层禁止候选人触达。
    const prepare = args.includes('--prepare');
    // 候选人筛选验收：允许查看候选人卡片/详情，但代码层禁止触达。
    const screen = args.includes('--screen') || args.includes('--screen-only');
    // 跳过命令名本身（args[0]='run'），否则自主模式会把 run 当渠道名
    const channelArg = args.slice(1).find(a => !a.startsWith('-'));

    // 任务运行中可直接敲字插话（Runner 每轮动作前读取介入队列）
    const { pushIntervention } = await import('./events');
    const readlineMod = await import('readline');
    const rlRun = readlineMod.createInterface({ input: process.stdin, output: process.stdout });
    rlRun.on('line', l => {
      const t = l.trim();
      if (t) {
        pushIntervention(t);
        console.log(chalk.gray('  ✋ 已收到插话，下个动作前生效'));
      }
    });
    console.log(chalk.gray('💬 任务运行中可直接输入指令插话（如"跳过这个人""只看上海的""停下"），回车发送\n'));

    if (!channelArg) {
      // 自主模式：由 active.yaml 决定渠道
      await runJob(usePlan);
    } else if (CHANNELS.includes(channelArg as Channel)) {
      // 指定渠道模式
      if (usePlan) {
        console.log(chalk.yellow('⚠️  计划模式仅支持 "hireseek run --plan"（全渠道），指定渠道时不支持'));
        process.exit(1);
      }
      let runId: number;
      try {
        runId = await runChannel(channelArg as Channel, undefined, { fromCurrent, dryRun, prepare, screen });
      } catch (err) {
        console.error(chalk.red(`\n[HireSeek] sourcing 未启动: ${err instanceof Error ? err.message : err}`));
        db.close();
        process.exit(1);
      }
      if (dryRun || prepare || screen) {
        const safeModeLabel = prepare ? 'prepare 安全验收' : screen ? 'screen 候选人筛选验收' : 'dry-run 预检';
        console.log(chalk.gray(`\n── ${safeModeLabel}完成（runId=${runId}）──`));
        console.log(chalk.gray('本轮没有真实触达，不运行候选人质检/触达契约审计。正式执行前可查看上方预检总结。'));
        db.close();
        process.exit(0);
      }
      // 跑完立刻对【本轮】上双轴质检 + 计分板，让用户当场看到契约闭环是否打通
      try {
        const { verifyRun, formatVerification } = await import('./verifier');
        const { complianceCheck, formatCompliance } = await import('./compliance');
        const { goalBoard } = await import('./feedback');
        console.log(chalk.gray('\n── 本轮质检（runId=' + runId + '）──'));
        console.log(formatVerification(await verifyRun({ runId })));
        console.log(formatCompliance(await complianceCheck({ runId })));
        console.log(chalk.gray('\n── 计分板 ──'));
        console.log(goalBoard().text);
      } catch (e) {
        console.log(chalk.gray('（本轮质检未完成：' + (e instanceof Error ? e.message : e) + '）'));
      }
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
      console.error(chalk.red(`用法: hireseek update <姓名> <状态>`));
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
    const runtime = createRuntimeContext();
    const job = runtime.activeJob;
    const jobId = runtime.activeJobId;
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
      const runtime = createRuntimeContext();
      const jobId = runtime.activeJob ? runtime.activeJobId : undefined;
      displayTaskBoard(jobId);
    }

    db.close();
    process.exit(0);

  } else if (command === 'evo' || command === 'evolve') {
    const { evolve, rollbackLastEvolution, evolutionHistory, evolutionImpact } = await import('./evolution');
    const sub = args[1];

    if (sub === 'back' || args.includes('--rollback')) {
      console.log(rollbackLastEvolution());
    } else if (sub === 'log' || args.includes('--history')) {
      console.log(chalk.cyan('\n🧬 进化历史\n'));
      console.log(evolutionHistory());
      console.log('\n' + evolutionImpact());
    } else {
      const dryRun = sub === 'dry' || args.includes('--dry-run');
      console.log(chalk.cyan(`\n🧬 开始进化复盘${dryRun ? '（dry-run）' : ''}...\n`));
      const report = await evolve({ dryRun, notify: !dryRun });
      console.log(report);
    }
    db.close();
    process.exit(0);

  } else if (command === 'learn' || command === 'recalibrate') {
    // 学习闭环：把真实过面结果回喂，自动重校"合适"的定义（dry 仅预览，否则落盘+git commit）
    const { learn } = await import('./evolution');
    const dryRun = args[1] === 'dry' || args.includes('--dry-run');
    console.log(chalk.cyan(`\n🧠 用真实过面结果重校"合适"的定义${dryRun ? '（dry-run，仅预览）' : ''}...\n`));
    const report = await learn({ dryRun, notify: !dryRun });
    console.log(report);
    db.close();
    process.exit(0);

  } else if (command === 'beat' || command === 'heartbeat') {
    const { runHeartbeat, heartbeatHistory, readState } = await import('./heartbeat');
    const sub = args[1];

    if (sub === 'log') {
      console.log(chalk.cyan('\n💓 心跳历史\n'));
      console.log(heartbeatHistory());
      console.log(chalk.cyan('\n📋 当前 STATE\n'));
      console.log(readState());
    } else {
      const dryRun = sub === 'dry';
      console.log(chalk.cyan(`\n💓 心跳决策中${dryRun ? '（dry-run）' : ''}...\n`));
      const r = await runHeartbeat({ dryRun });
      console.log(`决策：${chalk.bold(r.decision.action)}${r.decision.detail ? ` → ${r.decision.detail.slice(0, 120)}` : ''}`);
      console.log(`理由：${r.decision.reason}`);
      console.log(`结果：${r.outcome}\n`);
    }
    db.close();
    process.exit(0);

  } else if (command === 'sched' || command === 'schedule') {
    const { describeSchedule, setSchedule, findTask } = await import('./schedule-manager');
    const sub = args[1];

    if (sub === 'set' && args[2] && args[3]) {
      console.log('\n' + setSchedule(args[2], args[3]) + '\n');
    } else if (sub === 'off' && args[2]) {
      console.log('\n' + setSchedule(args[2], 'off') + '\n');
    } else if (sub === 'on' && args[2]) {
      console.log('\n' + setSchedule(args[2], 'default') + '\n');
    } else if (sub && !findTask(sub)) {
      console.log(chalk.yellow(`\n用法: hireseek sched [set <任务> "<cron>" | off <任务> | on <任务>]\n`));
    } else {
      console.log('\n⏰ 定时计划\n');
      console.log(describeSchedule());
      console.log('');
    }
    db.close();
    process.exit(0);

  } else if (command === 'start') {
    console.log(chalk.green('守护进程启动，定时任务：'));
    startScheduler();
    console.log(chalk.gray('\n按 Ctrl+C 退出\n'));

    process.on('SIGINT', () => {
      console.log('\n[HireSeek] 退出');
      db.close();
      process.exit(0);
    });

  } else if (command === 'daemon') {
    const sub = args[1] || 'run';
    const d = await import('./daemon');
    if (sub === 'run') {
      await d.runDaemon();           // 常驻，不退出
    } else if (sub === 'install') {
      d.installDaemon();
      db.close();
      process.exit(0);
    } else if (sub === 'uninstall') {
      d.uninstallDaemon();
      db.close();
      process.exit(0);
    } else if (sub === 'status') {
      d.daemonStatus();
      db.close();
      process.exit(0);
    } else {
      console.log(chalk.yellow('\n用法: hireseek daemon [run | install | uninstall | status]\n'));
      db.close();
      process.exit(0);
    }

  } else {
    console.log(USAGE);
  }
}

main().catch((err) => {
  console.error(chalk.red('[HireSeek] 启动失败:'), err.message);
  process.exit(1);
});
