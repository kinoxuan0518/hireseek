/**
 * 默认 Agent Loop：turn/start → pre-step → (step → request → tools →) → turn-stopping → turn/end
 */

import { repairToolMessageHistoryInPlace } from '../message-integrity';
import { recordRejectedToolCall } from '../agent-core/trace';
import type { Context } from './context';
import type { PromptService } from './prompt';
import type { LLMService } from './llm';
import type { Session } from './session';
import type { ToolService } from './tools';
import type { LLMResponse, TurnOptions, TurnResult } from './types';

const DEFAULT_MAX_STEPS = 30;
const DEFAULT_PAUSE = '[系统] 用户暂停了任务。立即停止当前流程（不要再调用工具），用 2-3 句话汇报目前进度（已完成什么/进行到哪），然后等待用户指示。';

export class AgentLoop {
  constructor(private readonly ctx: Context) {}

  async runTurn(opts: TurnOptions): Promise<TurnResult> {
    const session = opts.session;
    const tools = this.ctx.get<ToolService>('tools');
    const llm = this.ctx.get<LLMService>('llm');
    const prompt = this.ctx.tryGet<PromptService>('systemPrompt');
    const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

    if (!opts.preserveSystem && prompt) {
      const assembled = prompt.assemble();
      if (assembled) session.ensureSystem(assembled);
    }

    session.append('turn/start', { source: opts.source ?? session.source });
    if (opts.input) session.append('user/message', { content: opts.input });

    const admitted = await this.ctx.waterfall('agent/pre-step', {
      session,
      messages: session.deriveMessages(),
      reject: false,
    });
    if (admitted.reject) {
      session.append('turn/end', { reason: 'reject' });
      await this.ctx.serial('agent/turn-stopping', { session, reason: 'reject' });
      return { text: '', steps: 0, stopped: 'reject' };
    }

    let lastText = '';
    let steps = 0;

    for (let step = 0; step < maxSteps; step++) {
      if (opts.signal?.aborted) {
        session.append('turn/end', { reason: 'abort' });
        return { text: lastText, steps, stopped: 'abort' };
      }

      steps += 1;
      session.append('step/start', { step });
      opts.onStepStart?.(step);

      const messages = session.deriveMessages();
      repairToolMessageHistoryInPlace(messages);

      const schemas = tools.schemas(opts.toolFilter);
      const req = {
        model: opts.model || llm.getDefaultModel(),
        messages,
        tools: schemas,
        maxTokens: 4096,
        signal: opts.signal,
      };

      let response: LLMResponse;
      try {
        response = opts.stream
          ? await llm.stream(req, delta => opts.onAssistantDelta?.(delta))
          : await llm.complete(req);
      } catch (err) {
        if (opts.signal?.aborted || (err as { name?: string })?.name === 'APIUserAbortError') {
          session.append('turn/end', { reason: 'abort' });
          return { text: lastText, steps, stopped: 'abort' };
        }
        throw err;
      }

      lastText = response.content ?? lastText;
      session.append('assistant/message', assistantPayload(response));
      opts.onStepEnd?.(step, response);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        session.append('step/end', { step, tools: 0 });
        session.append('turn/end', { reason: 'complete' });
        await this.ctx.serial('agent/turn-stopping', { session, reason: 'complete' });
        return { text: response.content ?? '（没有可回复的内容）', steps, stopped: 'complete' };
      }

      await this.executeTools(session, tools, response, opts);
      session.append('step/end', { step, tools: response.tool_calls.length });

      if (opts.shouldStop?.()) {
        session.append('user/message', { content: opts.pausePrompt ?? DEFAULT_PAUSE });
        const wrap = session.deriveMessages();
        repairToolMessageHistoryInPlace(wrap);
        const paused = await llm.complete({
          model: opts.model || llm.getDefaultModel(),
          messages: wrap,
          tools: schemas,
          maxTokens: 4096,
          signal: opts.signal,
        });
        session.append('assistant/message', assistantPayload(paused));
        session.append('turn/end', { reason: 'pause' });
        await this.ctx.serial('agent/turn-stopping', { session, reason: 'pause' });
        return { text: paused.content ?? lastText, steps, stopped: 'pause' };
      }

      const inbox = opts.drainInbox?.() ?? [];
      if (inbox.length > 0) {
        session.append('user/message', {
          content: inbox.map(item => `[用户插话] ${item}`).join('\n'),
        });
      }
    }

    const finalText = `这件事调用了很多步还没收尾（已达 ${maxSteps} 轮上限），我先停一下。要不要把任务拆细一点再让我继续？`;
    session.append('assistant/message', { content: finalText, tool_calls: null });
    session.append('turn/end', { reason: 'max-steps' });
    await this.ctx.serial('agent/turn-stopping', { session, reason: 'max-steps' });
    return { text: finalText, steps, stopped: 'max-steps' };
  }

  private async executeTools(
    session: Session,
    tools: ToolService,
    response: LLMResponse,
    opts: TurnOptions,
  ): Promise<void> {
    for (const call of response.tool_calls ?? []) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      let output: string | null = null;
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        output = `工具参数解析失败：${error}`;
        recordRejectedToolCall({
          registry: tools.getRegistry() ?? undefined,
          sessionId: session.id,
          toolCallId: call.id,
          toolName: name,
          input: call.function.arguments,
          output,
          error,
        });
      }

      if (opts.toolFilter && !opts.toolFilter(name)) {
        output = '后台任务不能使用该工具，请换其他方式或在总结中说明此限制。';
        recordRejectedToolCall({
          registry: tools.getRegistry() ?? undefined,
          sessionId: session.id,
          toolCallId: call.id,
          toolName: name,
          input: call.function.arguments,
          output,
          error: 'tool not allowed in sub-agent',
        });
      }

      session.append('tool/call', { name, arguments: call.function.arguments, tool_call_id: call.id });
      await opts.onBeforeTool?.(name, args, call);

      if (output == null) {
        output = await tools.execute(name, args, {
          sessionId: session.id,
          toolCallId: call.id,
        }, { rawArgs: call.function.arguments, kind: opts.kind });
      }

      await opts.onAfterTool?.(name, output);
      session.append('tool/result', {
        name,
        content: output,
        tool_call_id: call.id,
      });
    }
  }
}

function assistantPayload(response: LLMResponse): Record<string, unknown> {
  return {
    content: response.content,
    tool_calls: response.tool_calls ?? null,
    ...(response.reasoning_content ? { reasoning_content: response.reasoning_content } : {}),
  };
}

export function loopPlugin(ctx: Context): void {
  ctx.provide('agentLoop', new AgentLoop(ctx));
}
