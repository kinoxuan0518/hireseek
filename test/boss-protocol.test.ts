import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { contractNameForChannel } from '../src/contracts';
import { formatPlatformProtocols, getPlatformProtocol } from '../src/platform-protocols';
import {
  bossBrowserActionPolicy,
  bossRunCompletionPolicy,
  bossProcessRules,
  bossProtocolStages,
  buildBossPrefilterPlan,
  buildBossSystemContext,
  buildBossTaskPrompt,
  formatBossProtocolStages,
  formatBossPrefilterPlan,
} from '../src/platform-protocols/boss';
import { loadSkill } from '../src/skills/loader';
import { channelSkillAssetContext, runSkillOptionsForChannel } from '../src/orchestrator';

describe('boss platform protocol middle layer', () => {
  const agentJob = {
    title: 'Agent工程师',
    requirements: {
      must_have: [
        '1-3 年工作经验',
        'Agent 相关的工作经历',
        '互联网大厂 / 明星创业公司背景',
      ],
      deal_breaker: ['跳槽超过 3 次且无合理解释'],
    },
  };

  it('tells the runner to switch jobs inside BOSS instead of asking the user', () => {
    const prompt = buildBossTaskPrompt({ channelLabel: 'BOSS直聘', fromCurrent: true, activeJob: agentJob });

    expect(prompt).toContain('切到目标岗位');
    expect(prompt).toContain('站内');
    expect(prompt).toContain('不要把“当前职位不匹配”当成任务结束');
    expect(prompt).toContain('真实 Chrome');
    expect(prompt).toContain('职位名匹配要做归一化');
    expect(prompt).toContain('筛选面板是强制前置步骤');
    expect(prompt).toContain('筛选组合必须来自当前职位 facts / effective_prefilter');
    expect(prompt).toContain('DOM 选择器探测');
    expect(prompt).toContain('禁止跨会话复用旧选择器');
    expect(prompt).toContain('≥5 秒');
    expect(prompt).toContain('pool_refill_exhausted');
    expect(prompt).toContain('BOSS 结构化阶段清单');
    expect(prompt).toContain('筛选面板前置');
    expect(prompt).toContain('单人触达与留痕');
    expect(prompt).toContain('当前职位 BOSS 筛选前置计划');
    expect(prompt).toContain('经验要求：1-3年');
    expect(prompt).toContain('关键词筛选：大模型、AI Agent');
    expect(prompt).toContain('互联网大厂 / 明星创业公司背景');
    expect(prompt).toContain('推荐 -> 最新');
  });

  it('builds a conservative BOSS prefilter plan from active job facts', () => {
    const plan = buildBossPrefilterPlan(agentJob);
    const formatted = formatBossPrefilterPlan(agentJob);

    expect(plan.experienceTags).toEqual(['1-3年']);
    expect(plan.excludedExperienceTags).toContain('26年后毕业');
    expect(plan.keywordTags).toEqual(['大模型', 'AI Agent']);
    expect(plan.scriptRefineFacts).toContain('互联网大厂 / 明星创业公司背景');
    expect(plan.scriptRefineFacts).toContain('跳槽超过 3 次且无合理解释');
    expect(formatted).toContain('无法映射的项不要硬选');
    expect(formatBossPrefilterPlan(null)).toContain('不得臆造岗位筛选项');
  });

  it('exposes BOSS workflow stages as a structured manifest', () => {
    const stages = bossProtocolStages();
    const formatted = formatBossProtocolStages();

    expect(stages.map(s => s.id)).toEqual([
      'session-precheck',
      'job-positioning',
      'prefilter',
      'dom-probe',
      'candidate-screen',
      'single-contact',
      'exhaustion-and-risk',
    ]);
    expect(stages.find(s => s.id === 'prefilter')?.required.join(' ')).toContain('prefilter plan');
    expect(stages.find(s => s.id === 'single-contact')?.evidence.join(' ')).toContain('run_candidates');
    expect(formatted).toContain('可审计证据');
  });

  it('blocks direct URL navigation while allowing normal page operations', () => {
    const denied = bossBrowserActionPolicy(
      { action: 'goto', url: 'https://www.zhipin.com/web/chat/recommend' },
      {},
    );
    const allowedClick = bossBrowserActionPolicy(
      { action: 'click', ref: 12, stage_id: 'job-positioning' },
      { observedStageIds: ['session-precheck'], executionMode: 'execute' },
    );
    const allowedSnapshot = bossBrowserActionPolicy({ action: 'snapshot' }, {});
    const allowedScroll = bossBrowserActionPolicy({ action: 'scroll', direction: 'down' }, {});
    const missingStage = bossBrowserActionPolicy({ action: 'click', ref: 12 }, {
      observedStageIds: ['session-precheck'],
      executionMode: 'execute',
    });
    const skippedJobPositioning = bossBrowserActionPolicy(
      { action: 'click', ref: 20, stage_id: 'prefilter' },
      { observedStageIds: ['session-precheck'], executionMode: 'execute' },
    );
    const allowedPrefilter = bossBrowserActionPolicy(
      { action: 'click', ref: 20, stage_id: 'prefilter' },
      {
        observedStageIds: ['session-precheck', 'job-positioning'],
        executionMode: 'prepare',
        actionLabel: '[ref=20] <button> 1-3年',
        targetJobTitle: 'Agent工程师',
      },
    );
    const blockedPrepareContact = bossBrowserActionPolicy(
      { action: 'click', ref: 30, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=30] <button> 打招呼',
      },
    );
    const blockedPrepareCandidateStage = bossBrowserActionPolicy(
      { action: 'click', ref: 31, stage_id: 'candidate-screen' },
      {
        observedStageIds: ['session-precheck', 'job-positioning', 'prefilter', 'dom-probe'],
        executionMode: 'prepare',
      },
    );
    const blockedPrepareType = bossBrowserActionPolicy(
      { action: 'type', ref: 10, text: '推荐牛人', stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=10] <div> placeholder="输入消息"',
        targetJobTitle: 'Agent工程师',
      },
    );
    const blockedPreparePress = bossBrowserActionPolicy(
      { action: 'press', text: 'Enter', stage_id: 'job-positioning' },
      { observedStageIds: ['session-precheck'], executionMode: 'prepare' },
    );
    const blockedUnknownPrepareClick = bossBrowserActionPolicy(
      { action: 'click', ref: 12, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=12] <div> 牛人管理',
        targetJobTitle: 'Agent工程师',
      },
    );
    const allowedTargetJobClick = bossBrowserActionPolicy(
      { action: 'click', ref: 13, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=13] <div> Agent 开发工程师 class="job-item" pointer=true',
        targetJobTitle: 'Agent工程师',
      },
    );
    const allowedRecommendMenuClick = bossBrowserActionPolicy(
      { action: 'click', ref: 3, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=3] <dl> 推荐牛人 class="menu-recommend" pointer=true',
        targetJobTitle: 'Agent工程师',
      },
    );
    const blockedRecommendChatBubble = bossBrowserActionPolicy(
      { action: 'click', ref: 82, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=82] <span> 推荐牛人 class="push-text" pointer=true',
        targetJobTitle: 'Agent工程师',
      },
    );
    const allowedCurrentJobDropdown = bossBrowserActionPolicy(
      { action: 'click', ref: 29, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=29] <div> 高级AI产品经理 _ 上海 30-35K class="ui-dropmenu-label" pointer=true',
        targetJobTitle: 'Agent工程师',
      },
    );
    const allowedRoleOnlyJobCombobox = bossBrowserActionPolicy(
      { action: 'click', ref: 30, stage_id: 'job-positioning' },
      {
        observedStageIds: ['session-precheck'],
        executionMode: 'prepare',
        actionLabel: '[ref=30] <div> 高级AI产品经理 aria="选择职位" role="combobox" tabindex="0" pointer=true',
        targetJobTitle: 'Agent工程师',
      },
    );

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('直接跳转 URL');
    expect(allowedClick.allowed).toBe(true);
    expect(allowedSnapshot.allowed).toBe(true);
    expect(allowedScroll.allowed).toBe(true);
    expect(missingStage.allowed).toBe(false);
    expect(missingStage.reason).toContain('stage_id');
    expect(skippedJobPositioning.allowed).toBe(false);
    expect(skippedJobPositioning.reason).toContain('job-positioning');
    expect(allowedPrefilter.allowed).toBe(true);
    expect(blockedPrepareContact.allowed).toBe(false);
    expect(blockedPrepareContact.reason).toContain('禁止打招呼');
    expect(blockedPrepareCandidateStage.allowed).toBe(false);
    expect(blockedPrepareCandidateStage.reason).toContain('prepare 模式只允许');
    expect(blockedPrepareType.allowed).toBe(false);
    expect(blockedPrepareType.reason).toContain('禁止 type');
    expect(blockedPreparePress.allowed).toBe(false);
    expect(blockedPreparePress.reason).toContain('禁止 press');
    expect(blockedUnknownPrepareClick.allowed).toBe(false);
    expect(blockedUnknownPrepareClick.reason).toContain('只允许点击目标职位导航或筛选控件');
    expect(allowedTargetJobClick.allowed).toBe(true);
    expect(allowedRecommendMenuClick.allowed).toBe(true);
    expect(blockedRecommendChatBubble.allowed).toBe(false);
    expect(blockedRecommendChatBubble.reason).toContain('消息或候选人沟通控件');
    expect(allowedCurrentJobDropdown.allowed).toBe(true);
    expect(allowedRoleOnlyJobCombobox.allowed).toBe(true);
  });

  it('keeps BOSS process rules in the protocol layer', () => {
    const rules = bossProcessRules();

    expect(rules).toContain('当前页面职位与目标岗位不一致');
    expect(rules).toContain('页面内 click/type/press/scroll');
    expect(rules).toContain('标题归一化');
    expect(rules).toContain('筛选面板');
    expect(rules).toContain('DOM 探测');
    expect(rules).toContain('≥5 秒');
    expect(rules).toContain('人工接管期间必须零动作');
    expect(rules).toContain('stage manifest');
    expect(rules).toContain('record_contacted');
  });

  it('requires visible filter controls to be submitted before prepare completes', () => {
    const trace = [
      { seq: 1, action: 'click', ok: true, sideEffect: true, stageId: 'job-positioning', actionLabel: 'Agent 开发工程师' },
      { seq: 2, action: 'click', ok: true, sideEffect: true, stageId: 'prefilter', actionLabel: '1-3年' },
    ];
    const pending = bossRunCompletionPolicy({
      executionMode: 'prepare',
      trace,
      pageSnapshot: 'URL: https://www.zhipin.com/web/chat/recommend\n[ref=1] <div> Agent 开发工程师\n[ref=2] <div> 确定 class="btn"',
      targetJobTitle: 'Agent工程师',
    });
    const accepted = bossRunCompletionPolicy({
      executionMode: 'prepare',
      trace: [...trace, { seq: 3, action: 'click', ok: true, sideEffect: true, stageId: 'prefilter', actionLabel: '[ref=2] <div> 确定 class="btn"' }],
      pageSnapshot: 'URL: https://www.zhipin.com/web/chat/recommend\nAgent 开发工程师\n筛选条件 1-3年',
      targetJobTitle: 'Agent工程师',
    });

    expect(pending.allowed).toBe(false);
    expect(pending.reason).toContain('成功提交筛选');
    expect(accepted.allowed).toBe(true);
  });

  it('requires a matching contact checkpoint before greeting and blocks duplicates', () => {
    const action = { action: 'click', ref: 8, stage_id: 'single-contact' } as const;
    const observedStageIds = ['session-precheck', 'job-positioning', 'prefilter', 'dom-probe', 'candidate-screen'];
    const label = '[ref=8] <button> 打招呼 class="btn" context="测试候选人 2年 Agent 平台经验"';

    const withoutCheckpoint = bossBrowserActionPolicy(action, {
      executionMode: 'execute', observedStageIds, actionLabel: label,
    });
    const wrongCandidate = bossBrowserActionPolicy(action, {
      executionMode: 'execute', observedStageIds, actionLabel: label, pendingContactName: '另一位候选人',
    });
    const allowed = bossBrowserActionPolicy(action, {
      executionMode: 'execute', observedStageIds, actionLabel: label, pendingContactName: '测试候选人',
    });
    const duplicate = bossBrowserActionPolicy(action, {
      executionMode: 'execute',
      observedStageIds,
      actionLabel: '[ref=8] <button> 继续沟通 context="测试候选人"',
      pendingContactName: '测试候选人',
    });
    const unfinished = bossRunCompletionPolicy({
      executionMode: 'execute',
      trace: [],
      pageSnapshot: '',
      pendingContactName: '测试候选人',
      pendingContactAwaitingRecord: true,
    });

    expect(withoutCheckpoint.allowed).toBe(false);
    expect(withoutCheckpoint.reason).toContain('prepare_contact');
    expect(wrongCandidate.allowed).toBe(false);
    expect(wrongCandidate.reason).toContain('不一致');
    expect(allowed.allowed).toBe(true);
    expect(duplicate.allowed).toBe(false);
    expect(duplicate.reason).toContain('重复触达');
    expect(unfinished.allowed).toBe(false);
    expect(unfinished.reason).toContain('record_contacted');
  });

  it('allows screen-mode candidate inspection but blocks communication controls', () => {
    const observedStageIds = ['session-precheck', 'job-positioning', 'prefilter', 'dom-probe'];
    const candidateCard = bossBrowserActionPolicy(
      { action: 'click', ref: 41, stage_id: 'candidate-screen' },
      {
        executionMode: 'screen',
        observedStageIds,
        actionLabel: '[ref=41] <div> 测试候选人 2年 Agent 平台经验 class="geek-item" pointer=true',
        targetJobTitle: 'Agent工程师',
      },
    );
    const greetingButton = bossBrowserActionPolicy(
      { action: 'click', ref: 42, stage_id: 'candidate-screen' },
      {
        executionMode: 'screen',
        observedStageIds,
        actionLabel: '[ref=42] <button> 打招呼 context="测试候选人"',
        targetJobTitle: 'Agent工程师',
      },
    );
    const singleContact = bossBrowserActionPolicy(
      { action: 'click', ref: 43, stage_id: 'single-contact' },
      {
        executionMode: 'screen',
        observedStageIds: [...observedStageIds, 'candidate-screen'],
        actionLabel: '[ref=43] <button> 打招呼 context="测试候选人"',
        targetJobTitle: 'Agent工程师',
      },
    );
    const blockedBackDuringJobPositioning = bossBrowserActionPolicy(
      { action: 'back', stage_id: 'job-positioning' },
      {
        executionMode: 'screen',
        observedStageIds,
        targetJobTitle: 'Agent工程师',
      },
    );
    const allowedBackDuringCandidateScreen = bossBrowserActionPolicy(
      { action: 'back', stage_id: 'candidate-screen' },
      {
        executionMode: 'screen',
        observedStageIds: [...observedStageIds, 'candidate-screen'],
        targetJobTitle: 'Agent工程师',
      },
    );
    const unfinishedScreen = bossRunCompletionPolicy({
      executionMode: 'screen',
      trace: [],
      pageSnapshot: '',
      targetJobTitle: 'Agent工程师',
    });
    const finishedScreen = bossRunCompletionPolicy({
      executionMode: 'screen',
      trace: [{ seq: 1, action: 'click', ok: true, stageId: 'candidate-screen' }],
      pageSnapshot: '',
      targetJobTitle: 'Agent工程师',
    });

    expect(candidateCard.allowed).toBe(true);
    expect(greetingButton.allowed).toBe(false);
    expect(greetingButton.reason).toContain('沟通控件');
    expect(singleContact.allowed).toBe(false);
    expect(singleContact.reason).toContain('single-contact');
    expect(blockedBackDuringJobPositioning.allowed).toBe(false);
    expect(blockedBackDuringJobPositioning.reason).toContain('旧职位');
    expect(allowedBackDuringCandidateScreen.allowed).toBe(true);
    expect(unfinishedScreen.allowed).toBe(false);
    expect(unfinishedScreen.reason).toContain('candidate-screen');
    expect(finishedScreen.allowed).toBe(true);
  });

  it('registers BOSS protocol as the channel contract owner', () => {
    const protocol = getPlatformProtocol('boss');

    expect(protocol?.name).toBe('boss-platform.v1');
    expect(protocol?.contractName).toBe('boss-greeting.v1');
    expect(contractNameForChannel('boss')).toBe('boss-greeting.v1');
    expect(protocol?.buildSystemContext?.()).toContain('优先级高于外部 skill 资产');
    expect(protocol?.completionPolicy).toBe(bossRunCompletionPolicy);
    expect(formatPlatformProtocols()).toContain('boss-platform.v1');
    expect(formatPlatformProtocols()).toContain('产品中层协议');
    expect(formatPlatformProtocols()).toContain('Stage manifest: 7 stages');
    expect(runSkillOptionsForChannel('boss', 123, true, true).initialStageId).toBe('session-precheck');
    expect(runSkillOptionsForChannel('boss', 124, true, false, true, false, 'Agent工程师')).toMatchObject({
      executionMode: 'prepare',
      requiredStagesBeforeContact: ['prefilter', 'dom-probe', 'candidate-screen'],
      targetJobTitle: 'Agent工程师',
    });
    expect(runSkillOptionsForChannel('boss', 125, true, false, false, true, 'Agent工程师')).toMatchObject({
      executionMode: 'screen',
      initialStageId: 'session-precheck',
      targetJobTitle: 'Agent工程师',
    });
  });

  it('keeps legacy skill assets below product protocols', () => {
    const systemContext = buildBossSystemContext();
    const skill = loadSkill('boss');
    const fallback = fs.readFileSync(path.join(process.cwd(), 'workspace', 'skills', 'boss.md'), 'utf-8');

    expect(systemContext).toContain('代码层风控');
    expect(systemContext).toContain('人工接管前必须强停');
    expect(systemContext).toContain('26年后毕业');
    expect(systemContext).toContain('parse_quality');
    expect(skill).toContain('Skill 资产兼容层');
    expect(skill).toContain('HireSeek 产品中层协议');
    expect(fallback).toContain('如果当前职位不是目标岗位，应优先站内切到目标岗位');
    expect(fallback).not.toContain('禁止 `goto`、禁止切职位');

    const productContext = channelSkillAssetContext('boss');
    expect(productContext.mode).toBe('fallback-only');
    expect(productContext.content).toContain('完整 legacy skill 不预加载');
    expect(productContext.content).not.toContain('<!-- HireSeek skill source:');
  });
});
