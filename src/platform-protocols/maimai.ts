import type { BrowserAction } from '../browser-session';
import type { BrowserActionPolicy, BrowserActionPolicyDecision, RunCompletionPolicy } from '../runners/interface';
import type { JobConfig } from '../skills/loader';
import type { PlatformProtocolStage, PlatformTaskPromptOptions } from './index';

export interface MaimaiProtocolStage extends PlatformProtocolStage {}

const MAIMAI_PROTOCOL_STAGES: MaimaiProtocolStage[] = [
  {
    id: 'session-precheck',
    name: '会话接管与只读预检',
    required: ['复用已登录脉脉企业招聘页面', '确认登录态、验证码、权限限制和当前 URL'],
    evidence: ['snapshot/status 确认 maimai.cn/ent 招聘端状态', '未创建新浏览器或新 profile'],
    onFailure: '停止自动化动作，说明需要用户在当前页面处理什么。',
  },
  {
    id: 'strategy-source',
    name: '策略来源确认',
    required: ['确认用户当轮口径、上游 talent-sourcing 输出、active job 原始事实或飞书策略来源', '不得在执行层临时发明宽泛搜索策略'],
    evidence: ['记录本轮采用的规则来源和降级原因', '搜索轮次来自明确策略或当前岗位事实'],
    onFailure: '先请求补齐策略或回调 talent-sourcing，不直接泛搜。',
  },
  {
    id: 'search-round',
    name: '搜索轮次设置',
    required: ['按关键词 × 公司筛选组合执行单轮搜索', '一轮只处理一个公司桶或策略桶'],
    evidence: ['关键词、公司桶、城市、学历、年限等搜索条件进入 trace/总结', '提交搜索后等待结果稳定'],
    onFailure: '记录 search_round_missing 或策略过窄原因，再调整轮次。',
  },
  {
    id: 'platform-prefilter',
    name: '平台筛选器前置',
    required: ['设置毕业学校、就职公司、城市、学历、工作年限等平台筛选器', '平台无法表达的硬条件留到候选人核验'],
    evidence: ['筛选控件 click/type 早于候选人触达', '提交搜索或保留筛选激活态证据'],
    onFailure: '不能跳过筛选直接触达；记录 prefilter_mapping_missing。',
  },
  {
    id: 'candidate-screen',
    name: '候选人硬筛与评分',
    required: ['先看候选人卡片/详情再决定是否触达', '本科、年限、当前公司、方向、去重作为硬筛'],
    evidence: ['候选人证据、跳过原因、评分和风险标签进入结构化输出', '必要时打开详情抽屉二次核验本科'],
    onFailure: '信息不足时跳过或降级，不允许无差别群发。',
  },
  {
    id: 'batch-confirmation',
    name: '批次确认与授权',
    required: ['默认首批和每 5 人给用户确认', '用户明确命中即发时才进入自动触达'],
    evidence: ['记录用户授权模式、批次摘要或自动触达依据'],
    onFailure: '未获授权时只输出候选人判断，不发送消息。',
  },
  {
    id: 'single-contact',
    name: '单人触达与留痕',
    required: ['每次只处理一个立即沟通弹窗', '清空残留文案、选择职位、填写个性化消息、发送后立即 record_contacted'],
    evidence: ['按钮由立即沟通变为沟通', 'run_candidates、interaction_log、run_trace 同步写入'],
    onFailure: '停止发送并保留弹窗/候选人证据，不把候选人攒到总结里补写。',
  },
  {
    id: 'exhaustion-and-risk',
    name: '轮次结束与风控处理',
    required: ['区分轮次刷薄、全局完成、用户停止、平台上限、验证码/权限限制', '页尾执行立即沟通扫尾复核'],
    evidence: ['终止原因和轮次统计进入总结', '触达/跳过原因可复盘'],
    onFailure: '不能把 0 触达或单轮无结果伪装成整轮成功。',
  },
];

export const MAIMAI_REQUIRED_STAGES_BEFORE_CONTACT = [
  'search-round',
  'platform-prefilter',
  'candidate-screen',
];

const MAIMAI_STAGE_IDS = new Set(MAIMAI_PROTOCOL_STAGES.map(stage => stage.id));
const MAIMAI_STAGE_PREREQUISITES: Record<string, string[]> = {
  'strategy-source': ['session-precheck'],
  'search-round': ['strategy-source'],
  'platform-prefilter': ['search-round'],
  'candidate-screen': ['platform-prefilter'],
  'batch-confirmation': ['candidate-screen'],
  'single-contact': ['batch-confirmation'],
  'exhaustion-and-risk': ['candidate-screen'],
};
const SIDE_EFFECT_ACTIONS = new Set<BrowserAction['action']>(['click', 'type', 'press', 'goto', 'back']);
const COMMUNICATION_LABEL = /立即沟通|沟通|招聘立即沟通|发送|消息|编辑区|智能索要|附带职位|留在此页|继续沟通/i;
const CONTACT_BUTTON_LABEL = /立即沟通|发送后留在此页|发送后继续沟通|发送/i;

function stageOf(action: BrowserAction): string | undefined {
  const value = action.stage_id ?? action.stageId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stageLabel(stageId: string): string {
  return MAIMAI_PROTOCOL_STAGES.find(stage => stage.id === stageId)?.name ?? stageId;
}

function recoveryLine(stageId: string): string {
  switch (stageId) {
    case 'strategy-source':
      return '先确认本轮规则来源：用户口径、talent-sourcing 输出、active job 或飞书策略；缺失时不要泛搜。';
    case 'search-round':
      return '先用 stage_id=search-round 设置关键词和公司桶/策略桶，并提交搜索。';
    case 'platform-prefilter':
      return '先用 stage_id=platform-prefilter 设置学校、公司、城市、学历、年限等筛选器。';
    case 'candidate-screen':
      return '先用 stage_id=candidate-screen 查看候选人卡片/详情，记录硬筛证据和评分。';
    case 'batch-confirmation':
      return '先获得用户批次确认，或记录用户已授权“命中即发/全部触达”。';
    case 'single-contact':
      return '进入 single-contact 前必须已有 prepare_contact 检查点，发送后立即 record_contacted。';
    default:
      return `回到 ${stageId} 阶段补齐可审计证据后再重试。`;
  }
}

function recovery(input: {
  targetStage?: string;
  missingStage?: string;
  observedStageIds?: string[];
  action?: BrowserAction['action'];
}): string {
  const observed = input.observedStageIds?.length
    ? input.observedStageIds.map(stageLabel).join(' -> ')
    : '无';
  const target = input.targetStage ? `${stageLabel(input.targetStage)} (${input.targetStage})` : '未声明阶段';
  const missing = input.missingStage ? `${stageLabel(input.missingStage)} (${input.missingStage})` : '未知前置阶段';
  return [
    `当前已留痕阶段：${observed}`,
    `被拦动作：${input.action ?? 'unknown'}，目标阶段：${target}`,
    `缺失前置阶段：${missing}`,
    recoveryLine(input.missingStage ?? input.targetStage ?? 'strategy-source'),
    '完成缺失阶段后重新 snapshot，再重试原动作；不要用宽泛搜索或群发绕过协议。',
  ].join('\n');
}

export function maimaiProtocolStages(): MaimaiProtocolStage[] {
  return MAIMAI_PROTOCOL_STAGES.map(stage => ({
    ...stage,
    required: [...stage.required],
    evidence: [...stage.evidence],
  }));
}

export function buildMaimaiSystemContext(): string {
  return [
    '# HireSeek 产品中层协议：脉脉平台',
    '',
    '这份协议是 HireSeek 产品内置的脉脉渠道能力协议，优先级高于外部 maimai-recruiter skill。',
    '外部 skill 仍可作为页面经验、异常案例、搜索/触达 playbook 和迁移素材参考；如果它与本协议冲突，以本协议为准。',
    '',
    '核心边界：',
    '- 脉脉执行层只负责渠道执行，不负责临时发明全局寻源策略。',
    '- 搜索策略必须来自用户当轮口径、talent-sourcing 输出、active job 原始事实或飞书策略；来源缺失时先停下补策略。',
    '- 平台筛选是前置步骤，筛不出的硬条件进入 candidate-screen 二次核验。',
    '- 默认人机协作：首批和每 5 人确认；只有用户明确“命中即发/全部触达”才自动发送。',
    '- 每条触达必须个性化、清空旧文案、选择职位、发送后立即 record_contacted。',
    '',
    formatMaimaiProtocolStages(),
  ].join('\n');
}

export function buildMaimaiTaskPrompt(opts: PlatformTaskPromptOptions = {}): string {
  const label = opts.channelLabel ?? '脉脉';
  const fromCurrent = !!opts.fromCurrent;
  const job = opts.activeJob;
  return [
    `请开始执行 ${label} 招聘 sourcing 任务。`,
    '',
    fromCurrent
      ? '你正在就地接管用户当前真实 Chrome 里的脉脉招聘页面；不要新开浏览器或新登录态。'
      : '请使用已登录的脉脉企业招聘端，从人才搜索页开始执行。',
    '',
    job ? `当前 active job：${job.title}` : '当前没有 active job 原始事实；只能做页面状态预检，不得臆造搜索策略。',
    '',
    '执行顺序必须遵守 stage manifest：session-precheck -> strategy-source -> search-round -> platform-prefilter -> candidate-screen -> batch-confirmation -> single-contact -> exhaustion-and-risk。',
    '触达前必须已经完成并留痕 search-round、platform-prefilter、candidate-screen。',
    '如果缺少搜索策略来源，先说明缺口并请求补齐；不要直接泛搜“AI人才”。',
    '任务完成后输出：触达人数、跳过人数、分轮次统计、触达明细、跳过原因、风险/上限/用户确认状态。',
  ].join('\n');
}

export function maimaiProcessRules(): string {
  return [
    '脉脉流程规则：',
    '- 仅使用 maimai.cn/ent 已登录招聘页面。',
    '- 搜索轮次来自明确策略；关键词 × 公司桶逐轮执行。',
    '- 平台筛选顺序：毕业学校、就职公司、城市、学历、工作年限、提交搜索。',
    '- 候选人硬筛：按钮状态、本科、年限、当前公司、方向、专业、去重。',
    '- 评分仅排序，不替代硬筛。',
    '- 默认首批与每 5 人确认；命中即发必须来自用户明确授权。',
    '- 发送前清空弹窗残留文案，选择职位，输入个性化消息，发送后校验按钮状态并 record_contacted。',
    '- 平台上限、权限限制、验证码、连续无新增时停止并报告，不伪装成功。',
  ].join('\n');
}

export function formatMaimaiProtocolStages(): string {
  return [
    '## 脉脉结构化阶段清单（stage manifest）',
    '',
    ...MAIMAI_PROTOCOL_STAGES.map((stage, index) => [
      `${index + 1}. ${stage.name} (${stage.id})`,
      `   必须完成：${stage.required.join('；')}`,
      `   可审计证据：${stage.evidence.join('；')}`,
      `   失败处理：${stage.onFailure}`,
    ].join('\n')),
  ].join('\n');
}

export const maimaiBrowserActionPolicy: BrowserActionPolicy = (
  action,
  context,
): BrowserActionPolicyDecision => {
  if (action.action === 'goto') {
    return {
      allowed: false,
      reason: '脉脉协议禁止在 runner 内直接跳转 URL；请通过当前页面内搜索、筛选、翻页、返回等真实入口完成站内流转。',
      recovery: '先 snapshot 当前页，查找人才搜索、关键词、筛选、职位选择或返回入口；若当前页不可用，让 orchestrator 重新进入脉脉人才搜索页。',
    };
  }

  const stageId = stageOf(action);
  const hasSideEffect = SIDE_EFFECT_ACTIONS.has(action.action);
  if (hasSideEffect && !stageId) {
    return {
      allowed: false,
      reason: `脉脉协议要求 ${action.action} 动作携带 stage_id；请先确认当前协议阶段再重试。`,
      recovery: `可用 stage_id：${MAIMAI_PROTOCOL_STAGES.map(stage => stage.id).join(', ')}`,
    };
  }
  if (stageId && !MAIMAI_STAGE_IDS.has(stageId)) {
    return {
      allowed: false,
      reason: `未知脉脉 stage_id=${stageId}；只能使用 stage manifest 中声明的阶段。`,
      recovery: `改用已声明 stage_id：${MAIMAI_PROTOCOL_STAGES.map(stage => stage.id).join(', ')}。`,
    };
  }

  const observed = new Set(context.observedStageIds ?? []);
  for (const prerequisite of stageId ? MAIMAI_STAGE_PREREQUISITES[stageId] ?? [] : []) {
    if (!observed.has(prerequisite)) {
      return {
        allowed: false,
        reason: `脉脉阶段门禁：${stageId} 之前必须先完成并留痕 ${prerequisite}。`,
        recovery: recovery({
          targetStage: stageId,
          missingStage: prerequisite,
          observedStageIds: context.observedStageIds,
          action: action.action,
        }),
      };
    }
  }

  if ((context.executionMode === 'dry_run' || context.executionMode === 'prepare') && hasSideEffect) {
    if (stageId === 'candidate-screen' || stageId === 'batch-confirmation' || stageId === 'single-contact') {
      return {
        allowed: false,
        reason: `${context.executionMode} 模式禁止进入候选人处理或触达阶段。`,
      };
    }
  }

  if (context.executionMode === 'screen' && hasSideEffect) {
    if (action.action === 'type' || action.action === 'press') {
      return { allowed: false, reason: 'screen 模式禁止向脉脉页面输入或发送内容。' };
    }
    if (context.actionLabel && COMMUNICATION_LABEL.test(context.actionLabel)) {
      return { allowed: false, reason: 'screen 模式检测到沟通/消息控件，禁止触达或进入聊天。' };
    }
  }

  if (context.executionMode === 'execute' && action.action === 'click' && context.actionLabel) {
    if (CONTACT_BUTTON_LABEL.test(context.actionLabel)) {
      if (!context.pendingContactName) {
        return { allowed: false, reason: '触达门禁：点击脉脉立即沟通/发送前必须先调用 prepare_contact 建立候选人证据检查点。' };
      }
      if (context.pendingContactAwaitingRecord) {
        return { allowed: false, reason: '触达门禁：上一位候选人已发送但尚未 record_contacted。' };
      }
    }
  }

  return { allowed: true };
};

export const maimaiRunCompletionPolicy: RunCompletionPolicy = context => {
  if (context.executionMode === 'execute' && context.pendingContactAwaitingRecord) {
    return { allowed: false, reason: `候选人 ${context.pendingContactName ?? ''} 已发送沟通但尚未 record_contacted。` };
  }
  if (context.executionMode === 'screen') {
    const observed = new Set(context.trace.filter(step => step.ok && step.stageId).map(step => step.stageId));
    if (!observed.has('candidate-screen')) {
      return { allowed: false, reason: 'screen 尚未留下脉脉候选人查看阶段 candidate-screen 的成功证据。' };
    }
    if ((context.screenedCandidateCount ?? 0) === 0) {
      return { allowed: false, reason: 'screen 尚未调用 record_screened_candidate 写入结构化候选人判断。' };
    }
  }
  if (context.executionMode === 'prepare') {
    const successful = context.trace.filter(step => step.ok);
    const searched = successful.some(step => step.stageId === 'search-round' && step.sideEffect);
    const filtered = successful.some(step => step.stageId === 'platform-prefilter' && step.sideEffect);
    if (!searched) return { allowed: false, reason: 'prepare 尚未留下脉脉搜索轮次设置动作。' };
    if (!filtered) return { allowed: false, reason: 'prepare 尚未留下脉脉平台筛选动作。' };
  }
  return { allowed: true };
};
