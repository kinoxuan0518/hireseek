import type { Context } from '../dsh/context';
import type { ToolCallPayload } from '../dsh/types';
import { checkPermission } from '../permissions';
import type { ToolService } from '../dsh/tools';

export function permissionPlugin(ctx: Context): void {
  ctx.on('tools/pre-execute', async (payload: ToolCallPayload, next) => {
    const tools = ctx.tryGet<ToolService>('tools');
    const registered = tools?.getRegistry()?.get(payload.name);
    if (!registered) return next(payload);

    const approved = await checkPermission({
      toolName: payload.name,
      args: payload.args,
      description: registered.schema.function.description,
      requiresApproval: registered.policy.requiresApproval,
      explicitMode: payload.context.mode,
      supportsDryRun: registered.policy.supportsDryRun,
    });
    if (!approved) {
      payload.blocked = true;
      payload.ok = false;
      payload.error = 'approval denied';
      payload.output = `工具调用被拒绝：${payload.name}（需审批；无头/自主回路默认拒绝，本地终端可确认，或预先在 workspace/.permissions.json 加 allow 规则）`;
      return payload;
    }
    return next(payload);
  });
}
