import type { Context } from '../dsh/context';
import type { ToolCallPayload } from '../dsh/types';
import { offloadToolResultForContext } from '../agent-core/tool-output-store';

export function offloadPlugin(ctx: Context): void {
  ctx.on('tools/post-execute', async (payload: ToolCallPayload, next) => {
    const result = await next(payload);
    if (result.output) {
      result.output = offloadToolResultForContext({
        content: result.output,
        toolName: result.name,
        sessionId: result.context.sessionId,
        toolCallId: result.context.toolCallId,
        runId: result.context.runId,
        kind: result.kind ?? 'dsh-tool-result',
      }).content;
    }
    return result;
  });
}
