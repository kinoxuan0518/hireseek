import Anthropic from '@anthropic-ai/sdk';
import { Page } from 'playwright';
import { config } from '../config';
import { takeScreenshot, executeAction } from '../browser-runner';
import type { LLMRunner } from './interface';
import { parseSkillSummary } from './interface';
import type { SkillResult } from '../types';

const MAX_TURNS = 120;

export class ClaudeRunner implements LLMRunner {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  async runSkill(
    page: Page,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void
  ): Promise<SkillResult> {
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

    const result: SkillResult = { contacted: 0, skipped: 0, candidates: [], summary: '' };

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

        let content: Anthropic.Beta.BetaToolResultBlockParam['content'];

        if (input.action === 'screenshot') {
          const img = await takeScreenshot(page);
          content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }];
        } else {
          const actionResult = await executeAction(page, input);
          const img = await takeScreenshot(page);
          content = [
            { type: 'text', text: actionResult },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
          ];
        }

        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content });
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }

    return result;
  }
}
