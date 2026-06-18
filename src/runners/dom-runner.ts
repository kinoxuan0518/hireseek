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
import type { BrowserAction, BrowserTarget, RiskGuard } from '../browser-session';
import { isDomBrowserSession } from '../browser-session';
import { recordToolCall } from '../agent-core/trace';
import type { ToolExecutionMode } from '../agent-core/tool-registry';

export type { BrowserAction, RiskGuard } from '../browser-session';

const MAX_TURNS = 150;
const MAX_BODY_TEXT = 6000;
const MAX_ELEMENTS = 120;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
type SkillExecutionMode = 'execute' | 'dry_run';

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
      },
    },
  },
};

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
7. **每联系完一个候选人，立刻调用 record_contacted 登记**（姓名/公司/职位/自评分/是否已打招呼/招呼文案等）。已打招呼时必须包含：evidence、personalization_evidence、message_intent、greeting_text。这是产出的唯一权威来源——别攒到最后才在总结里写名单。
8. **任务完成后**：直接回复文字总结，不再调用工具

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

const DRY_RUN_ALLOWED_BROWSER_ACTIONS = new Set<BrowserAction['action']>(['snapshot', 'wait', 'scroll']);

export function dryRunBlocksBrowserAction(input: BrowserAction): boolean {
  return !DRY_RUN_ALLOWED_BROWSER_ACTIONS.has(input.action);
}

export function browserActionMode(input: BrowserAction, executionMode: SkillExecutionMode = 'execute'): ToolExecutionMode {
  if (executionMode === 'dry_run') return 'dry_run';
  return input.action === 'snapshot' ? 'read' : 'execute';
}

export function browserActionHasSideEffect(input: BrowserAction, executionMode: SkillExecutionMode = 'execute'): boolean {
  if (executionMode === 'dry_run') return dryRunBlocksBrowserAction(input);
  return input.action !== 'snapshot' && input.action !== 'wait';
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
        'a[href]', 'button', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="option"]',
        '[role="menuitem"]', '[role="checkbox"]', '[contenteditable="true"]',
        '[onclick]',
      ].join(',');

      const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);

      const lines: string[] = [];
      let refCounter = 0;

      for (const el of elements) {
        if (refCounter >= maxElements) break;
        const ref = ++refCounter;
        el.setAttribute('data-hs-ref', String(ref));

        const tag = el.tagName.toLowerCase();
        const input = el as HTMLInputElement;
        const parts: string[] = [`[ref=${ref}] <${tag}${input.type ? ` type=${input.type}` : ''}>`];

        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (text) parts.push(text);
        if (input.placeholder) parts.push(`placeholder="${input.placeholder}"`);
        if (input.value && tag === 'input') parts.push(`value="${String(input.value).slice(0, 40)}"`);
        if (el.getAttribute('aria-label')) parts.push(`aria="${el.getAttribute('aria-label')}"`);

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

/** 只保留最近 keepLast 份快照，旧的替换为占位文字，控制 token */
function pruneSnapshots(
  messages: OpenAI.ChatCompletionMessageParam[],
  keepLast = 2,
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
    pruned[i] = { ...pruned[i], content: '[历史快照已省略]' } as OpenAI.ChatCompletionMessageParam;
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
    const system = [DOM_GUIDE, executionMode === 'dry_run' ? DRY_RUN_GUIDE : '', systemPrompt]
      .filter(Boolean)
      .join('\n\n---\n\n');
    const initSnapshot = isDomBrowserSession(page) ? await page.snapshot() : await takeDomSnapshot(page);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: `${task}\n\n## 当前页面快照\n${initSnapshot}` },
    ];

    const result: SkillResult = { contacted: 0, skipped: 0, candidates: [], summary: '', trace: [] };
    const guard: RiskGuard = { lastGreetingAt: 0 };
    let hardStopped = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const intervention = popIntervention();
      if (intervention) {
        const msg = `[用户介入] ${intervention}`;
        onProgress?.(`📩 ${msg}`);
        emitLog(`📩 ${msg}`);
        messages.push({ role: 'user', content: msg });
      }

      // 兜底：循环里若有 tool_call 走了未知/非 function 分支没回 tool 响应，会留下
      // 悬空 tool_call_id，下一次请求被 OpenAI 兼容端 400 拒。每次发请求前先补齐，
      // 保证 assistant 的每个 tool_call 都有对应 tool 消息（真实 BOSS run 的稳定性兜底）。
      repairToolMessageHistoryInPlace(messages);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: pruneSnapshots(messages),
        tools: [BROWSER_TOOL, RECORD_CONTACTED_TOOL],
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
        result.summary = finalText;
        const parsed = parseSkillSummary(finalText);
        result.contacted = parsed.contacted;
        result.skipped = parsed.skipped;
        // 结构化清单以 record_contacted 工具的逐条登记为权威；
        // 仅当模型一次都没调用该工具时，才降级用总结文本解析（过渡兼容）。
        if (!result.contactedList || result.contactedList.length === 0) {
          result.contactedList = parseContactedCandidates(finalText);
        }
        if (result.contacted === 0 && result.contactedList) {
          result.contacted = result.contactedList.filter(c => c.greetingSent !== false).length;
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

        // 结构化产出：逐条登记已触达候选人（契约 contacted-candidate.v1）
        if (toolCall.function.name === 'record_contacted') {
          let toolContent = '已登记。继续下一个候选人。';
          let recordOk = true;
          try {
            const a = JSON.parse(toolCall.function.arguments || '{}');
            if (!a.name) {
              recordOk = false;
              toolContent = '登记失败：缺少 name。请重新调用 record_contacted，补上候选人姓名。';
            } else if (executionMode === 'dry_run' && a.greeting_sent !== false) {
              recordOk = false;
              toolContent = '登记失败：当前是 dry-run 预检模式，不能登记为已真实打招呼。请改为 greeting_sent=false 或直接输出预检总结。';
            } else if (a.greeting_sent !== false) {
              const missing = ['evidence', 'personalization_evidence', 'message_intent', 'greeting_text']
                .filter(key => !String(a[key] ?? '').trim());
              if (missing.length > 0) {
                recordOk = false;
                toolContent = `登记失败：已打招呼候选人缺少 ${missing.join(', ')}。请重新调用 record_contacted 补齐这些字段。`;
              }
            }

            if (recordOk) {
              const riskFlags = Array.isArray(a.risk_flags) ? a.risk_flags.map(String).filter(Boolean) : undefined;
              const fitTags = Array.isArray(a.fit_tags) ? a.fit_tags.map(String).filter(Boolean) : undefined;
              const rawScore = Number(a.fit_score);
              (result.contactedList ??= []).push({
                name: String(a.name),
                company: a.company ? String(a.company) : undefined,
                title: a.title ? String(a.title) : undefined,
                location: a.location ? String(a.location) : undefined,
                evidence: a.evidence ? String(a.evidence) : undefined,
                personalizationEvidence: a.personalization_evidence ? String(a.personalization_evidence) : undefined,
                messageIntent: a.message_intent ? String(a.message_intent) : undefined,
                riskFlags,
                fitTags,
                score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : undefined,
                greetingSent: a.greeting_sent !== false,
                greetingText: a.greeting_text ? String(a.greeting_text) : undefined,
                profileUrl: a.profile_url ? String(a.profile_url) : undefined,
                // sourceChannel 由 orchestrator 的 channel 参数权威决定，runner 不臆测
              });
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
            mode: executionMode === 'dry_run' ? 'dry_run' : 'execute',
          });
          continue;
        }

        if (toolCall.function.name !== 'browser') {
          const content = JSON.stringify({
            ok: false,
            error: {
              code: 'unknown_tool',
              message: `未知工具：${toolCall.function.name}`,
            },
          });
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            input: toolCall.function.arguments,
            output: content,
            ok: false,
            error: `unknown tool: ${toolCall.function.name}`,
          });
          continue;
        }

        // 风控硬终止后拒绝执行任何动作，只允许模型输出总结
        if (hardStopped) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: '[风控硬终止] 已检测到每日上限弹窗，禁止继续任何操作。请立即停止调用工具，输出文字总结（含 触达人数/跳过人数）。',
          });
          continue;
        }

        let input: BrowserAction;
        try {
          input = JSON.parse(toolCall.function.arguments || '{}') as BrowserAction;
        } catch (err) {
          const message = `browser 参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}`;
          const mode = executionMode === 'dry_run' ? 'dry_run' : 'execute';
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
        onProgress?.(actionLog);
        emitLog(actionLog);

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
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
        }

        const policyDecision = options.browserActionPolicy?.(input, {
          runId: options.runId,
          sessionId: options.sessionId,
        });
        if (policyDecision && !policyDecision.allowed) {
          const blocked = policyDecision.reason ?? `当前平台协议禁止执行 ${input.action}`;
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
            });
          } catch { /* 轨迹记录失败绝不影响 sourcing */ }
          continue;
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
            sideEffect: browserActionHasSideEffect(input, executionMode),
            mode: browserActionMode(input, executionMode),
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
          sideEffect: browserActionHasSideEffect(input, executionMode),
          mode: browserActionMode(input, executionMode),
        });

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

    return result;
  }
}
