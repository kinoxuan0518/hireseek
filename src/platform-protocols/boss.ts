import type { BrowserAction } from '../browser-session';
import type { BrowserActionPolicy, BrowserActionPolicyDecision, RunCompletionPolicy } from '../runners/interface';
import type { JobConfig } from '../skills/loader';

export interface BossTaskPromptOptions {
  channelLabel?: string;
  fromCurrent?: boolean;
  activeJob?: JobConfig | null;
}

export interface BossPrefilterPlan {
  experienceTags: string[];
  excludedExperienceTags: string[];
  schoolTags: string[];
  educationTags: string[];
  keywordTags: string[];
  recentUnviewed: string;
  scriptRefineFacts: string[];
  notes: string[];
}

export interface BossProtocolStage {
  id: string;
  name: string;
  required: string[];
  evidence: string[];
  onFailure: string;
}

const BOSS_SESSION_RULES = [
  '优先复用用户已经登录的真实有头 Chrome 页面；不要创建新浏览器、新 profile、新标签页或无头会话。',
  '整轮任务只接管一个 BOSS 页面；如果发现额外 BOSS 页面、登录失效、验证码、滑块或 IP 风控，先停止自动化动作，再说明需要用户处理什么。',
  '人工接管前必须强停所有 BOSS 自动化动作；用户接管期间禁止刷新、跳转、读 DOM、截图、重连或探测，直到用户明确说继续。',
  '恢复执行后的第一步只能做只读 snapshot/状态确认，确认页面可继续后才允许点击或输入。',
  '默认不抢焦点；只有后台 DOM 操作失败、权限限制且用户授权时，才允许最小化激活 Chrome，并在 trace 中记录 focus_activation_used。',
];

const BOSS_JOB_RULES = [
  '先确认当前页面所属职位是否等于系统提示中的目标岗位。',
  '职位名匹配要做归一化：忽略空格、地点、薪资等尾缀，不要只做原文精确匹配。',
  '如果当前职位不匹配，必须通过 BOSS 站内可见入口切换：职位下拉、职位列表、职位管理、推荐牛人入口等。',
  '职位下拉项可能在滚动容器外；点击前先 scrollIntoView，必要时允许 DOM 级点击回退。',
  '如果目标职位不在可见列表中，继续在职位列表/下拉容器内滚动查找；仍找不到时记录 job_missing，并跳过该职位或停止说明，不能把错误职位当目标职位处理。',
  '顶部 VIP/权益提示、悬浮引导拦截点击时，先 Esc 关闭，再尝试 force/DOM click；仍失败才记录下拉点击受阻。',
];

const BOSS_PREFILTER_RULES = [
  '筛选面板是强制前置步骤：先打开或识别已展开的筛选面板，再根据当前岗位事实设置经验、学历、院校、关键词、活跃度等可映射筛选项。',
  '筛选组合必须来自当前职位 facts / effective_prefilter；禁止把某个历史岗位的固定组合硬编码为所有职位默认规则。',
  '如果出现“是否应用上次的筛选条件”，且上次筛选正是本轮目标组合，优先应用；否则先清除旧条件，再按当前职位重选。',
  '筛选项必须逐项点击并验收 .option.active 等激活状态；不要一口气批量点击多个筛选项后假设成功。',
  '经验项禁止选择“26年后毕业”；卡片兜底解析遇到 27届、2027、28届、2028 等在校生信号，一律跳过。',
  '页面无法映射的条件要记录 prefilter_mapping_missing，并保留脚本精筛兜底；禁止臆造不存在的筛选项。',
  '页面筛选只能做第一层过滤；无法表达的学校、公司、复杂技能组合，作为候选人查看阶段的第二层判断。',
];

const BOSS_DOM_RULES = [
  '每次进入候选人页面必须先做 DOM 选择器探测：以“打招呼/立即沟通”按钮为锚点向上找候选人卡片容器，并记录本轮路径；禁止跨会话复用旧选择器。',
  '页签识别优先使用 li.tab-item 或等价稳定页签节点；禁止用通用 li 文本匹配，避免把候选人卡片误判为页签。',
  '候选人卡片识别需排除页签项、营销卡、外包广告卡等非候选元素。',
  '候选人主数据缺失时先记录 parse_quality，再决定跳过或降级评分；姓名或关键字段提取失败占比超过 20% 时在总结中提示可信度下降。',
];

const BOSS_CANDIDATE_RULES = [
  '进入目标职位的推荐候选人页面后，优先处理主页面页签：推荐 -> 最新；精选只有用户明确要求时处理。',
  '候选人处理必须先看可见证据，再决定是否打招呼；不要在列表页无差别群发。',
  '每次只点击一个打招呼/沟通按钮，打招呼类点击间隔遵守产品侧风控下限（≥5 秒），禁止批量循环点击。',
  '点击前提取候选人姓名、公司、职位、地点、学校、学历、技能标签和匹配证据；字段缺失写 null 并记录 parse_quality。',
  '点击后确认按钮状态变为继续沟通，并立即调用 record_contacted；不要把候选人攒到最终总结里才登记。',
];

const BOSS_STOP_RULES = [
  '每日主动沟通上限出现时硬终止，停止所有点击、滚动、切职位动作，直接总结。',
  '操作太频繁/开聊太频繁时软退避，等待后继续，不要立即放弃整轮。',
  '单职位刷空的信号是没有更多、暂无更多、已加载全部、没有新的候选人、连续滚动无新增、或连续多批 0 命中且滚动停滞。',
  '出现重复候选人不能单独作为结束依据。',
  '当前页签刷空但还没到每日上限时，应按推荐 -> 最新 -> 下一个目标职位的顺序继续；不要把单职位刷空误报为整轮完成。',
  '全部目标职位刷空但未触发每日上限时，允许进入全局补池轮；连续 3 轮仍无新增候选人才可用 pool_refill_exhausted 结束。',
];

const BOSS_PROTOCOL_STAGES: BossProtocolStage[] = [
  {
    id: 'session-precheck',
    name: '会话接管与只读预检',
    required: ['复用唯一真实有头 Chrome 页面', '只读确认登录/风控/验证码状态'],
    evidence: ['snapshot/status 确认当前 URL 与页面状态', '未出现新标签页、新 profile、headless 降级'],
    onFailure: '停止所有 BOSS 自动化动作，说明需要用户在受控页面处理什么。',
  },
  {
    id: 'job-positioning',
    name: '目标职位定位',
    required: ['归一化匹配当前职位与 active job', '不匹配时通过站内入口切换职位'],
    evidence: ['页面内 click/scroll/type 进入职位下拉或职位列表', '记录目标职位命中或 job_missing'],
    onFailure: '不能在错误职位继续处理；记录 job_missing 或页面阻断原因。',
  },
  {
    id: 'prefilter',
    name: '筛选面板前置',
    required: ['打开或识别已展开筛选面板', '按 prefilter plan 逐项选择并验收激活态'],
    evidence: ['筛选控件 click/type 动作早于候选人触达', '逐项 active 验收或复用上次筛选依据'],
    onFailure: '记录 prefilter_mapping_missing 或筛选失败原因；不能跳过筛选直接批量看人。',
  },
  {
    id: 'dom-probe',
    name: '候选人 DOM 探测',
    required: ['以打招呼按钮为锚点探测候选人卡片容器', '记录本轮选择器路径'],
    evidence: ['run trace 或总结出现 card/button path、parse_quality 统计'],
    onFailure: '记录 ERROR_DOM_PROBE_FAILED 并停止当前候选人列表处理。',
  },
  {
    id: 'candidate-screen',
    name: '候选人证据查看',
    required: ['先看可见证据再决定是否触达', '无法页面筛选的事实进入脚本精筛'],
    evidence: ['触达前存在候选人详情/卡片 snapshot', '候选人证据、风险标签、跳过原因进入结构化输出'],
    onFailure: '不允许列表页无差别群发；信息不足时记录风险或跳过。',
  },
  {
    id: 'single-contact',
    name: '单人触达与留痕',
    required: ['每次只点击一个沟通按钮', '点击后确认状态并立即 record_contacted'],
    evidence: ['打招呼动作间隔符合 >=5 秒', 'run_candidates、interaction_log、run_trace 同步写入'],
    onFailure: '停止批量点击；补写结构化记录或标记触达失败。',
  },
  {
    id: 'exhaustion-and-risk',
    name: '终止信号与风控处理',
    required: ['区分页签刷空、职位刷空、全局补池耗尽、每日上限', '风控/验证码/登录失效时强停'],
    evidence: ['终止原因为 daily_limit、job_missing、pool_refill_exhausted、user_interrupted 等明确枚举'],
    onFailure: '不能把 0 触达或单职位刷空伪装成整轮成功。',
  },
];

export function bossProtocolStages(): BossProtocolStage[] {
  return BOSS_PROTOCOL_STAGES.map(stage => ({
    ...stage,
    required: [...stage.required],
    evidence: [...stage.evidence],
  }));
}

export function formatBossProtocolStages(): string {
  return [
    '## BOSS 结构化阶段清单（stage manifest）',
    '',
    ...BOSS_PROTOCOL_STAGES.map((stage, index) => [
      `${index + 1}. ${stage.name} (${stage.id})`,
      `   必须完成：${stage.required.join('；')}`,
      `   可审计证据：${stage.evidence.join('；')}`,
      `   失败处理：${stage.onFailure}`,
    ].join('\n')),
  ].join('\n');
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function jobFacts(job: JobConfig | null | undefined): string[] {
  if (!job) return [];
  return [
    job.title,
    ...(job.requirements?.must_have ?? []),
    ...(job.requirements?.nice_to_have ?? []),
    ...(job.requirements?.deal_breaker ?? []),
  ].filter(Boolean);
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

function factLooksMapped(fact: string): boolean {
  return includesAny(fact, [
    /\d+\s*[-~到]\s*\d+\s*年/,
    /1\s*年以内|一年以内|应届|在校|毕业/,
    /本科|硕士|博士|学历/,
    /985|211|C9|QS|国内外名校|海外名校/,
    /Agent|智能体|LLM|大模型|RAG|NLP|自然语言|机器学习|推荐|Python|LangChain/i,
  ]);
}

export function buildBossPrefilterPlan(job: JobConfig | null | undefined): BossPrefilterPlan {
  const facts = jobFacts(job);
  const text = facts.join('\n');
  const experienceTags: string[] = [];
  if (/\b1\s*[-~到]\s*3\s*年|1\s*-\s*3\s*年|1到3年/.test(text)) experienceTags.push('1-3年');
  if (/\b3\s*[-~到]\s*5\s*年|3\s*-\s*5\s*年|3到5年/.test(text)) experienceTags.push('3-5年');
  if (/1\s*年以内|一年以内/.test(text)) experienceTags.push('1年以内');
  if (/应届|在校|25\s*年毕业|26\s*年毕业|25届|26届/.test(text)) {
    experienceTags.push('在校/应届', '25年毕业', '26年毕业');
  }

  const schoolTags: string[] = [];
  if (/985|C9/.test(text)) schoolTags.push('985');
  if (/QS|国内外名校|海外名校|名校/.test(text)) schoolTags.push('国内外名校');
  if (/211/.test(text)) schoolTags.push('211');

  const educationTags: string[] = [];
  if (/本科/.test(text)) educationTags.push('本科');
  if (/硕士/.test(text)) educationTags.push('硕士');
  if (/博士/.test(text)) educationTags.push('博士');

  const keywordTags: string[] = [];
  if (/Agent|智能体|LLM|大模型|RAG|LangChain/i.test(text)) keywordTags.push('大模型', 'AI Agent');
  if (/NLP|自然语言/i.test(text)) keywordTags.push('自然语言处理');
  if (/机器学习|ML/i.test(text)) keywordTags.push('机器学习');
  if (/推荐/.test(text)) keywordTags.push('推荐算法');
  if (/Python/i.test(text)) keywordTags.push('Python');

  const notes: string[] = [
    '经验项全局排除“26年后毕业”；27届/2027 及以后毕业信号必须脚本兜底跳过。',
    '页面没有对应选项的事实只进入脚本精筛，不允许臆造筛选项。',
  ];
  if (experienceTags.length === 0) notes.push('未从岗位事实解析到可映射经验项，执行时记录 prefilter_mapping_missing。');
  if (keywordTags.length === 0) notes.push('未从岗位事实解析到可映射关键词项，执行时记录 prefilter_mapping_missing。');

  const scriptRefineFacts = facts.filter(f => !factLooksMapped(f));

  return {
    experienceTags: uniq(experienceTags),
    excludedExperienceTags: ['26年后毕业'],
    schoolTags: uniq(schoolTags),
    educationTags: uniq(educationTags),
    keywordTags: uniq(keywordTags).slice(0, 4),
    recentUnviewed: '近14天没有',
    scriptRefineFacts,
    notes,
  };
}

function formatTags(values: string[]): string {
  return values.length ? values.join('、') : '无可安全映射项';
}

export function formatBossPrefilterPlan(job: JobConfig | null | undefined): string {
  if (!job) {
    return [
      '## 当前职位 BOSS 筛选前置计划',
      '',
      '当前没有 active job 原始事实；只能做页面状态预检，不得臆造岗位筛选项。',
    ].join('\n');
  }
  const plan = buildBossPrefilterPlan(job);
  return [
    '## 当前职位 BOSS 筛选前置计划（由 active job 原始事实生成）',
    '',
    `职位：${job.title}`,
    `经验要求：${formatTags(plan.experienceTags)}`,
    `经验排除：${formatTags(plan.excludedExperienceTags)}`,
    `院校筛选：${formatTags(plan.schoolTags)}`,
    `学历筛选：${formatTags(plan.educationTags)}`,
    `关键词筛选：${formatTags(plan.keywordTags)}`,
    `近期未看过：${plan.recentUnviewed}`,
    `脚本精筛/待确认事实：${formatTags(plan.scriptRefineFacts)}`,
    '',
    '执行要求：逐项点击并验收激活状态；无法映射的项不要硬选，记录 prefilter_mapping_missing 并留给候选人查看阶段判断。',
    ...plan.notes.map(note => `- ${note}`),
  ].join('\n');
}

export function buildBossTaskPrompt(opts: BossTaskPromptOptions = {}): string {
  const label = opts.channelLabel ?? 'BOSS直聘';
  const startMode = opts.fromCurrent
    ? '你正在就地接管用户当前真实 Chrome 中已经打开的 BOSS 页面。不要打开新浏览器、不要创建新登录态。'
    : '你正在使用当前已接管的浏览器会话执行 BOSS 招聘任务。';

  return `
请执行 ${label} sourcing 任务。目标岗位、候选人标准、触达风格来自系统提示中的当前 active job 和知识上下文。

${startMode}

## BOSS 平台执行协议

${formatBossProtocolStages()}

### 会话接管
${BOSS_SESSION_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

### 职位定位
${BOSS_JOB_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

### 筛选前置
${BOSS_PREFILTER_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

### DOM 探测
${BOSS_DOM_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

### 候选人处理与触达
${BOSS_CANDIDATE_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

### 终止与风控
${BOSS_STOP_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

${formatBossPrefilterPlan(opts.activeJob)}

## 动作边界
- 只能使用当前浏览器会话中的真实页面交互：snapshot、click、type、press、scroll、wait、必要时 back。
- 禁止用 browser.goto 直接跳深链或绕过站内流程；职位切换必须通过 BOSS 页面内可见入口完成。
- 如果页面停在错误职位，例如产品经理职位，而目标岗位是工程岗位，应自行在站内切到目标岗位，再进入对应推荐候选人列表。
- 不要把“当前职位不匹配”当成任务结束；只有找不到目标职位入口、登录/风控阻断、或用户账号权限不足时才停下来询问。
- 触达前必须先看候选人详情或足够证据，不允许列表页无差别群发。

任务完成后，请严格按以下格式输出总结：
触达人数: <数字>
跳过人数: <数字>
主要跳过原因: <简短描述>
候选人摘要: <简短描述>
`.trim();
}

export function buildBossSystemContext(): string {
  return `
# HireSeek 产品中层协议：BOSS 平台

这份协议是 HireSeek 产品内置的平台能力协议，优先级高于外部 skill 资产。
外部 BOSS skill 仍可作为历史经验、页面细节、异常案例和迁移素材参考；如果它与本协议冲突，以本协议为准。

${formatBossProtocolStages()}

## 会话接管
${BOSS_SESSION_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

## 职位定位
${BOSS_JOB_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

## 筛选前置
${BOSS_PREFILTER_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

## DOM 探测
${BOSS_DOM_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

## 候选人处理与触达
${BOSS_CANDIDATE_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

## 终止与风控
${BOSS_STOP_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

## 工具边界
- 任务执行阶段禁止 browser.goto 直接跳深链。
- 职位切换、推荐牛人入口、筛选、页签切换必须通过当前页面内真实交互完成。
- 代码层风控、工具策略、run trace 和结构化输出契约不能被 skill 文本覆盖。
`.trim();
}

const BOSS_STAGE_IDS = new Set(BOSS_PROTOCOL_STAGES.map(stage => stage.id));
const BOSS_STAGE_PREREQUISITES: Record<string, string[]> = {
  'job-positioning': ['session-precheck'],
  prefilter: ['job-positioning'],
  'dom-probe': ['prefilter'],
  'candidate-screen': ['dom-probe'],
  'single-contact': ['prefilter', 'candidate-screen'],
};
const PREPARE_SIDE_EFFECT_STAGES = new Set(['job-positioning', 'prefilter']);
const BROWSER_SIDE_EFFECT_ACTIONS = new Set<BrowserAction['action']>(['click', 'type', 'press', 'goto', 'back']);
const BOSS_CONTACT_LABEL = /打招呼|立即沟通|继续沟通|和\s*Ta\s*聊聊|聊一聊|发送|消息|聊天|沟通记录|新招呼|回复|送达|已读|未读|class="[^"]*(?:chat|message|editor|push-text|text-content|geek-item|gray)/i;
const BOSS_COMMUNICATION_CONTROL_LABEL = /打招呼|立即沟通|继续沟通|和\s*Ta\s*聊聊|聊一聊|发送|消息|聊天|沟通记录|新招呼|回复|送达|已读|未读|class="[^"]*(?:chat|message|editor)/i;
const BOSS_GREETING_LABEL = /打招呼|立即沟通|和\s*Ta\s*聊聊|聊一聊/i;
const BOSS_ALREADY_CONTACTED_LABEL = /继续沟通|已沟通/i;
const BOSS_PREPARE_JOB_CONTROL = /职位管理|推荐牛人|职位下拉|切换职位|招聘职位|我的职位|职位列表|选择职位|当前职位|目标职位|aria="[^"]*(?:职位|岗位)|title="[^"]*(?:职位|岗位)|role="combobox"|class="[^"]*dropmenu-label/i;
const BOSS_PREPARE_FILTER_CONTROL = /筛选|工作经验|经验|学历|院校|学校|关键词|活跃|未看|近\s*14\s*天|1\s*[-~到]\s*3\s*年|3\s*[-~到]\s*5\s*年|本科|硕士|博士|985|211|大模型|Agent|应用|确定|确认|取消|清除|重置|展开|收起|更多选项/i;
const BOSS_PREPARE_NAV_STRUCTURE = /<(?:button|a)\b|role="(?:button|link|tab|option|menuitem|combobox|treeitem)"|tabindex="0"|class="[^"]*(?:menu|nav|job|position|recommend|sidebar|dropdown|dropmenu|select)/i;
const BOSS_PREPARE_FILTER_STRUCTURE = /<(?:button|input|select)\b|role="(?:button|option|checkbox|radio|switch|combobox)"|tabindex="0"|class="[^"]*(?:filter|option|select|checkbox|radio|dropdown|panel|condition|tag|active|btn|cancel)/i;

function normalizedJobSignal(title: string | undefined): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/高级|资深|中级|初级|开发|工程师|专家|经理|负责人|岗位|职位/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function labelMatchesTargetJob(label: string, targetJobTitle: string | undefined): boolean {
  const signal = normalizedJobSignal(targetJobTitle);
  if (signal.length < 2) return false;
  return label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').includes(signal);
}

function prepareClickAllowed(stageId: string | undefined, label: string, targetJobTitle: string | undefined): boolean {
  if (stageId === 'job-positioning') {
    const hasJobIntent = BOSS_PREPARE_JOB_CONTROL.test(label) || labelMatchesTargetJob(label, targetJobTitle);
    return hasJobIntent && BOSS_PREPARE_NAV_STRUCTURE.test(label);
  }
  if (stageId === 'prefilter') {
    return BOSS_PREPARE_FILTER_CONTROL.test(label) && BOSS_PREPARE_FILTER_STRUCTURE.test(label);
  }
  return false;
}

function browserActionStage(action: BrowserAction): string | undefined {
  const value = action.stage_id ?? action.stageId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const bossBrowserActionPolicy: BrowserActionPolicy = (
  action: BrowserAction,
  context,
): BrowserActionPolicyDecision => {
  if (action.action === 'goto') {
    return {
      allowed: false,
      reason: 'BOSS 协议禁止在任务执行中直接跳转 URL；请通过当前页面内的职位入口、推荐牛人入口或搜索筛选控件完成站内流转。',
    };
  }

  const stageId = browserActionStage(action);
  const hasSideEffect = BROWSER_SIDE_EFFECT_ACTIONS.has(action.action);
  if (hasSideEffect && !stageId) {
    return {
      allowed: false,
      reason: `BOSS 协议要求 ${action.action} 动作携带 stage_id；请先确认当前协议阶段再重试。`,
    };
  }
  if (stageId && !BOSS_STAGE_IDS.has(stageId)) {
    return {
      allowed: false,
      reason: `未知 BOSS stage_id=${stageId}；只能使用 stage manifest 中声明的阶段。`,
    };
  }

  const observed = new Set(context.observedStageIds ?? []);
  for (const prerequisite of stageId ? BOSS_STAGE_PREREQUISITES[stageId] ?? [] : []) {
    if (!observed.has(prerequisite)) {
      return {
        allowed: false,
        reason: `BOSS 阶段门禁：${stageId} 之前必须先完成并留痕 ${prerequisite}。`,
      };
    }
  }

  if (context.executionMode === 'prepare' && hasSideEffect) {
    if (!stageId || !PREPARE_SIDE_EFFECT_STAGES.has(stageId)) {
      return {
        allowed: false,
        reason: `prepare 模式只允许职位定位和筛选前置动作，禁止阶段 ${stageId ?? 'unknown'} 的副作用操作。`,
      };
    }
    if (action.action === 'type' || action.action === 'press') {
      return {
        allowed: false,
        reason: `prepare 模式禁止 ${action.action}：安全验收不能向任何输入框写入内容或触发键盘发送。`,
      };
    }
    if (action.action === 'back') return { allowed: stageId === 'job-positioning', reason: 'prepare 模式只允许在职位定位阶段返回上一页。' };
    if (action.action !== 'click') {
      return {
        allowed: false,
        reason: `prepare 模式不允许 ${action.action} 副作用动作。`,
      };
    }
    if (!context.actionLabel) {
      return {
        allowed: false,
        reason: 'prepare 模式拒绝无法识别语义的点击控件。',
      };
    }
    if (BOSS_CONTACT_LABEL.test(context.actionLabel)) {
      return {
        allowed: false,
        reason: 'prepare 模式检测到消息或候选人沟通控件，禁止打招呼或发送消息。',
      };
    }
    if (!prepareClickAllowed(stageId, context.actionLabel, context.targetJobTitle)) {
      return {
        allowed: false,
        reason: `prepare 模式只允许点击目标职位导航或筛选控件，已拒绝：${context.actionLabel.slice(0, 140)}`,
      };
    }
  }

  if (context.executionMode === 'screen' && hasSideEffect) {
    if (action.action === 'type' || action.action === 'press') {
      return {
        allowed: false,
        reason: `screen 模式禁止 ${action.action}：候选人筛选验收不能向页面输入或发送内容。`,
      };
    }
    if (action.action === 'back' && stageId !== 'candidate-screen') {
      return {
        allowed: false,
        reason: 'screen 模式只有候选人查看阶段允许 back；职位定位/筛选阶段请使用页面内推荐牛人、职位下拉或可见返回入口，避免退回旧职位。',
      };
    }
    if (action.action === 'click') {
      if (stageId === 'single-contact') {
        return { allowed: false, reason: 'screen 模式禁止进入 single-contact；只能查看候选人并输出判断。' };
      }
      if (context.actionLabel && BOSS_COMMUNICATION_CONTROL_LABEL.test(context.actionLabel)) {
        return { allowed: false, reason: 'screen 模式检测到沟通控件，禁止打招呼、发送消息或进入聊天。' };
      }
    }
  }

  if (context.executionMode === 'execute' && action.action === 'click' && context.actionLabel) {
    if (BOSS_ALREADY_CONTACTED_LABEL.test(context.actionLabel)) {
      return { allowed: false, reason: '该候选人已经沟通过，禁止重复触达。' };
    }
    if (BOSS_GREETING_LABEL.test(context.actionLabel)) {
      if (!context.pendingContactName) {
        return { allowed: false, reason: '触达门禁：点击打招呼前必须先调用 prepare_contact 建立候选人证据检查点。' };
      }
      if (context.pendingContactAwaitingRecord) {
        return { allowed: false, reason: '触达门禁：上一位候选人已点击沟通但尚未 record_contacted。' };
      }
      if (!context.actionLabel.includes(context.pendingContactName)) {
        return {
          allowed: false,
          reason: `触达门禁：当前按钮上下文与检查点候选人“${context.pendingContactName}”不一致。`,
        };
      }
    }
  }

  return { allowed: true };
};

const BOSS_FILTER_SUBMIT_LABEL = /(?:确定|应用|确认)(?!取消)/i;

export const bossRunCompletionPolicy: RunCompletionPolicy = context => {
  if (context.executionMode === 'execute' && context.pendingContactAwaitingRecord) {
    return { allowed: false, reason: `候选人 ${context.pendingContactName ?? ''} 已点击沟通但尚未 record_contacted。` };
  }
  if (context.executionMode === 'screen') {
    const observed = new Set(context.trace.filter(step => step.ok && step.stageId).map(step => step.stageId));
    if (!observed.has('candidate-screen')) {
      return { allowed: false, reason: 'screen 尚未留下候选人查看阶段 candidate-screen 的成功证据。' };
    }
    return { allowed: true };
  }
  if (context.executionMode !== 'prepare') return { allowed: true };

  const successful = context.trace.filter(step => step.ok);
  const positioned = labelMatchesTargetJob(context.pageSnapshot, context.targetJobTitle);
  const filtered = successful.some(step => step.stageId === 'prefilter' && step.sideEffect);
  if (!positioned) {
    return { allowed: false, reason: '当前页面没有可验证的目标职位信号，prepare 尚未完成职位定位。' };
  }
  if (!filtered) {
    return { allowed: false, reason: 'prepare 尚未留下成功的筛选动作。' };
  }
  const visibleSubmit = context.pageSnapshot
    .split('\n')
    .some(line => line.startsWith('[ref=') && BOSS_FILTER_SUBMIT_LABEL.test(line));
  const submitted = successful.some(step =>
    step.stageId === 'prefilter' &&
    step.action === 'click' &&
    !!step.actionLabel &&
    BOSS_FILTER_SUBMIT_LABEL.test(step.actionLabel),
  );
  if (visibleSubmit && !submitted) {
    return {
      allowed: false,
      reason: '筛选面板仍显示“确定/应用”控件；必须成功提交筛选后才能完成 prepare。',
    };
  }

  return { allowed: true };
};

export function bossProcessRules(): string {
  return `
BOSS 平台过程规则：
${formatBossProtocolStages()}

1. 当前页面职位与目标岗位不一致时，不能直接结束或要求用户手动切；应优先通过 BOSS 站内可见入口切到目标岗位。
2. 职位匹配必须做标题归一化；目标职位不在下拉/列表中时应记录 job_missing，不能用错误职位继续处理。
3. 职位切换、进入推荐牛人、进入候选人列表，都应通过页面内 click/type/press/scroll 等真实交互完成，不能用直接 URL 深链代替。
4. 进入候选人列表后必须先处理筛选面板，并能在轨迹中看到筛选控件交互；筛选项应对应岗位事实。
5. 筛选项需要逐项点击并验收激活状态，不能批量盲点后假设成功；如果使用上次筛选条件，轨迹或总结应说明复用依据。
6. 每次进入候选人页面必须先做 DOM 探测，记录候选人卡片/打招呼按钮路径；不能跨会话复用旧选择器。
7. 触达前必须能在轨迹里看到：确认目标岗位/职位上下文、使用平台筛选项、查看候选人证据。
8. 每次只能点击一个打招呼/沟通按钮，打招呼类点击应遵守 ≥5 秒节奏，且每个已打招呼候选人必须立刻写 record_contacted，并保留 run_trace 与 interaction_log。
9. 当前页签或单职位刷空不等于整轮完成；未触发每日上限时应继续推荐、最新、后续目标职位或明确说明无目标职位可继续。
10. 未找到目标岗位、登录失效、验证码、账号风控、每日沟通上限时，应停止并清楚说明阻断原因；不能伪造 0 触达成功。
11. 人工接管期间必须零动作；用户说继续后第一步只能做只读状态确认。
`.trim();
}
