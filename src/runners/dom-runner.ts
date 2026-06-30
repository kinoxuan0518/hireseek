/**
 * DOM Runner：纯文本浏览器驱动，专为无视觉能力的 LLM（如 DeepSeek）设计。
 *
 * 原理：不截图，而是提取页面的结构化文本快照——
 *   1. 给所有可交互元素打上 data-hs-ref 编号标记
 *   2. 把「元素清单 + 页面正文」作为文本回传给模型
 *   3. 模型通过 function calling 输出 click(ref)/type(ref,text) 等动作
 *   4. Playwright 按 ref 精确定位执行，再回传新快照
 *
 * 相比视觉方案的优势：token 更省、定位更准（无坐标偏差）、支持任何文本模型。
 */

import OpenAI from 'openai';
import { Page } from 'playwright';
import { emitLog, popIntervention } from '../events';
import { parseSkillSummary, parseContactedCandidates } from './interface';
import type { LLMRunner, RunSkillOptions } from './interface';
import type { SkillResult } from '../types';
import { repairToolMessageHistoryInPlace } from '../message-integrity';
import type { BrowserAction, BrowserLiveState, BrowserTarget, RiskGuard } from '../browser-session';
import { isDomBrowserSession } from '../browser-session';
import { recordRejectedToolCall, recordToolCall } from '../agent-core/trace';
import { offloadToolOutput } from '../agent-core/tool-output-store';
import { upsertAgentRunState, type AgentRunStatus } from '../agent-core/run-state-store';
import {
  upsertExecutionEnvironment,
  type ExecutionEnvironmentController,
  type ExecutionEnvironmentStatus,
} from '../agent-core/environment-store';
import {
  createToolRegistry,
  unknownToolResult,
  type ToolExecutionMode,
} from '../agent-core/tool-registry';

export type { BrowserAction, RiskGuard } from '../browser-session';

const MAX_TURNS = 150;
const MAX_BODY_TEXT = 6000;
const MAX_ELEMENTS = 120;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
type SkillExecutionMode = 'execute' | 'dry_run' | 'prepare' | 'screen';

// ── 风控规则（代码层硬约束，不依赖模型遵守 prompt）──────────────────────
/** 打招呼类按钮的最小点击间隔（毫秒） */
export const GREETING_MIN_INTERVAL_MS = 5000;
/** 打招呼类按钮文案特征 */
export const GREETING_PATTERN = /打招呼|立即沟通|继续沟通|和Ta聊聊|聊一聊/;
/** 每日上限弹窗特征 → 立即硬终止 */
export const DAILY_LIMIT_PATTERN = /今日主动沟通数已达上限|需付费购买|今日沟通已达上限|超出今日限制/;
/** 频率告警特征 → 软退避 10-30 秒 */
export const FREQUENCY_PATTERN = /开聊太频繁|操作太频繁|操作过于频繁|请稍后再试/;

// ── 浏览器工具定义（OpenAI function calling 格式）──────────────────────
const BROWSER_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser',
    description:
      '控制浏览器执行招聘操作。每次调用执行一个动作，动作后会收到最新的页面文本快照。' +
      '快照中可交互元素以 [ref=N] 标注，click/type 时传入对应的 ref 数字。',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'snapshot', // 重新获取页面快照
            'click',    // 点击元素（需要 ref）
            'type',     // 在输入框中输入文字（需要 ref + text）
            'press',    // 按下键盘按键（如 Enter、Escape）
            'scroll',   // 滚动页面
            'goto',     // 跳转到指定 URL
            'back',     // 返回上一页
            'wait',     // 等待页面加载（毫秒）
          ],
          description: '要执行的操作类型',
        },
        ref: {
          type: 'number',
          description: '目标元素的 ref 编号（快照中 [ref=N] 的 N），click/type 时必填',
        },
        text: {
          type: 'string',
          description: 'type 时填输入内容，press 时填按键名（如 Enter、Tab、Escape）',
        },
        url: {
          type: 'string',
          description: 'goto 时的目标 URL',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'scroll 时的滚动方向，默认 down',
        },
        amount: {
          type: 'number',
          description: 'scroll 时的像素距离（默认 600），或 wait 时的毫秒数（默认 1500）',
        },
        stage_id: {
          type: 'string',
          description: '可选：当前动作所属的协议阶段 id。若任务提示给出了 stage manifest，应填写其中一个 id。',
        },
      },
    },
  },
};

// 结构化产出工具——履约 canonical 契约 contacted-candidate.v1。
// 每联系完一个候选人就调一次，让下游 verifier/漏斗拿到结构化数据，而不是事后从总结文本里猜。
const RECORD_CONTACTED_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'record_contacted',
    description:
      '每当你联系（打招呼）完一个候选人，立刻调用本工具，逐条登记这个候选人的结构化信息。' +
      '这是产出的【唯一权威来源】——不要只在最后的总结里写名单，必须每人一次调用。' +
      '如果 greeting_sent=true，必须填写 evidence、personalization_evidence、message_intent、greeting_text。',
    parameters: {
      type: 'object',
      required: ['name', 'greeting_sent', 'evidence', 'personalization_evidence', 'message_intent'],
      properties: {
        name:         { type: 'string', description: '候选人姓名（页面所见）' },
        company:      { type: 'string', description: '当前/最近公司' },
        title:        { type: 'string', description: '当前/最近职位' },
        location:     { type: 'string', description: '所在城市/地区' },
        evidence:     { type: 'string', description: '为什么联系 ta 的一句话依据（来自列表/简历可见信息）' },
        personalization_evidence: {
          type: 'string',
          description: '招呼语里实际使用的候选人真实信息点，例如公司、项目、技术方向、学校或经历。不能写“背景匹配”这种泛话。',
        },
        message_intent: {
          type: 'string',
          description: '这条招呼想激发对方回应的理由，例如技术挑战、成长空间、方向匹配、团队影响力、稳定性等。',
        },
        risk_flags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：信息不足或可能误判的风险标签，例如 no_company_detail、unclear_agent_experience、generic_message_risk。',
        },
        fit_tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：命中的匹配标签，例如 Agent、RAG、大厂、明星创业、1-3年、工程平台。',
        },
        fit_score:    { type: 'number', description: '你的自评匹配分 0-100' },
        greeting_sent:{ type: 'boolean', description: '是否真的发出了打招呼（false=看了但跳过）' },
        greeting_text:{ type: 'string', description: '实际发出的打招呼文案' },
        profile_url:  { type: 'string', description: '候选人详情页 URL（如能取到）' },
        contact_token:{ type: 'string', description: 'prepare_contact 返回的 token；greeting_sent=true 时必填且必须一致' },
      },
    },
  },
};

const RECORD_SCREENED_CANDIDATE_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'record_screened_candidate',
    description:
      '在 screen 候选人筛选验收模式下，每查看并判断一个候选人后调用本工具。' +
      '它只记录筛选判断，不代表触达，不会写入候选人主档或 interaction_log。' +
      '正式 execute 只能优先从这些结构化 screen 记录中选择候选人。',
    parameters: {
      type: 'object',
      required: ['name', 'recommendation', 'evidence'],
      properties: {
        name: { type: 'string', description: '候选人姓名（页面所见）' },
        company: { type: 'string', description: '当前/最近公司' },
        title: { type: 'string', description: '当前/最近职位' },
        location: { type: 'string', description: '所在城市/地区' },
        recommendation: {
          type: 'string',
          enum: ['contact', 'maybe', 'skip'],
          description: 'screen 判断：contact=建议正式触达；maybe=可考虑；skip=跳过。',
        },
        evidence: { type: 'string', description: '判断依据，必须引用页面可见的具体经历、公司、项目或技能' },
        risk_flags: { type: 'array', items: { type: 'string' } },
        fit_tags: { type: 'array', items: { type: 'string' } },
        fit_score: { type: 'number', description: '匹配分 0-100' },
        profile_url: { type: 'string' },
      },
    },
  },
};

const PREPARE_CONTACT_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'prepare_contact',
    description:
      '在点击“打招呼”之前建立候选人证据检查点。只有本工具返回 contact_token 后，代码才允许点击该候选人的沟通按钮。' +
      '每次只准备一个候选人；点击后必须立即用同一 token 调用 record_contacted。',
    parameters: {
      type: 'object',
      required: ['name', 'evidence', 'personalization_evidence', 'message_intent', 'greeting_text', 'fit_score'],
      properties: {
        name: { type: 'string', description: '当前候选人姓名，必须来自页面可见证据' },
        company: { type: 'string', description: '当前/最近公司' },
        title: { type: 'string', description: '当前/最近职位' },
        location: { type: 'string', description: '所在城市/地区' },
        evidence: { type: 'string', description: '联系依据，必须引用页面可见的具体经历或技能' },
        personalization_evidence: { type: 'string', description: '招呼语实际使用的候选人具体信息点' },
        message_intent: { type: 'string', description: '希望候选人回应的理由' },
        greeting_text: { type: 'string', description: '准备发送或平台实际采用的招呼文案' },
        fit_score: { type: 'number', description: '匹配分 0-100' },
        risk_flags: { type: 'array', items: { type: 'string' } },
        fit_tags: { type: 'array', items: { type: 'string' } },
        profile_url: { type: 'string' },
      },
    },
  },
};

export const DOM_RUNNER_TOOL_REGISTRY = createToolRegistry([
  BROWSER_TOOL,
  PREPARE_CONTACT_TOOL,
  RECORD_CONTACTED_TOOL,
  RECORD_SCREENED_CANDIDATE_TOOL,
]);

const DOM_RUNNER_TOOL_NAMES_BY_MODE: Record<SkillExecutionMode, string[]> = {
  dry_run: ['browser'],
  prepare: ['browser'],
  screen: ['browser', 'record_screened_candidate'],
  execute: ['browser', 'prepare_contact', 'record_contacted'],
};

export function domRunnerToolNamesForMode(mode: SkillExecutionMode = 'execute'): string[] {
  return [...DOM_RUNNER_TOOL_NAMES_BY_MODE[mode]];
}

export function domRunnerToolsForMode(mode: SkillExecutionMode = 'execute'): OpenAI.ChatCompletionTool[] {
  return domRunnerToolNamesForMode(mode)
    .map(name => DOM_RUNNER_TOOL_REGISTRY.get(name)?.schema)
    .filter(Boolean) as OpenAI.ChatCompletionTool[];
}

const DOM_GUIDE = `
## 浏览器操作说明（文本模式）

你看不到页面截图，但每次操作后会收到页面的**文本快照**，包含：
- 当前 URL 和标题
- 可交互元素清单：每行形如 [ref=N] <标签> 文字内容
- 页面正文摘要

操作规范：
1. **开始前先 snapshot** 查看当前页面状态
2. **每次只执行一个动作**，动作后根据新快照决定下一步
3. **click/type 必须用快照里出现过的 ref**，不要凭空猜测编号
4. 输入搜索词后通常需要 press(text="Enter") 提交
5. 列表页内容不全时用 scroll(direction="down") 加载更多
6. 页面跳转后旧 ref 全部失效，必须依据新快照操作
7. 如果任务提示包含 stage manifest，browser 调用应带上当前阶段的 stage_id，方便流程审计。
8. **触达必须走两阶段握手**：先调用 prepare_contact 提交候选人证据并拿到 contact_token；再点击同一候选人的打招呼按钮；点击成功后立刻用同一 token 调用 record_contacted。禁止先点后补记录。
9. **任务完成后**：直接回复文字总结，不再调用工具

输出总结时必须包含（注意：结构化名单已由 record_contacted 逐条登记，总结里的名单只是给人看的摘要）：
触达人数: <数字>
跳过人数: <数字>
已触达候选人清单（每个已打招呼的人一行，格式：姓名 | 公司 | 自评分(0-100) | 一句话匹配理由）：
- 张三 | 字节跳动 | 82 | 2年Agent平台经验，与岗位高度匹配
（没有触达任何人就写"已触达候选人清单：无"）
`.trim();

const DRY_RUN_GUIDE = `
## Dry-run / 预检模式

当前处于 dry-run。你只能观察页面和判断下一步，不允许产生外部副作用。
- 可以使用 browser snapshot / wait / scroll。
- 禁止 click / type / press / goto / back；这些动作会被工具层拒绝，不会执行。
- 禁止声称已经打招呼，record_contacted 只能用于 greeting_sent=false 的观察记录。
- 任务结束时输出：当前页面状态、目标岗位是否匹配、下一步正式执行前需要做什么。
`.trim();

const PREPARE_GUIDE = `
## Prepare 安全验收模式（代码硬约束）

本轮只允许完成 BOSS 的目标职位定位与筛选面板前置，不允许查看或联系候选人：
- 只能通过当前页面内 click/scroll 切换到 active job，并逐项设置筛选条件。
- type 和 press 在 prepare 中一律禁止，避免误把导航词写入聊天框或触发发送。
- 所有有副作用动作必须填写 stage_id，且只能使用 job-positioning 或 prefilter。
- 点击只允许目标职位导航和筛选控件；无法识别语义的控件会被拒绝。
- 禁止点击打招呼/立即沟通/发送消息等候选人沟通控件。
- 如果筛选面板显示“确定/应用/确认”，必须成功点击提交；不能只凭 active 文案宣称完成。
- 完成目标职位确认和筛选激活态验收后立即输出总结，不进入 candidate-screen/single-contact。
`.trim();

const SCREEN_GUIDE = `
## Screen 候选人筛选验收模式（代码硬约束）

本轮只允许查看候选人并输出筛选判断，不允许联系候选人：
- 可以通过当前页面内 click/scroll/back 查看候选人卡片或详情，动作必须携带 stage_id。
- 禁止 type / press / goto，避免写入聊天框、发送消息或跳过站内流程。
- 禁止点击打招呼/立即沟通/发送消息等沟通控件；代码层会拒绝。
- 禁止调用 prepare_contact 建立真实触达检查点。
- 从候选人详情回列表只能在 candidate-screen 阶段用 browser back，或使用页面内可见返回/推荐牛人入口；不要用 press Escape。
- 职位定位/筛选阶段禁止用 back，避免回到旧职位或旧筛选状态。
- 返回列表或切换 推荐/最新/精选 tab 前必须重新 snapshot，并确认目标 ref 的 scope/rect/context 是列表导航或页签，不是候选人卡片。
- 每查看并判断一个候选人后必须调用 record_screened_candidate，记录 contact/maybe/skip、证据和风险。
- 不要用 record_contacted 做 screen 记录；record_contacted 只属于正式触达。
- 结束时输出：查看了哪些候选人、谁值得正式触达、谁应跳过、证据和风险点。
`.trim();

const DRY_RUN_ALLOWED_BROWSER_ACTIONS = new Set<BrowserAction['action']>(['snapshot', 'wait', 'scroll']);
const SCREEN_BLOCKED_BROWSER_ACTIONS = new Set<BrowserAction['action']>(['type', 'press', 'goto']);

export function dryRunBlocksBrowserAction(input: BrowserAction): boolean {
  return !DRY_RUN_ALLOWED_BROWSER_ACTIONS.has(input.action);
}

export function screenBlocksBrowserAction(input: BrowserAction): boolean {
  return SCREEN_BLOCKED_BROWSER_ACTIONS.has(input.action);
}

export function browserActionMode(input: BrowserAction, executionMode: SkillExecutionMode = 'execute'): ToolExecutionMode {
  if (executionMode !== 'execute') return executionMode;
  return input.action === 'snapshot' ? 'read' : 'execute';
}

export function browserActionHasSideEffect(input: BrowserAction, executionMode: SkillExecutionMode = 'execute'): boolean {
  if (executionMode === 'dry_run') return dryRunBlocksBrowserAction(input);
  return !['snapshot', 'wait', 'scroll'].includes(input.action);
}

function browserActionStageId(input: BrowserAction): string | undefined {
  const raw = input.stage_id ?? input.stageId;
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? text.slice(0, 80) : undefined;
}

function snapshotRefLabel(snapshot: string, ref: number | undefined): string | undefined {
  if (ref == null) return undefined;
  return snapshot.split('\n').find(line => line.trimStart().startsWith(`[ref=${ref}]`))?.trim();
}

function snapshotUrl(snapshot: string): string {
  return snapshot.split('\n').find(line => line.startsWith('URL: '))?.slice(5).trim() ?? 'unknown';
}

function snapshotTitle(snapshot: string): string {
  return snapshot.split('\n').find(line => line.startsWith('标题: '))?.slice(4).trim() ?? '';
}

function summarizeSnapshotForRunState(snapshot: string): string {
  return snapshot
    .split('\n')
    .filter(line =>
      line.startsWith('URL: ') ||
      line.startsWith('标题: ') ||
      line.startsWith('滚动位置: ') ||
      line.startsWith('[工具输出已卸载]') ||
      line.startsWith('path: '),
    )
    .join('\n')
    .slice(0, 1200);
}

function normalizeOwnershipUrl(url: string | undefined): string {
  return (url ?? '').trim().replace(/\/$/, '');
}

function browserEnvironmentId(page: BrowserTarget): string {
  return isDomBrowserSession(page) ? `browser:${page.kind}` : 'browser:playwright';
}

export interface BrowserOwnershipDecision {
  suspected: boolean;
  reason?: string;
}

export function userInterventionRequestsBrowserPause(text: string): boolean {
  return /停下|停止|暂停|接管|我在用|别动|不要接管|不是机器飘移|不是机器漂移|stop/i.test(text);
}

export function detectExternalBrowserControl(
  observedSnapshot: string,
  liveState: BrowserLiveState | null | undefined,
): BrowserOwnershipDecision {
  if (!liveState) return { suspected: false };
  if (liveState.active === false) {
    return {
      suspected: true,
      reason: '当前受控 Chrome 标签页已不再是激活标签，可能是用户正在使用浏览器。',
    };
  }

  const observedUrl = normalizeOwnershipUrl(snapshotUrl(observedSnapshot));
  const liveUrl = normalizeOwnershipUrl(liveState.url);
  if (observedUrl && observedUrl !== 'unknown' && liveUrl && observedUrl !== liveUrl) {
    return {
      suspected: true,
      reason: `页面 URL 已从 ${observedUrl} 变为 ${liveUrl}，变化不是本次工具动作产生的。`,
    };
  }

  return { suspected: false };
}

async function readBrowserLiveState(page: BrowserTarget): Promise<BrowserLiveState | null> {
  try {
    if (isDomBrowserSession(page)) {
      if (page.liveState) return await page.liveState();
      return {
        url: await page.url(),
        title: snapshotTitle(await page.snapshot()),
        active: true,
      };
    }
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      active: true,
    };
  } catch {
    return null;
  }
}

export function successfulStageIds(trace: SkillResult['trace'] = []): string[] {
  return Array.from(new Set(
    (trace ?? []).filter(step => step.ok).map(step => step.stageId).filter((value): value is string => !!value),
  ));
}

/**
 * 提取页面文本快照：标记可交互元素 + 收集正文。
 * 在浏览器上下文中执行，给元素写入 data-hs-ref 属性供后续定位。
 */
export async function takeDomSnapshot(page: Page): Promise<string> {
  // tsx/esbuild 的 keepNames 会向 evaluate 回调注入 __name 辅助调用，浏览器端需兜底定义
  await page.evaluate('window.__name = window.__name || ((fn) => fn)');
  const data = await page.evaluate(
    ({ maxElements, maxBodyText }) => {
      const isVisible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };

      const selector = [
        'a', 'button', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="option"]',
        '[role="menuitem"]', '[role="checkbox"]', '[role="combobox"]', '[role="switch"]',
        '[role="radio"]', '[role="treeitem"]', '[contenteditable="true"]',
        '[onclick]', '[tabindex="0"]',
      ].join(',');

      const elementContext = (el: Element, ownText: string): string => {
        let parent = el.parentElement;
        for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
          const text = (parent.textContent || '').trim().replace(/\s+/g, ' ');
          if (text && text !== ownText && text.length <= 360) {
            return text.slice(0, 220).replace(/"/g, "'");
          }
        }
        return '';
      };

      const elementRect = (el: Element): string => {
        const rect = el.getBoundingClientRect();
        return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}`;
      };

      document.querySelectorAll('[data-hs-ref]').forEach(el => el.removeAttribute('data-hs-ref'));
      const elements = Array.from(document.querySelectorAll('*')).filter(el => {
        if (!isVisible(el)) return false;
        if (el.matches(selector)) return true;
        if (el === document.body || el === document.documentElement) return false;
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        // 图标类可点元素：无文字但有 aria-label/title，也要捕获（SPA 侧栏/选择器常见）
        const name = text || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!name || name.length > 120 || window.getComputedStyle(el).cursor !== 'pointer') return false;
        const interactiveChild = el.querySelector(selector);
        if (interactiveChild && isVisible(interactiveChild)) {
          const childText = (interactiveChild.textContent || '').trim().replace(/\s+/g, ' ');
          if (childText === text) return false;
        }
        const parent = el.parentElement;
        if (!parent || parent === document.body || !isVisible(parent)) return true;
        const parentText = (parent.textContent || '').trim().replace(/\s+/g, ' ');
        return window.getComputedStyle(parent).cursor !== 'pointer' || parentText !== text;
      });

      const lines: string[] = [];
      let refCounter = 0;

      for (const el of elements) {
        if (refCounter >= maxElements) break;
        const ref = ++refCounter;
        el.setAttribute('data-hs-ref', String(ref));

        const tag = el.tagName.toLowerCase();
        const input = el as HTMLInputElement;
        const parts: string[] = [`[ref=${ref}] <${tag}${input.type ? ` type=${input.type}` : ''}>`];
        parts.push('scope="main"');
        parts.push(`rect="${elementRect(el)}"`);

        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (text) parts.push(text);
        if (input.placeholder) parts.push(`placeholder="${input.placeholder}"`);
        if (input.value && tag === 'input') parts.push(`value="${String(input.value).slice(0, 40)}"`);
        if (el.getAttribute('aria-label')) parts.push(`aria="${el.getAttribute('aria-label')}"`);
        if (el.getAttribute('title') && !text) parts.push(`title="${el.getAttribute('title')!.slice(0, 60)}"`);
        if (el.getAttribute('role')) parts.push(`role="${el.getAttribute('role')}"`);
        if (el.getAttribute('tabindex') != null) parts.push(`tabindex="${el.getAttribute('tabindex')}"`);
        if (el.className && typeof el.className === 'string') parts.push(`class="${el.className.slice(0, 80)}"`);
        if (window.getComputedStyle(el).cursor === 'pointer') parts.push('pointer=true');
        for (const state of ['aria-selected', 'aria-pressed', 'aria-checked']) {
          const value = el.getAttribute(state);
          if (value != null) parts.push(`${state}="${value}"`);
        }
        const context = elementContext(el, text);
        if (context) parts.push(`context="${context}"`);

        lines.push(parts.join(' '));
      }

      const bodyText = (document.body?.innerText || '')
        .replace(/\n{3,}/g, '\n\n')
        .slice(0, maxBodyText);

      return {
        url: location.href,
        title: document.title,
        elements: lines,
        bodyText,
        scrollY: Math.round(window.scrollY),
        scrollMax: Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight)),
      };
    },
    { maxElements: MAX_ELEMENTS, maxBodyText: MAX_BODY_TEXT },
  );

  return [
    `URL: ${data.url}`,
    `标题: ${data.title}`,
    `滚动位置: ${data.scrollY}/${data.scrollMax}px`,
    '',
    `## 可交互元素（共 ${data.elements.length} 个）`,
    ...data.elements,
    '',
    '## 页面正文',
    data.bodyText,
  ].join('\n');
}

/** 执行单个浏览器动作 */
export async function executeDomAction(page: Page, input: BrowserAction, guard: RiskGuard): Promise<void> {
  const refLocator = (ref: number) => page.locator(`[data-hs-ref="${ref}"]`).first();

  switch (input.action) {
    case 'snapshot':
      break; // 快照在动作执行后统一获取
    case 'click': {
      if (input.ref == null) throw new Error('click 需要 ref 参数');
      const loc = refLocator(input.ref);

      // 风控：打招呼类点击强制最小间隔（代码层节流，不依赖模型自觉）
      const text = (await loc.textContent({ timeout: 4000 }).catch(() => '')) ?? '';
      if (GREETING_PATTERN.test(text)) {
        const elapsed = Date.now() - guard.lastGreetingAt;
        if (elapsed < GREETING_MIN_INTERVAL_MS) {
          await page.waitForTimeout(GREETING_MIN_INTERVAL_MS - elapsed);
        }
        guard.lastGreetingAt = Date.now();
      }

      await loc.click({ timeout: 8000 });
      break;
    }
    case 'type': {
      if (input.ref == null) throw new Error('type 需要 ref 参数');
      const loc = refLocator(input.ref);
      await loc.click({ timeout: 8000 });
      // contenteditable 或富文本时 fill 会失败，回退为键盘输入
      try {
        await loc.fill(input.text ?? '', { timeout: 4000 });
      } catch {
        await page.keyboard.type(input.text ?? '', { delay: 30 });
      }
      break;
    }
    case 'press':
      await page.keyboard.press(input.text || 'Enter');
      break;
    case 'scroll': {
      const amount = (input.amount ?? 600) * (input.direction === 'up' ? -1 : 1);
      await page.mouse.wheel(0, amount);
      break;
    }
    case 'goto':
      if (!input.url) throw new Error('goto 需要 url 参数');
      await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    case 'wait':
      await page.waitForTimeout(Math.min(input.amount ?? 1500, 10000));
      break;
    default:
      throw new Error(`未知动作: ${(input as { action: string }).action}`);
  }

  // 动作后给页面一点反应时间
  if (input.action !== 'snapshot' && input.action !== 'wait') {
    await page.waitForTimeout(800);
  }
}

/** 只保留最近 keepLast 份完整快照，旧快照卸载到私有文件后只给头尾摘要，控制 token。 */
function pruneSnapshots(
  messages: OpenAI.ChatCompletionMessageParam[],
  keepLast = 2,
  opts: { runId?: number; sessionId?: string } = {},
): OpenAI.ChatCompletionMessageParam[] {
  const snapIdx: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('URL:')) {
      snapIdx.push(i);
    }
  });

  if (snapIdx.length <= keepLast) return messages;

  const pruned = [...messages];
  for (const i of snapIdx.slice(0, snapIdx.length - keepLast)) {
    const original = pruned[i];
    const content = typeof original.content === 'string' ? original.content : JSON.stringify(original.content);
    const offloaded = offloadToolOutput({
      content,
      toolName: 'browser',
      runId: opts.runId,
      sessionId: opts.sessionId,
      kind: 'snapshot',
    });
    pruned[i] = { ...original, content: offloaded.content } as OpenAI.ChatCompletionMessageParam;
  }
  return pruned;
}

export class DomRunner implements LLMRunner {
  private client: OpenAI;
  private model: string;

  constructor(baseURL: string, apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async runSkill(
    page: BrowserTarget,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void,
    options: RunSkillOptions = {},
  ): Promise<SkillResult> {
    const executionMode = options.executionMode ?? 'execute';
    const system = [
      DOM_GUIDE,
      executionMode === 'dry_run' ? DRY_RUN_GUIDE : '',
      executionMode === 'prepare' ? PREPARE_GUIDE : '',
      executionMode === 'screen' ? SCREEN_GUIDE : '',
      systemPrompt,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
    const result: SkillResult = { contacted: 0, skipped: 0, candidates: [], summary: '', trace: [] };
    const initSnapshot = isDomBrowserSession(page) ? await page.snapshot() : await takeDomSnapshot(page);
    let currentSnapshot = initSnapshot;
    const initialMode = executionMode === 'execute' ? 'read' : executionMode;
    const setBrowserEnvironment = (input: {
      status: ExecutionEnvironmentStatus;
      controller?: ExecutionEnvironmentController;
      mode?: ToolExecutionMode;
      liveState?: BrowserLiveState | null;
      reason?: string | null;
    }): void => {
      try {
        upsertExecutionEnvironment({
          id: browserEnvironmentId(page),
          kind: 'browser',
          label: isDomBrowserSession(page) ? page.label : 'Playwright browser',
          controller: input.controller ?? 'hireseek',
          status: input.status,
          mode: input.mode ?? (executionMode as ToolExecutionMode),
          runId: options.runId,
          sessionId: options.sessionId,
          url: input.liveState?.url ?? snapshotUrl(currentSnapshot),
          title: input.liveState?.title ?? undefined,
          active: input.liveState?.active,
          reason: input.reason,
        });
      } catch {
        // 环境状态是观测层，失败不能阻断主流程。
      }
    };
    result.trace!.push({
      seq: 1,
      action: 'snapshot',
      detail: 'initial page snapshot',
      ok: true,
      at: new Date().toISOString(),
      toolName: 'browser',
      inputSummary: 'initial snapshot',
      outputSummary: initSnapshot.slice(0, 700),
      sideEffect: false,
      mode: initialMode,
      stageId: options.initialStageId,
    });
    recordToolCall({
      runId: options.runId,
      sessionId: options.sessionId,
      toolCallId: null,
      toolName: 'browser',
      input: { action: 'snapshot', source: 'initial' },
      output: initSnapshot,
      ok: true,
      sideEffect: false,
      mode: initialMode,
      stageId: options.initialStageId,
    });
    const setRunState = (input: {
      status: AgentRunStatus;
      phase: string;
      stageId?: string;
      lastAction?: string;
      lastUrl?: string;
      reason?: string | null;
      snapshot?: string;
    }): void => {
      if (options.runId == null) return;
      try {
        upsertAgentRunState({
          runId: options.runId,
          sessionId: options.sessionId,
          status: input.status,
          phase: input.phase,
          stageId: input.stageId,
          lastAction: input.lastAction,
          lastUrl: input.lastUrl,
          reason: input.reason,
          snapshotSummary: input.snapshot ? summarizeSnapshotForRunState(input.snapshot) : undefined,
        });
      } catch { /* run state 是观测层，失败不能阻断主流程 */ }
    };
    setRunState({
      status: 'running',
      phase: 'started',
      stageId: options.initialStageId,
      lastAction: 'snapshot',
      lastUrl: snapshotUrl(initSnapshot),
      snapshot: initSnapshot,
    });
    setBrowserEnvironment({
      status: executionMode === 'dry_run' ? 'observing' : 'claimed',
      mode: initialMode,
    });

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: `${task}\n\n## 当前页面快照\n${initSnapshot}` },
    ];

    const guard: RiskGuard = { lastGreetingAt: 0 };
    type PendingContact = {
      token: string;
      data: Record<string, unknown>;
      name: string;
      greetingClicked: boolean;
    };
    let pendingContact: PendingContact | null = null;
    let contactSequence = 0;
    let hardStopped = false;
    let externalControlStopped = false;
    let prepareSideEffectCount = 0;
    const prepareActionAttempts = new Map<string, number>();
    const maxTurns = executionMode === 'prepare' ? 40 : MAX_TURNS;

    for (let turn = 0; turn < maxTurns; turn++) {
      const intervention = popIntervention();
      if (intervention) {
        const msg = `[用户介入] ${intervention}`;
        onProgress?.(`📩 ${msg}`);
        emitLog(`📩 ${msg}`);
        messages.push({ role: 'user', content: msg });
        if (userInterventionRequestsBrowserPause(intervention)) {
          externalControlStopped = true;
          result.exitStatus = 'paused';
          result.exitReason = 'user_intervention_requested_browser_pause';
          setRunState({
            status: 'paused',
            phase: 'user_intervention',
            lastAction: 'intervention',
            lastUrl: snapshotUrl(currentSnapshot),
            reason: intervention,
            snapshot: currentSnapshot,
          });
        }
      }

      // 兜底：循环里若有 tool_call 走了未知/非 function 分支没回 tool 响应，会留下
      // 悬空 tool_call_id，下一次请求被 OpenAI 兼容端 400 拒。每次发请求前先补齐，
      // 保证 assistant 的每个 tool_call 都有对应 tool 消息（真实 BOSS run 的稳定性兜底）。
      repairToolMessageHistoryInPlace(messages);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: pruneSnapshots(messages, 2, { runId: options.runId, sessionId: options.sessionId }),
        tools: domRunnerToolsForMode(executionMode),
        tool_choice: 'auto',
        max_tokens: 2048,
      });

      const msg = response.choices[0].message;

      if (msg.content) {
        const thought = `💭 ${msg.content}`;
        onProgress?.(thought);
        emitLog(thought);
      }

      messages.push(msg);

      // 没有工具调用 → 任务完成
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalText = msg.content ?? '';
        const completionDecision = options.completionPolicy?.({
          executionMode,
          trace: result.trace ?? [],
          pageSnapshot: currentSnapshot,
          targetJobTitle: options.targetJobTitle,
          pendingContactName: pendingContact?.name,
          pendingContactAwaitingRecord: pendingContact?.greetingClicked ?? false,
          screenedCandidateCount: result.screenedList?.length ?? 0,
        });
        if (completionDecision && !completionDecision.allowed) {
          const reason = completionDecision.reason ?? '当前运行状态尚未满足完成条件。';
          const feedback = `[产品协议验收未通过] ${reason}\n请继续使用允许的工具完成缺失动作；不要仅输出文字总结。`;
          onProgress?.(`⚠️ ${feedback}`);
          emitLog(`⚠️ ${feedback}`);
          messages.push({ role: 'user', content: feedback });
          setRunState({
            status: 'running',
            phase: 'completion_check_failed',
            lastAction: 'completion_policy',
            lastUrl: snapshotUrl(currentSnapshot),
            reason,
            snapshot: currentSnapshot,
          });
          continue;
        }
        result.summary = finalText;
        const parsed = parseSkillSummary(finalText);
        result.contacted = parsed.contacted;
        result.skipped = parsed.skipped;
        if (executionMode !== 'execute') {
          // 预检报告常包含候选人项目符号，不能让旧文本兜底把它们误认成已触达。
          result.contacted = 0;
          result.contactedList = (result.contactedList ?? []).map(candidate => ({
            ...candidate,
            greetingSent: false,
          }));
        } else {
          // 结构化清单以 record_contacted 工具的逐条登记为权威；
          // 仅当模型一次都没调用该工具时，才降级用总结文本解析（过渡兼容）。
          if (!result.contactedList || result.contactedList.length === 0) {
            result.contactedList = parseContactedCandidates(finalText);
          }
          if (result.contacted === 0 && result.contactedList) {
            result.contacted = result.contactedList.filter(c => c.greetingSent !== false).length;
          }
        }
        if (result.exitStatus !== 'paused') {
          result.exitStatus = 'completed';
          setRunState({
            status: 'completed',
            phase: 'completed',
            lastAction: 'final_response',
            lastUrl: snapshotUrl(currentSnapshot),
            snapshot: currentSnapshot,
          });
          setBrowserEnvironment({
            status: 'released',
            controller: 'hireseek',
            mode: executionMode as ToolExecutionMode,
          });
        }
        onProgress?.('✓ 完成');
        break;
      }

      for (const toolCall of msg.tool_calls) {
        if (toolCall.type !== 'function') {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: false, error: { code: 'unsupported_tool_call_type', message: `不支持的工具调用类型：${toolCall.type}` } }),
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: `unsupported:${toolCall.type}`,
            ok: false,
            error: `unsupported tool_call type: ${toolCall.type}`,
          });
          continue;
        }

        if (toolCall.function.name === 'prepare_contact') {
          let ok = true;
          let error: string | null = null;
          let output: string;
          let parsed: Record<string, unknown> = {};
          const requiredStages = ['prefilter', 'dom-probe', 'candidate-screen'];
          const observedStages = new Set(successfulStageIds(result.trace));
          const missingStages = requiredStages.filter(stageId => !observedStages.has(stageId));
          try {
            parsed = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          } catch (err) {
            ok = false;
            error = `prepare_contact 参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}`;
          }
          const requiredFields = ['name', 'evidence', 'personalization_evidence', 'message_intent', 'greeting_text', 'fit_score'];
          const missingFields = requiredFields.filter(key => !String(parsed[key] ?? '').trim());
          const allowedContactNames = options.allowedContactNamesBeforeContact;
          if (ok && executionMode !== 'execute') {
            ok = false;
            error = `当前是 ${executionMode} 模式，禁止建立真实触达检查点。`;
          } else if (ok && Array.isArray(allowedContactNames) && allowedContactNames.length === 0) {
            ok = false;
            error = '正式触达前缺少 screen 候选人白名单；请先运行 screen 候选人筛选验收。';
          } else if (ok && missingStages.length > 0) {
            ok = false;
            error = `prepare_contact 缺少协议阶段证据：${missingStages.join(', ')}。`;
          } else if (ok && missingFields.length > 0) {
            ok = false;
            error = `prepare_contact 缺少字段：${missingFields.join(', ')}。`;
          } else if (
            ok &&
            Array.isArray(allowedContactNames) &&
            !allowedContactNames.some(name => String(parsed.name) === name)
          ) {
            ok = false;
            error = `候选人 ${String(parsed.name)} 不在最近 screen 建议正式触达名单中，禁止建立触达检查点。`;
          } else if (ok && pendingContact?.greetingClicked) {
            ok = false;
            error = `上一位候选人 ${pendingContact.name} 已点击沟通但尚未 record_contacted，禁止准备下一位。`;
          }

          if (ok) {
            const name = String(parsed.name);
            const token = `contact-${options.runId ?? 'session'}-${++contactSequence}`;
            pendingContact = { token, data: parsed, name, greetingClicked: false };
            output = JSON.stringify({
              ok: true,
              contact_token: token,
              instruction: `只允许点击快照上下文中包含“${name}”的打招呼按钮；点击后立即 record_contacted。`,
            });
          } else {
            output = JSON.stringify({ ok: false, error: { code: 'contact_checkpoint_rejected', message: error } });
          }
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: output });
          result.trace!.push({
            seq: result.trace!.length + 1,
            action: 'prepare_contact',
            target: parsed.name ? String(parsed.name) : undefined,
            ok,
            at: new Date().toISOString(),
            toolName: 'prepare_contact',
            inputSummary: toolCall.function.arguments,
            outputSummary: output,
            error: error ?? undefined,
            sideEffect: false,
            mode: executionMode,
            stageId: 'candidate-screen',
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'prepare_contact',
            input: toolCall.function.arguments,
            output,
            ok,
            error,
            sideEffect: false,
            mode: executionMode,
            stageId: 'candidate-screen',
          });
          continue;
        }

        if (toolCall.function.name === 'record_screened_candidate') {
          let ok = true;
          let error: string | null = null;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          } catch (err) {
            ok = false;
            error = `record_screened_candidate 参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}`;
          }
          const recommendation = String(parsed.recommendation ?? '');
          const missingFields = ['name', 'recommendation', 'evidence']
            .filter(key => !String(parsed[key] ?? '').trim());
          if (ok && executionMode !== 'screen') {
            ok = false;
            error = `当前是 ${executionMode} 模式，record_screened_candidate 只能用于 screen 候选人筛选验收。`;
          } else if (ok && missingFields.length > 0) {
            ok = false;
            error = `record_screened_candidate 缺少字段：${missingFields.join(', ')}。`;
          } else if (ok && !['contact', 'maybe', 'skip'].includes(recommendation)) {
            ok = false;
            error = 'record_screened_candidate 的 recommendation 只能是 contact / maybe / skip。';
          }

          if (ok) {
            const riskFlags = Array.isArray(parsed.risk_flags) ? parsed.risk_flags.map(String).filter(Boolean) : undefined;
            const fitTags = Array.isArray(parsed.fit_tags) ? parsed.fit_tags.map(String).filter(Boolean) : undefined;
            const rawScore = Number(parsed.fit_score);
            (result.screenedList ??= []).push({
              name: String(parsed.name),
              company: parsed.company ? String(parsed.company) : undefined,
              title: parsed.title ? String(parsed.title) : undefined,
              location: parsed.location ? String(parsed.location) : undefined,
              evidence: parsed.evidence ? String(parsed.evidence) : undefined,
              riskFlags,
              fitTags,
              score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : undefined,
              recommendation: recommendation as 'contact' | 'maybe' | 'skip',
              profileUrl: parsed.profile_url ? String(parsed.profile_url) : undefined,
            });
          }

          const output = ok
            ? `已记录 screen 候选人：${String(parsed.name)} (${recommendation})。`
            : JSON.stringify({ ok: false, error: { code: 'screen_candidate_rejected', message: error } });
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: output });
          result.trace!.push({
            seq: result.trace!.length + 1,
            action: 'record_screened_candidate',
            target: parsed.name ? String(parsed.name) : undefined,
            ok,
            at: new Date().toISOString(),
            toolName: 'record_screened_candidate',
            inputSummary: toolCall.function.arguments,
            outputSummary: output,
            error: error ?? undefined,
            sideEffect: false,
            mode: executionMode,
            stageId: 'candidate-screen',
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'record_screened_candidate',
            input: toolCall.function.arguments,
            output,
            ok,
            error,
            sideEffect: false,
            mode: executionMode,
            stageId: 'candidate-screen',
          });
          continue;
        }

        // 结构化产出：逐条登记已触达候选人（契约 contacted-candidate.v1）
        if (toolCall.function.name === 'record_contacted') {
          let toolContent = '已登记。继续下一个候选人。';
          let recordOk = true;
          const observedStages = new Set(successfulStageIds(result.trace));
          const missingStages = (options.requiredStagesBeforeContact ?? [])
            .filter(stageId => !observedStages.has(stageId));
          if (missingStages.length > 0) {
            recordOk = false;
            toolContent = `登记失败：触达前缺少协议阶段 ${missingStages.join(', ')} 的运行证据。`;
          }
          try {
            const a = JSON.parse(toolCall.function.arguments || '{}');
            if (!recordOk) {
              // 阶段门禁已拒绝，仍解析参数以保证错误路径稳定，但不写候选人。
            } else if (executionMode === 'screen') {
              recordOk = false;
              toolContent = '登记失败：screen 模式请使用 record_screened_candidate；record_contacted 只用于正式触达。';
            } else if (!a.name) {
              recordOk = false;
              toolContent = '登记失败：缺少 name。请重新调用 record_contacted，补上候选人姓名。';
            } else if (executionMode !== 'execute' && a.greeting_sent !== false) {
              recordOk = false;
              toolContent = `登记失败：当前是 ${executionMode} 模式，不能登记为已真实打招呼。请直接输出本轮安全验收总结。`;
            } else if (a.greeting_sent !== false) {
              const missing = ['evidence', 'personalization_evidence', 'message_intent', 'greeting_text']
                .filter(key => !String(a[key] ?? '').trim());
              if (missing.length > 0) {
                recordOk = false;
                toolContent = `登记失败：已打招呼候选人缺少 ${missing.join(', ')}。请重新调用 record_contacted 补齐这些字段。`;
              } else if (!pendingContact) {
                recordOk = false;
                toolContent = '登记失败：没有有效的 prepare_contact 检查点。';
              } else if (!pendingContact.greetingClicked) {
                recordOk = false;
                toolContent = `登记失败：候选人 ${pendingContact.name} 的打招呼按钮尚未成功点击。`;
              } else if (String(a.contact_token ?? '') !== pendingContact.token) {
                recordOk = false;
                toolContent = '登记失败：contact_token 与当前候选人检查点不一致。';
              } else if (String(a.name) !== pendingContact.name) {
                recordOk = false;
                toolContent = `登记失败：候选人姓名与检查点不一致（应为 ${pendingContact.name}）。`;
              }
            }

            if (recordOk) {
              const canonical = a.greeting_sent === false || !pendingContact
                ? a
                : { ...a, ...pendingContact.data, name: pendingContact.name, greeting_sent: true };
              const riskFlags = Array.isArray(canonical.risk_flags) ? canonical.risk_flags.map(String).filter(Boolean) : undefined;
              const fitTags = Array.isArray(canonical.fit_tags) ? canonical.fit_tags.map(String).filter(Boolean) : undefined;
              const rawScore = Number(canonical.fit_score);
              (result.contactedList ??= []).push({
                name: String(canonical.name),
                company: canonical.company ? String(canonical.company) : undefined,
                title: canonical.title ? String(canonical.title) : undefined,
                location: canonical.location ? String(canonical.location) : undefined,
                evidence: canonical.evidence ? String(canonical.evidence) : undefined,
                personalizationEvidence: canonical.personalization_evidence ? String(canonical.personalization_evidence) : undefined,
                messageIntent: canonical.message_intent ? String(canonical.message_intent) : undefined,
                riskFlags,
                fitTags,
                score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : undefined,
                greetingSent: canonical.greeting_sent !== false,
                greetingText: canonical.greeting_text ? String(canonical.greeting_text) : undefined,
                profileUrl: canonical.profile_url ? String(canonical.profile_url) : undefined,
                // sourceChannel 由 orchestrator 的 channel 参数权威决定，runner 不臆测
              });
              if (canonical.greeting_sent !== false) pendingContact = null;
            }
          } catch (err) {
            recordOk = false;
            toolContent = `登记失败：record_contacted 参数不是合法 JSON（${err instanceof Error ? err.message : String(err)}）。请重新调用。`;
          }
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolContent });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'record_contacted',
            input: toolCall.function.arguments,
            output: toolContent,
            ok: recordOk,
            error: recordOk ? null : toolContent,
            sideEffect: false,
            mode: executionMode === 'execute' ? 'execute' : executionMode,
            stageId: 'single-contact',
          });
          continue;
        }

        if (toolCall.function.name !== 'browser') {
          const content = unknownToolResult(toolCall.function.name);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content });
          recordRejectedToolCall({
            registry: DOM_RUNNER_TOOL_REGISTRY,
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            input: toolCall.function.arguments,
            output: content,
            error: `unknown tool: ${toolCall.function.name}`,
          });
          continue;
        }

        // 风控硬终止后拒绝执行任何动作，只允许模型输出总结
        if (hardStopped) {
          const content = '[风控硬终止] 已检测到每日上限弹窗，禁止继续任何操作。请立即停止调用工具，输出文字总结（含 触达人数/跳过人数）。';
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content,
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input: toolCall.function.arguments,
            output: content,
            ok: false,
            error: content,
            sideEffect: true,
            mode: executionMode === 'execute' ? 'execute' : executionMode,
          });
          continue;
        }

        let input: BrowserAction;
        try {
          input = JSON.parse(toolCall.function.arguments || '{}') as BrowserAction;
        } catch (err) {
          const message = `browser 参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}`;
          const mode = executionMode === 'execute' ? 'execute' : executionMode;
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: message });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input: toolCall.function.arguments,
            output: message,
            ok: false,
            error: message,
            sideEffect: true,
            mode,
          });
          continue;
        }
        const actionLog = `[${turn + 1}] ${input.action}${input.ref != null ? ` ref=${input.ref}` : ''}${
          input.url ? ` ${input.url}` : ''
        }`;
        const stageId = browserActionStageId(input);
        const actionLabel = snapshotRefLabel(currentSnapshot, input.ref);
        onProgress?.(actionLog);
        emitLog(actionLog);

        if (executionMode === 'prepare' && browserActionHasSideEffect(input, executionMode)) {
          prepareSideEffectCount++;
          const key = `${input.action}:${snapshotUrl(currentSnapshot)}:${actionLabel ?? input.ref ?? ''}:${input.text ?? ''}`;
          const attempts = (prepareActionAttempts.get(key) ?? 0) + 1;
          prepareActionAttempts.set(key, attempts);
          if (prepareSideEffectCount > 12) {
            throw new Error('prepare safety budget exceeded: more than 12 side-effect attempts');
          }
          if (attempts > 2) {
            throw new Error(`prepare repeated-action circuit breaker: ${input.action} ref=${input.ref ?? 'none'}`);
          }
        }

        if (executionMode === 'dry_run' && dryRunBlocksBrowserAction(input)) {
          const blocked = `dry-run 预检模式禁止执行 ${input.action}，已阻止真实浏览器动作。请只用 snapshot/wait/scroll 观察页面，或输出预检总结。`;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: blocked,
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input,
            output: blocked,
            ok: false,
            error: blocked,
            sideEffect: true,
            mode: 'dry_run',
            stageId,
          });
          try {
            result.trace!.push({
              seq: result.trace!.length + 1,
              action: input.action,
              target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
              detail: 'blocked by dry-run',
              ok: false,
              at: new Date().toISOString(),
              toolName: 'browser',
              inputSummary: toolCall.function.arguments,
              outputSummary: blocked,
              error: blocked,
              sideEffect: true,
              mode: 'dry_run',
              stageId,
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
        }

        if (executionMode === 'screen' && screenBlocksBrowserAction(input)) {
          const blocked = `screen 候选人筛选模式禁止执行 ${input.action}，已阻止真实浏览器动作。请只用 snapshot/click/scroll/back/wait 查看候选人，禁止输入、发送或跳转。`;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: blocked,
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input,
            output: blocked,
            ok: false,
            error: blocked,
            sideEffect: true,
            mode: 'screen',
            stageId,
          });
          try {
            result.trace!.push({
              seq: result.trace!.length + 1,
              action: input.action,
              target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
              detail: 'blocked by screen mode',
              ok: false,
              at: new Date().toISOString(),
              toolName: 'browser',
              inputSummary: toolCall.function.arguments,
              outputSummary: blocked,
              error: blocked,
              sideEffect: true,
              mode: 'screen',
              stageId,
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
        }

        if (options.blockedBrowserActions?.includes(input.action)) {
          const blocked = `当前模式禁止执行 ${input.action}。请改用允许的页面内动作，或停止工具调用并输出当前状态总结。`;
          const mode = browserActionMode(input, executionMode);
          const sideEffect = browserActionHasSideEffect(input, executionMode);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: blocked,
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input,
            output: blocked,
            ok: false,
            error: blocked,
            sideEffect,
            mode,
            stageId,
          });
          try {
            result.trace!.push({
              seq: result.trace!.length + 1,
              action: input.action,
              target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
              detail: 'blocked by run mode',
              ok: false,
              toolName: 'browser',
              sideEffect,
              mode,
              stageId,
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
        }

        const observedStageIds = successfulStageIds(result.trace);
        const policyDecision = options.browserActionPolicy?.(input, {
          runId: options.runId,
          sessionId: options.sessionId,
          executionMode,
          observedStageIds,
          actionLabel,
          pageSnapshot: currentSnapshot,
          targetJobTitle: options.targetJobTitle,
          pendingContactName: pendingContact?.name,
          pendingContactAwaitingRecord: pendingContact?.greetingClicked ?? false,
        });
        if (policyDecision && !policyDecision.allowed) {
          const blocked = [
            policyDecision.reason ?? `当前平台协议禁止执行 ${input.action}`,
            policyDecision.recovery ? `\n[协议恢复建议]\n${policyDecision.recovery}` : '',
          ].filter(Boolean).join('\n');
          const sideEffect = browserActionHasSideEffect(input, executionMode);
          const mode = browserActionMode(input, executionMode);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: blocked,
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input,
            output: blocked,
            ok: false,
            error: blocked,
            sideEffect,
            mode,
            stageId,
          });
          try {
            result.trace!.push({
              seq: result.trace!.length + 1,
              action: input.action,
              target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
              detail: 'blocked by platform protocol',
              ok: false,
              at: new Date().toISOString(),
              toolName: 'browser',
              inputSummary: toolCall.function.arguments,
              outputSummary: blocked,
              error: blocked,
              sideEffect,
              mode,
              stageId,
              actionLabel,
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
        }

        const sideEffect = browserActionHasSideEffect(input, executionMode);
        const mode = browserActionMode(input, executionMode);
        if (externalControlStopped) {
          const blocked = '[用户接管保护] 已检测到用户正在接管真实 Chrome，本轮禁止继续读取或操作浏览器。请停止工具调用并输出当前已完成事项。';
          result.exitStatus = 'paused';
          result.exitReason = blocked;
          setRunState({
            status: 'paused',
            phase: 'external_control',
            stageId,
            lastAction: input.action,
            lastUrl: snapshotUrl(currentSnapshot),
            reason: blocked,
            snapshot: currentSnapshot,
          });
          setBrowserEnvironment({
            status: 'blocked',
            controller: 'user',
            mode,
            reason: blocked,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: blocked,
          });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'browser',
            input,
            output: blocked,
            ok: false,
            error: blocked,
            sideEffect,
            mode,
            stageId,
          });
          try {
            result.trace!.push({
              seq: result.trace!.length + 1,
              action: 'external_control_suspected',
              target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
              detail: 'blocked after user intervention',
              ok: false,
              at: new Date().toISOString(),
              toolName: 'browser',
              inputSummary: toolCall.function.arguments,
              outputSummary: blocked,
              error: blocked,
              sideEffect,
              mode,
              stageId,
              actionLabel,
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
        }

        if (sideEffect) {
          const liveState = await readBrowserLiveState(page);
          const ownership = detectExternalBrowserControl(currentSnapshot, liveState);
          if (ownership.suspected) {
            externalControlStopped = true;
            const blocked = `[用户接管保护] ${ownership.reason ?? '检测到真实 Chrome 状态已被外部改变。'} 已停止本次 ${input.action}，避免覆盖用户正在操作的页面。`;
            result.exitStatus = 'paused';
            result.exitReason = blocked;
            setRunState({
              status: 'paused',
              phase: 'external_control',
              stageId,
              lastAction: input.action,
              lastUrl: liveState?.url ?? snapshotUrl(currentSnapshot),
              reason: ownership.reason ?? blocked,
              snapshot: currentSnapshot,
            });
            setBrowserEnvironment({
              status: 'blocked',
              controller: 'user',
              mode,
              liveState,
              reason: ownership.reason ?? blocked,
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: blocked,
            });
            recordToolCall({
              runId: options.runId,
              sessionId: options.sessionId,
              toolCallId: toolCall.id,
              toolName: 'browser',
              input,
              output: blocked,
              ok: false,
              error: blocked,
              sideEffect,
              mode,
              stageId,
            });
            try {
              result.trace!.push({
                seq: result.trace!.length + 1,
                action: 'external_control_suspected',
                target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
                detail: ownership.reason,
                ok: false,
                at: new Date().toISOString(),
                toolName: 'browser',
                inputSummary: toolCall.function.arguments,
                outputSummary: blocked,
                error: blocked,
                sideEffect,
                mode,
                stageId,
                actionLabel,
              });
            } catch { /* 轨迹记录失败绝不影响 sourcing */ }
            continue;
          }
        }

        let snapshot: string;
        let stepOk = true;
        let stepError: string | null = null;
        try {
          if (isDomBrowserSession(page)) {
            snapshot = await page.act(input, guard);
          } else {
            await executeDomAction(page, input, guard);
            snapshot = await takeDomSnapshot(page);
          }
        } catch (err: unknown) {
          stepOk = false;
          const message = err instanceof Error ? err.message : String(err);
          stepError = message;
          // page 被关闭时重新获取
          if (!isDomBrowserSession(page) && (message.includes('closed') || message.includes('Target'))) {
            const { getPage } = await import('../browser-runner');
            page = await getPage();
            snapshot = await takeDomSnapshot(page);
          } else {
            const fallbackSnapshot = isDomBrowserSession(page)
              ? await page.snapshot().catch(() => '[快照获取失败]')
              : await takeDomSnapshot(page).catch(() => '[快照获取失败]');
            snapshot = `[动作执行失败] ${message}\n请根据下方快照调整策略。\n\n${fallbackSnapshot}`;
          }
        }

        // 加性记录执行轨迹，供流程合规验证器事后审计；绝不影响主流程
        try {
          result.trace!.push({
            seq: result.trace!.length + 1,
            action: input.action,
            target: input.url ?? (input.ref != null ? `ref=${input.ref}` : undefined),
            detail: input.text ? String(input.text).slice(0, 60) : undefined,
            ok: stepOk,
            at: new Date().toISOString(),
            toolName: 'browser',
            inputSummary: toolCall.function.arguments,
            outputSummary: snapshot.slice(0, 700),
            error: stepError ?? undefined,
            sideEffect,
            mode,
            stageId,
            actionLabel,
          });
        } catch { /* 轨迹记录失败绝不影响 sourcing */ }
        recordToolCall({
          runId: options.runId,
          sessionId: options.sessionId,
          toolCallId: toolCall.id,
          toolName: 'browser',
          input,
          output: snapshot,
          ok: stepOk,
          error: stepError,
          sideEffect,
          mode,
          stageId,
        });
        setRunState({
          status: 'running',
          phase: stepOk ? 'browser_action' : 'browser_action_failed',
          stageId,
          lastAction: input.action,
          lastUrl: snapshotUrl(snapshot),
          reason: stepError,
          snapshot,
        });
        setBrowserEnvironment({
          status: stepOk ? (sideEffect ? 'claimed' : 'observing') : 'error',
          mode,
          reason: stepError,
        });
        if (
          stepOk &&
          executionMode === 'execute' &&
          input.action === 'click' &&
          !!actionLabel &&
          GREETING_PATTERN.test(actionLabel) &&
          pendingContact
        ) {
          pendingContact.greetingClicked = true;
        }
        currentSnapshot = snapshot;

        // 风控检测：基于页面快照文本（代码层判定，不依赖模型识别）
        if (DAILY_LIMIT_PATTERN.test(snapshot)) {
          hardStopped = true;
          const warn = '🛑 [风控硬终止] 检测到每日沟通上限弹窗，立即停止所有操作';
          onProgress?.(warn);
          emitLog(warn);
          snapshot = `${warn}\n\n禁止继续任何浏览器操作。请立即输出文字总结（含 触达人数/跳过人数/主要跳过原因）。\n\n${snapshot}`;
        } else if (FREQUENCY_PATTERN.test(snapshot)) {
          const backoffMs = 10000 + Math.floor(Math.random() * 20000); // 10-30 秒
          const warn = `⏳ [风控软退避] 检测到频率告警，等待 ${Math.round(backoffMs / 1000)} 秒后继续`;
          onProgress?.(warn);
          emitLog(warn);
          if (isDomBrowserSession(page)) {
            await sleep(backoffMs);
          } else {
            await page.waitForTimeout(backoffMs);
          }
          snapshot = `${warn}（已等待完成，请放慢节奏继续）\n\n${snapshot}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: snapshot,
        });
      }
    }

    if (!result.summary && result.exitStatus !== 'paused') {
      result.exitStatus = 'failed';
      result.exitReason = `超过最大执行轮数（${maxTurns}），已停止`;
      setRunState({
        status: 'failed',
        phase: 'max_turns_exceeded',
        lastAction: 'loop_limit',
        lastUrl: snapshotUrl(currentSnapshot),
        reason: result.exitReason,
        snapshot: currentSnapshot,
      });
      setBrowserEnvironment({
        status: 'error',
        controller: 'hireseek',
        mode: executionMode as ToolExecutionMode,
        reason: result.exitReason,
      });
    }

    return result;
  }
}
