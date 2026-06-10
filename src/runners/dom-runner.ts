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
import { parseSkillSummary } from './interface';
import type { LLMRunner } from './interface';
import type { SkillResult } from '../types';

const MAX_TURNS = 150;
const MAX_BODY_TEXT = 6000;
const MAX_ELEMENTS = 120;

// ── 风控规则（代码层硬约束，不依赖模型遵守 prompt）──────────────────────
/** 打招呼类按钮的最小点击间隔（毫秒） */
const GREETING_MIN_INTERVAL_MS = 5000;
/** 打招呼类按钮文案特征 */
const GREETING_PATTERN = /打招呼|立即沟通|继续沟通|和Ta聊聊|聊一聊/;
/** 每日上限弹窗特征 → 立即硬终止 */
const DAILY_LIMIT_PATTERN = /今日主动沟通数已达上限|需付费购买|今日沟通已达上限|超出今日限制/;
/** 频率告警特征 → 软退避 10-30 秒 */
const FREQUENCY_PATTERN = /开聊太频繁|操作太频繁|操作过于频繁|请稍后再试/;

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
7. **任务完成后**：直接回复文字总结，不再调用工具

输出总结时必须包含：
触达人数: <数字>
跳过人数: <数字>
`.trim();

interface BrowserAction {
  action: 'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'goto' | 'back' | 'wait';
  ref?: number;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
}

/**
 * 提取页面文本快照：标记可交互元素 + 收集正文。
 * 在浏览器上下文中执行，给元素写入 data-hs-ref 属性供后续定位。
 */
async function takeDomSnapshot(page: Page): Promise<string> {
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

/** 跨动作的风控状态（每次 runSkill 创建一份） */
interface RiskGuard {
  lastGreetingAt: number;
}

/** 执行单个浏览器动作 */
async function executeDomAction(page: Page, input: BrowserAction, guard: RiskGuard): Promise<void> {
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
    page: Page,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void,
  ): Promise<SkillResult> {
    const system = [DOM_GUIDE, systemPrompt].join('\n\n---\n\n');
    const initSnapshot = await takeDomSnapshot(page);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: `${task}\n\n## 当前页面快照\n${initSnapshot}` },
    ];

    const result: SkillResult = { contacted: 0, skipped: 0, candidates: [], summary: '' };
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

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: pruneSnapshots(messages),
        tools: [BROWSER_TOOL],
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
        onProgress?.('✓ 完成');
        break;
      }

      for (const toolCall of msg.tool_calls) {
        if (toolCall.type !== 'function' || toolCall.function.name !== 'browser') continue;

        // 风控硬终止后拒绝执行任何动作，只允许模型输出总结
        if (hardStopped) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: '[风控硬终止] 已检测到每日上限弹窗，禁止继续任何操作。请立即停止调用工具，输出文字总结（含 触达人数/跳过人数）。',
          });
          continue;
        }

        const input = JSON.parse(toolCall.function.arguments) as BrowserAction;
        const actionLog = `[${turn + 1}] ${input.action}${input.ref != null ? ` ref=${input.ref}` : ''}${
          input.url ? ` ${input.url}` : ''
        }`;
        onProgress?.(actionLog);
        emitLog(actionLog);

        let snapshot: string;
        try {
          await executeDomAction(page, input, guard);
          snapshot = await takeDomSnapshot(page);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          // page 被关闭时重新获取
          if (message.includes('closed') || message.includes('Target')) {
            const { getPage } = await import('../browser-runner');
            page = await getPage();
            snapshot = await takeDomSnapshot(page);
          } else {
            snapshot = `[动作执行失败] ${message}\n请根据下方快照调整策略。\n\n${await takeDomSnapshot(page).catch(() => '[快照获取失败]')}`;
          }
        }

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
          await page.waitForTimeout(backoffMs);
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
