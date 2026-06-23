import OpenAI from 'openai';
import { Page } from 'playwright';
import { config } from '../config';
import { takeScreenshot, executeAction } from '../browser-runner';
import type { LLMRunner, RunSkillOptions } from './interface';
import { parseSkillSummary } from './interface';
import type { SkillResult } from '../types';
import { recordToolCall } from '../agent-core/trace';
import {
  computerActionHasSideEffect,
  computerActionMode,
  dryRunBlocksComputerAction,
} from '../agent-core/computer-actions';

const MAX_TURNS = 120;

/**
 * OpenAI computer-use 实现（Responses API）。
 * 模型：computer-use-preview
 * 文档：https://platform.openai.com/docs/guides/computer-use
 */
export class OpenAIRunner implements LLMRunner {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
  }

  async runSkill(
    page: Page,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void,
    options: RunSkillOptions = {},
  ): Promise<SkillResult> {
    const executionMode = options.executionMode ?? 'execute';
    const { width, height } = config.browser.viewport;

    // OpenAI Responses API 的输入格式（用 any[] 兼容 SDK 版本差异）
    let input: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: task },
    ];

    const result: SkillResult = { contacted: 0, skipped: 0, candidates: [], summary: '', trace: [] };

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await (this.client.responses as any).create({
        model: config.openai.model,
        tools: [{
          type: 'computer_use_preview',
          display_width:  width,
          display_height: height,
          environment:    'browser',
        }],
        input,
        truncation: 'auto',
      });

      // 任务完成（没有 tool call）
      const toolUses = response.output?.filter((o: any) => o.type === 'computer_call') ?? [];
      const textOutputs = response.output?.filter((o: any) => o.type === 'message') ?? [];

      if (toolUses.length === 0) {
        const finalText = textOutputs
          .flatMap((m: any) => m.content ?? [])
          .filter((c: any) => c.type === 'output_text')
          .map((c: any) => c.text)
          .join('\n');

        result.summary = finalText;
        const parsed = parseSkillSummary(finalText);
        result.contacted = parsed.contacted;
        result.skipped   = parsed.skipped;
        onProgress?.('✓ 完成');
        break;
      }

      // 执行 tool call，收集结果
      const toolResults: any[] = [];
      const blockedNotices: string[] = [];

      for (const toolUse of toolUses) {
        const action = toolUse.action;

        onProgress?.(
          `[${turn + 1}] ${action.type}${action.coordinate ? ` (${action.coordinate})` : ''}`
        );

        // 把 OpenAI action 格式转换成通用格式
        const normalized = this.normalizeAction(action);
        const actionName = String(normalized.action ?? 'unknown');
        const sideEffect = computerActionHasSideEffect(actionName);
        const mode = computerActionMode(actionName, executionMode);
        const stageId = options.initialStageId;
        let stepOk = true;
        let stepError: string | null = null;
        let imgData = '';

        if (executionMode === 'dry_run' && dryRunBlocksComputerAction(actionName)) {
          stepOk = false;
          stepError = `dry-run 预检模式禁止执行 ${actionName}，已阻止真实 computer 动作。`;
          blockedNotices.push(stepError);
          imgData = await takeScreenshot(page);
        } else {
          try {
            if (actionName !== 'screenshot') await executeAction(page, normalized);
          } catch (err) {
            stepOk = false;
            stepError = err instanceof Error ? err.message : String(err);
          }
          imgData = await takeScreenshot(page);
        }

        recordToolCall({
          runId: options.runId,
          sessionId: options.sessionId,
          toolCallId: toolUse.call_id,
          toolName: 'computer',
          input: normalized,
          output: stepOk ? 'screenshot captured' : stepError,
          ok: stepOk,
          error: stepError,
          sideEffect,
          mode,
          stageId,
        });
        result.trace!.push({
          seq: result.trace!.length + 1,
          action: actionName,
          ok: stepOk,
          toolName: 'computer',
          error: stepError ?? undefined,
          sideEffect,
          mode,
          stageId,
        });

        toolResults.push({
          role: 'user' as const,
          content: [{
            type:           'computer_call_output',
            call_id:        toolUse.call_id,
            output:         { type: 'image_url', image_url: `data:image/jpeg;base64,${imgData}` },
          }] as any,
        });
      }

      // 把本轮 assistant 输出 + tool 结果追加到 input
      input = [
        ...input,
        { role: 'assistant', content: response.output } as any,
        ...toolResults,
        ...(blockedNotices.length > 0
          ? [{ role: 'user', content: [{ type: 'input_text', text: blockedNotices.join('\n') }] } as any]
          : []),
      ];
    }

    return result;
  }

  /**
   * 把 OpenAI computer-use 的 action 格式转换成 browser-runner 通用格式
   */
  private normalizeAction(action: any): any {
    const typeMap: Record<string, string> = {
      screenshot:   'screenshot',
      click:        'left_click',
      double_click: 'double_click',
      type:         'type',
      key_press:    'key',
      scroll:       'scroll',
      move:         'move',
    };

    return {
      action:     typeMap[action.type] ?? action.type,
      coordinate: action.coordinate ?? action.position,
      text:       action.text ?? action.key,
      direction:  action.direction,
      amount:     action.amount ?? action.scroll_distance,
    };
  }
}
