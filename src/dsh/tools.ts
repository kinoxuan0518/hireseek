import type OpenAI from 'openai';
import type { ToolExecutionContext, ToolRegistry } from '../agent-core/tool-registry';
import { unknownToolResult } from '../agent-core/tool-registry';
import type { Context } from './context';
import type { ToolCallPayload } from './types';

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<string>;

export class ToolService {
  private registry: ToolRegistry | null = null;
  private executor: ToolExecutor | null = null;
  private orderedSchemas: OpenAI.ChatCompletionTool[] = [];
  describe: (name: string, args: Record<string, unknown>) => string = (name) => `⚙ ${name}`;

  constructor(private readonly ctx: Context) {
    this.ctx.on('tools/execute', async (payload: ToolCallPayload, next) => {
      if (!payload.blocked && payload.output == null) {
        if (!this.executor) {
          payload.ok = false;
          payload.error = 'tool executor is not bound';
          payload.output = `工具执行失败：${payload.error}`;
        } else {
          try {
            payload.output = await this.executor(payload.name, payload.args, payload.context);
            payload.ok = true;
          } catch (err) {
            payload.ok = false;
            payload.error = err instanceof Error ? err.message : String(err);
            payload.output = `工具执行失败：${payload.error}`;
          }
        }
      }
      return next(payload);
    });
  }

  bind(input: {
    registry: ToolRegistry;
    execute: ToolExecutor;
    schemas?: OpenAI.ChatCompletionTool[];
    describe?: (name: string, args: Record<string, unknown>) => string;
  }): void {
    this.registry = input.registry;
    this.executor = input.execute;
    this.orderedSchemas = input.schemas ?? input.registry.list().map(tool => tool.schema);
    if (input.describe) this.describe = input.describe;
  }

  bound(): boolean {
    return this.executor != null && this.registry != null;
  }

  getRegistry(): ToolRegistry | null {
    return this.registry;
  }

  schemas(filter?: (name: string) => boolean): OpenAI.ChatCompletionTool[] {
    const all = this.orderedSchemas.length
      ? this.orderedSchemas
      : (this.registry?.list().map(tool => tool.schema) ?? []);
    if (!filter) return all;
    return all.filter(schema => schema.type === 'function' && filter(schema.function.name));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext = {},
    extra: { rawArgs?: string; kind?: string } = {},
  ): Promise<string> {
    const registered = this.registry?.get(name);
    const mode = context.mode ?? (registered?.policy.sideEffect ? 'execute' : 'read');
    let payload: ToolCallPayload = {
      name,
      args,
      rawArgs: extra.rawArgs,
      context,
      kind: extra.kind,
      mode,
      ok: true,
      error: null,
    };

    if (!registered) {
      payload.blocked = true;
      payload.ok = false;
      payload.error = `unknown tool: ${name}`;
      payload.output = unknownToolResult(name);
      payload = await this.ctx.waterfall('tools/post-execute', payload);
      return payload.output ?? unknownToolResult(name);
    }

    payload = await this.ctx.waterfall('tools/pre-execute', payload);
    if (payload.blocked) {
      payload = await this.ctx.waterfall('tools/post-execute', payload);
      return payload.output ?? `工具调用被拒绝：${name}`;
    }

    payload = await this.ctx.waterfall('tools/execute', payload);
    payload = await this.ctx.waterfall('tools/post-execute', payload);
    return payload.output ?? '';
  }
}

export function toolsPlugin(ctx: Context): void {
  ctx.provide('tools', new ToolService(ctx));
}
