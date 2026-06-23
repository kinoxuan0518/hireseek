/**
 * 通用视觉 Runner：适配任何支持 vision + function calling 的 OpenAI 兼容 API。
 * 适用：MiniMax、Qwen-VL、GLM-4V、Doubao、Moonshot 等
 *
 * 原理：用 function calling 定义 "computer" 工具，替代 Claude/OpenAI 的原生 computer-use。
 * 模型通过函数调用输出动作，Runner 用 Playwright 执行，再截图回传。
 */

import fs from 'fs';
import OpenAI from 'openai';
import { emitLog, popIntervention } from '../events';
import { Page } from 'playwright';
import { takeScreenshot, executeAction } from '../browser-runner';
import { parseSkillSummary } from './interface';
import type { LLMRunner, RunSkillOptions } from './interface';
import type { SkillResult } from '../types';
import { repairToolMessageHistoryInPlace } from '../message-integrity';
import {
  createToolRegistry,
  unknownToolResult,
} from '../agent-core/tool-registry';
import { recordRejectedToolCall, recordToolCall } from '../agent-core/trace';
import {
  computerActionHasSideEffect,
  computerActionMode,
  dryRunBlocksComputerAction,
} from '../agent-core/computer-actions';

const SCREENSHOT_PATH = '/tmp/hireseek-latest.jpg';

function saveScreenshot(base64: string): void {
  try {
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(base64, 'base64'));
  } catch {}
}

// ── 通用 computer-use 工具定义（OpenAI function calling 格式）────────────
const COMPUTER_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'computer',
    description:
      '控制浏览器执行招聘操作。每次调用执行一个动作，然后会收到新截图确认结果。',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'screenshot',    // 截图查看当前状态
            'left_click',    // 左键点击
            'right_click',   // 右键点击
            'double_click',  // 双击
            'type',          // 键盘输入文字
            'key',           // 按下特定按键（如 Enter、Escape）
            'scroll',        // 滚动页面
            'move',          // 移动鼠标（不点击）
          ],
          description: '要执行的操作类型',
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] 像素坐标，left_click/right_click/double_click/move/scroll 时必填',
        },
        text: {
          type: 'string',
          description: 'type 时填输入内容，key 时填按键名（如 Enter、Tab、Escape）',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'scroll 时的滚动方向',
        },
        amount: {
          type: 'number',
          description: 'scroll 时的像素距离，默认 500',
        },
        stage_id: {
          type: 'string',
          description: '可选：当前动作所属的协议阶段 id。',
        },
      },
    },
  },
};

export const GENERIC_VISION_TOOL_REGISTRY = createToolRegistry([COMPUTER_TOOL]);
const GENERIC_VISION_TOOLS = GENERIC_VISION_TOOL_REGISTRY.list().map(tool => tool.schema);

// ── 注入给模型的操作说明（弥补非原生 computer-use 模型的训练差距）─────────
const COMPUTER_USE_GUIDE = `
## 浏览器操作说明

你可以通过调用 computer 工具来控制浏览器。操作规范：

1. **开始前先截图**：调用 computer(action="screenshot") 查看当前页面状态
2. **每次只执行一个动作**，动作后会收到新截图确认结果
3. **坐标系**：左上角为 (0,0)，屏幕分辨率 1280×800
4. **点击前先确认**：看清楚要点的按钮位置，再调用 left_click
5. **滚动加载**：如果页面有更多内容，用 scroll(direction="down") 加载
6. **任务完成**：所有候选人处理完毕后，直接回复文字总结，不再调用工具

输出总结时必须包含：
触达人数: <数字>
跳过人数: <数字>
`.trim();

const MAX_TURNS = 150;

/**
 * 只保留最近 keepLast 张截图，其余替换为占位文字，控制 token 消耗。
 */
function pruneImages(
  messages: OpenAI.ChatCompletionMessageParam[],
  keepLast = 3
): OpenAI.ChatCompletionMessageParam[] {
  // 收集所有含图片的 content 块位置
  const imgRefs: Array<{ msgIdx: number; partIdx: number }> = [];

  messages.forEach((msg, mi) => {
    if (!Array.isArray(msg.content)) return;
    (msg.content as any[]).forEach((part, pi) => {
      if (part?.type === 'image_url') imgRefs.push({ msgIdx: mi, partIdx: pi });
    });
  });

  if (imgRefs.length <= keepLast) return messages;

  // 深拷贝后替换旧截图
  const pruned = messages.map(m => ({ ...m, content: Array.isArray(m.content) ? [...(m.content as any[])] : m.content }));
  const toPrune = imgRefs.slice(0, imgRefs.length - keepLast);

  for (const { msgIdx, partIdx } of toPrune) {
    (pruned[msgIdx].content as any[])[partIdx] = { type: 'text', text: '[截图已省略]' };
  }

  return pruned as OpenAI.ChatCompletionMessageParam[];
}

/**
 * 兼容层：解析模型在 content 里输出的非标准工具调用格式。
 * 支持：
 *   - Qwen: <ref>computer.screenshot()</ref>
 *   - 纯文本: computer(action="screenshot")
 *   - JSON block: ```json\n{"action":"screenshot"}```
 */
function parseContentToolCall(content: string): OpenAI.ChatCompletionMessageToolCall | null {
  let args: Record<string, unknown> | null = null;

  // 1. Qwen <ref>computer.METHOD()</ref> 格式
  const refMatch = content.match(/<ref>computer\.(\w+)\((.*?)\)<\/ref>/s);
  if (refMatch) {
    const action = refMatch[1];
    const rawArgs = refMatch[2].trim();
    args = { action };
    if (rawArgs) {
      // 尝试解析 key=value 参数
      for (const m of rawArgs.matchAll(/(\w+)=([^,)]+)/g)) {
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (m[1] === 'coordinate') {
          args[m[1]] = JSON.parse(val);
        } else {
          args[m[1]] = isNaN(Number(val)) ? val : Number(val);
        }
      }
    }
  }

  // 2. computer(action="screenshot") 格式
  if (!args) {
    const plainMatch = content.match(/computer\s*\(\s*action\s*=\s*["'](\w+)["'](.*?)\)/s);
    if (plainMatch) {
      args = { action: plainMatch[1] };
      for (const m of (plainMatch[2] || '').matchAll(/(\w+)\s*=\s*([^,)]+)/g)) {
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        args[m[1]] = isNaN(Number(val)) ? val : Number(val);
      }
    }
  }

  // 3. ```json { "action": "..." } ``` 格式
  if (!args) {
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try { args = JSON.parse(jsonMatch[1]); } catch {}
    }
  }

  if (!args || !args['action']) return null;

  return {
    id: `fallback_${Date.now()}`,
    type: 'function',
    function: {
      name: 'computer',
      arguments: JSON.stringify(args),
    },
  };
}

export class GenericVisionRunner implements LLMRunner {
  private client: OpenAI;
  private model: string;

  constructor(baseURL: string, apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model  = model;
  }

  async runSkill(
    page: Page,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void,
    options: RunSkillOptions = {},
  ): Promise<SkillResult> {
    const executionMode = options.executionMode ?? 'execute';
    const system = [COMPUTER_USE_GUIDE, systemPrompt].join('\n\n---\n\n');

    // 初始截图
    const initImg = await takeScreenshot(page);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text',      text: task },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${initImg}` } },
        ],
      },
    ];

    const result: SkillResult = { contacted: 0, skipped: 0, candidates: [], summary: '', trace: [] };
    result.trace!.push({
      seq: 1,
      action: 'screenshot',
      detail: 'initial screenshot',
      ok: true,
      toolName: 'computer',
      sideEffect: false,
      mode: executionMode === 'dry_run' ? 'dry_run' : 'read',
      stageId: options.initialStageId,
    });
    recordToolCall({
      runId: options.runId,
      sessionId: options.sessionId,
      toolName: 'computer',
      input: { action: 'screenshot', source: 'initial' },
      output: 'screenshot captured',
      ok: true,
      sideEffect: false,
      mode: executionMode === 'dry_run' ? 'dry_run' : 'read',
      stageId: options.initialStageId,
    });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // 检查用户介入指令
      const intervention = popIntervention();
      if (intervention) {
        const msg = `[用户介入] ${intervention}`;
        onProgress?.(`📩 ${msg}`);
        emitLog(`📩 ${msg}`);
        messages.push({ role: 'user', content: msg });
      }

      repairToolMessageHistoryInPlace(messages);
      const response = await this.client.chat.completions.create({
        model:    this.model,
        messages: pruneImages(messages, 2),
        tools:    GENERIC_VISION_TOOLS,
        tool_choice: 'auto',
        max_tokens:  2048,
      });

      const msg = response.choices[0].message;

      // 兼容 Qwen 等模型：将 content 中的非标准工具调用转为标准格式
      if ((!msg.tool_calls || msg.tool_calls.length === 0) && msg.content) {
        const parsed = parseContentToolCall(msg.content);
        if (parsed) {
          (msg as any).tool_calls = [parsed];
          msg.content = null;
        }
      }

      // 打印 LLM 的推理文字（它在想什么）
      if (msg.content) {
        const thought = `💭 ${msg.content}`;
        onProgress?.(thought);
        emitLog(thought);
      }

      messages.push(msg);

      // 没有工具调用 → 任务完成，msg.content 是最终总结
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalText = msg.content ?? '';
        result.summary  = finalText;
        const parsed    = parseSkillSummary(finalText);
        result.contacted = parsed.contacted;
        result.skipped   = parsed.skipped;
        onProgress?.('✓ 完成');
        break;
      }

      // 处理工具调用（每次一个，串行执行）
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
      let latestImage: string | null = null;

      for (const toolCall of msg.tool_calls) {
        if (toolCall.function.name !== 'computer') {
          const content = unknownToolResult(toolCall.function.name);
          toolResults.push({ role: 'tool', tool_call_id: toolCall.id, content });
          recordRejectedToolCall({
            registry: GENERIC_VISION_TOOL_REGISTRY,
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

        let input: {
          action: string;
          coordinate?: [number, number];
          text?: string;
          direction?: string;
          amount?: number;
          stage_id?: string;
        };
        try {
          input = JSON.parse(toolCall.function.arguments || '{}');
        } catch (err) {
          const error = `computer 参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}`;
          toolResults.push({ role: 'tool', tool_call_id: toolCall.id, content: error });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'computer',
            input: toolCall.function.arguments,
            output: error,
            ok: false,
            error,
            sideEffect: true,
            mode: executionMode === 'dry_run' ? 'dry_run' : 'execute',
          });
          continue;
        }

        const sideEffect = computerActionHasSideEffect(input.action);
        const mode = computerActionMode(input.action, executionMode);
        const stageId = input.stage_id ?? options.initialStageId;

        if (executionMode === 'dry_run' && dryRunBlocksComputerAction(input.action)) {
          const blocked = `dry-run 预检模式禁止执行 ${input.action}，已阻止真实 computer 动作。`;
          toolResults.push({ role: 'tool', tool_call_id: toolCall.id, content: blocked });
          recordToolCall({
            runId: options.runId,
            sessionId: options.sessionId,
            toolCallId: toolCall.id,
            toolName: 'computer',
            input,
            output: blocked,
            ok: false,
            error: blocked,
            sideEffect,
            mode,
            stageId,
          });
          result.trace!.push({
            seq: result.trace!.length + 1,
            action: input.action,
            detail: 'blocked by dry-run',
            ok: false,
            toolName: 'computer',
            error: blocked,
            sideEffect,
            mode,
            stageId,
          });
          continue;
        }

        const actionLog = `[${turn + 1}] ${input.action}${
          input.coordinate ? ` (${input.coordinate[0]}, ${input.coordinate[1]})` : ''
        }`;
        onProgress?.(actionLog);
        emitLog(actionLog);

        let imgData = '';
        let stepOk = true;
        let stepError: string | null = null;

        try {
          if (input.action === 'screenshot') {
            imgData = await takeScreenshot(page);
          } else {
            await executeAction(page, input);
            imgData = await takeScreenshot(page);
          }
        } catch (err) {
          stepOk = false;
          stepError = err instanceof Error ? err.message : String(err);
          if (stepError.includes('closed') || stepError.includes('Target')) {
            const { getPage } = await import('../browser-runner');
            page = await getPage();
          }
          imgData = await takeScreenshot(page).catch(() => '');
        }

        // 保存最新截图供用户查看
        if (imgData) {
          saveScreenshot(imgData);
          latestImage = imgData;
        }
        if (turn === 0) {
          onProgress?.(`📸 实时截图：${SCREENSHOT_PATH}`);
        }

        // 把截图作为工具结果回传（text 形式嵌入 base64，兼容性最好）
        const content = imgData
          ? JSON.stringify({ type: 'image', url: `data:image/jpeg;base64,${imgData}`, ok: stepOk, error: stepError })
          : JSON.stringify({ ok: false, error: stepError ?? 'screenshot unavailable' });
        toolResults.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          content,
        });
        recordToolCall({
          runId: options.runId,
          sessionId: options.sessionId,
          toolCallId: toolCall.id,
          toolName: 'computer',
          input,
          output: stepOk ? 'screenshot captured' : stepError,
          ok: stepOk,
          error: stepError,
          sideEffect,
          mode,
          stageId,
        });
        result.trace!.push({
          seq: result.trace!.length + 1,
          action: input.action,
          detail: input.text?.slice(0, 60),
          ok: stepOk,
          toolName: 'computer',
          error: stepError ?? undefined,
          sideEffect,
          mode,
          stageId,
        });
      }

      // 把工具结果追加；同时附一条 user 消息告知模型继续
      messages.push(...toolResults);
      const visibleImage = latestImage ?? await takeScreenshot(page);
      messages.push({
        role:    'user',
        content: [
          { type: 'text', text: '以上是操作后的截图，请继续执行任务。' },
          // 重新截图一次，确保模型能看到最新状态
          {
            type:      'image_url',
            image_url: { url: `data:image/jpeg;base64,${visibleImage}` },
          },
        ],
      });
    }

    return result;
  }
}
