import type { BrowserAction } from '../browser-session';
import type { BrowserActionPolicy, BrowserActionPolicyDecision } from '../runners/interface';

export interface BossTaskPromptOptions {
  channelLabel?: string;
  fromCurrent?: boolean;
}

const BOSS_SESSION_RULES = [
  '优先复用用户已经登录的真实有头 Chrome 页面；不要创建新浏览器、新 profile、新标签页或无头会话。',
  '整轮任务只接管一个 BOSS 页面；如果发现额外 BOSS 页面、登录失效、验证码、滑块或 IP 风控，先停止自动化动作，再说明需要用户处理什么。',
  '恢复执行后的第一步只能做只读 snapshot/状态确认，确认页面可继续后才允许点击或输入。',
];

const BOSS_JOB_RULES = [
  '先确认当前页面所属职位是否等于系统提示中的目标岗位。',
  '职位名匹配要做归一化：忽略空格、地点、薪资等尾缀，不要只做原文精确匹配。',
  '如果当前职位不匹配，必须通过 BOSS 站内可见入口切换：职位下拉、职位列表、职位管理、推荐牛人入口等。',
  '如果目标职位不在可见列表中，继续在职位列表/下拉容器内滚动查找；仍找不到时记录 job_missing 并停止说明，不能把错误职位当目标职位处理。',
];

const BOSS_CANDIDATE_RULES = [
  '进入目标职位的推荐候选人页面后，优先处理主页面页签：推荐 -> 最新；精选只有用户明确要求时处理。',
  '筛选面板是强制前置步骤：先打开或识别已展开的筛选面板，再根据当前岗位事实设置经验、学历、院校、关键词、活跃度等可映射筛选项。',
  '筛选项必须逐项点击并验收激活状态；不要一口气批量点击多个筛选项后假设成功。',
  '页面筛选只能做第一层过滤；无法表达的学校、公司、复杂技能组合，作为候选人查看阶段的第二层判断。',
  '候选人处理必须先看可见证据，再决定是否打招呼；不要在列表页无差别群发。',
  '每次只点击一个打招呼/沟通按钮，点击前提取候选人姓名、公司、职位、地点和匹配证据；点击后确认状态变化，并立即调用 record_contacted。',
];

const BOSS_STOP_RULES = [
  '每日主动沟通上限出现时硬终止，停止所有点击、滚动、切职位动作，直接总结。',
  '操作太频繁/开聊太频繁时软退避，等待后继续，不要立即放弃整轮。',
  '单职位刷空的信号是没有更多、暂无更多、已加载全部、没有新的候选人、连续滚动无新增、或连续多批 0 命中且滚动停滞。',
  '出现重复候选人不能单独作为结束依据。',
  '当前页签刷空但还没到每日上限时，应按推荐 -> 最新 -> 下一个目标职位的顺序继续；不要把单职位刷空误报为整轮完成。',
];

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

### 候选人处理
${BOSS_CANDIDATE_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

### 终止与风控
${BOSS_STOP_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

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

## 候选人处理
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
5. 筛选项需要逐项点击并验收激活状态，不能批量盲点后假设成功。
6. 触达前必须能在轨迹里看到：确认目标岗位/职位上下文、使用平台筛选项、查看候选人证据。
7. 每次只能点击一个打招呼/沟通按钮，且每个已打招呼候选人必须立刻写 record_contacted，并保留 run_trace 与 interaction_log。
8. 当前页签或单职位刷空不等于整轮完成；未触发每日上限时应继续推荐、最新、后续目标职位或明确说明无目标职位可继续。
9. 未找到目标岗位、登录失效、验证码、账号风控、每日沟通上限时，应停止并清楚说明阻断原因；不能伪造 0 触达成功。
`.trim();
}
