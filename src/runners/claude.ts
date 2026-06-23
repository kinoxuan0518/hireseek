import Anthropic from '@anthropic-ai/sdk';
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

export class ClaudeRunner implements LLMRunner {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey:  config.anthropic.apiKey,
      ...(config.anthropic.baseUrl ? { baseURL: config.anthropic.baseUrl } : {}),
    });
  }

  async runSkill(
    page: Page,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void,
    options: RunSkillOptions = {},
  ): Promise<SkillResult> {
    const executionMode = options.executionMode ?? 'execute';
    const COMPUTER_TOOL = {
      type: 'computer_20241022' as const,
      name: 'computer' as const,
      display_width_px: config.browser.viewport.width,
      display_height_px: config.browser.viewport.height,
      display_number: 1,
    };

    // 初始截图，让 Claude 了解当前页面
    const initImg = await takeScreenshot(page);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: 'user', content: task },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'init',
          content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: initImg } }],
        }],
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
      const response = await this.client.beta.messages.create({
        model: config.llm.model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: [COMPUTER_TOOL],
        messages,
        betas: ['computer-use-2024-10-22'],
      });

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const finalText = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        result.summary = finalText;
        const parsed = parseSkillSummary(finalText);
        result.contacted = parsed.contacted;
        result.skipped   = parsed.skipped;
        onProgress?.('✓ 完成');
        break;
      }

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const tool  = block as Anthropic.Beta.BetaToolUseBlock;
        const input = tool.input as any;

        onProgress?.(
          `[${turn + 1}] ${input.action}${input.coordinate ? ` (${input.coordinate})` : ''}`
        );

        const action = String(input.action ?? 'unknown');
        const sideEffect = computerActionHasSideEffect(action);
        const mode = computerActionMode(action, executionMode);
        const stageId = options.initialStageId;
        let content: Anthropic.Beta.BetaToolResultBlockParam['content'];
        let stepOk = true;
        let stepError: string | null = null;

        if (executionMode === 'dry_run' && dryRunBlocksComputerAction(action)) {
          stepOk = false;
          stepError = `dry-run 预检模式禁止执行 ${action}，已阻止真实 computer 动作。`;
          const img = await takeScreenshot(page);
          content = [
            { type: 'text', text: stepError },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
          ];
        } else {
          let actionResult = '';
          try {
            if (action !== 'screenshot') actionResult = await executeAction(page, input);
          } catch (err) {
            stepOk = false;
            stepError = err instanceof Error ? err.message : String(err);
            actionResult = `动作执行失败：${stepError}`;
          }
          const img = await takeScreenshot(page);
          content = action === 'screenshot'
            ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }]
            : [
                { type: 'text', text: actionResult },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
              ];
        }

        recordToolCall({
          runId: options.runId,
          sessionId: options.sessionId,
          toolCallId: tool.id,
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
          action,
          ok: stepOk,
          toolName: 'computer',
          error: stepError ?? undefined,
          sideEffect,
          mode,
          stageId,
        });

        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content });
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }

    return result;
  }
}
