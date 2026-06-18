import type { BrowserAction } from '../browser-session';
import type { BrowserActionPolicy, BrowserActionPolicyDecision } from '../runners/interface';
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

export const bossBrowserActionPolicy: BrowserActionPolicy = (
  action: BrowserAction,
): BrowserActionPolicyDecision => {
  if (action.action === 'goto') {
    return {
      allowed: false,
      reason: 'BOSS 协议禁止在任务执行中直接跳转 URL；请通过当前页面内的职位入口、推荐牛人入口或搜索筛选控件完成站内流转。',
    };
  }

  return { allowed: true };
};

export function bossProcessRules(): string {
  return `
BOSS 平台过程规则：
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
