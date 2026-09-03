import type { Context } from '../dsh/context';
import type { ToolCallPayload } from '../dsh/types';
import { recordToolCall } from '../agent-core/trace';
import type { ToolService } from '../dsh/tools';

export function tracePlugin(ctx: Context): void {
  ctx.on('tools/post-execute', async (payload: ToolCallPayload, next) => {
    const result = await next(payload);
    const tools = ctx.tryGet<ToolService>('tools');
    const registered = tools?.getRegistry()?.get(result.name);
    recordToolCall({
      runId: result.context.runId,
      sessionId: result.context.sessionId,
      toolCallId: result.context.toolCallId,
      toolName: result.name,
      input: result.args,
      output: result.output,
      ok: result.ok !== false,
      error: result.error ?? null,
      sideEffect: registered?.policy.sideEffect,
      mode: result.mode ?? result.context.mode,
    });
    return result;
  });
}
