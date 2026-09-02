import type { Context } from './context';
import type { LLMAdapter, LLMRequest, LLMResponse } from './types';

export class LLMService {
  private adapter: LLMAdapter | null = null;
  private defaultModel = '';

  register(adapter: LLMAdapter): void {
    this.adapter = adapter;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  current(): LLMAdapter {
    if (!this.adapter) throw new Error('dsh: no LLM adapter registered');
    return this.adapter;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const rewritten = await this.ctx.waterfall('agent/request', req);
    return this.current().complete(rewritten);
  }

  async stream(req: LLMRequest, onDelta: (delta: string) => void): Promise<LLMResponse> {
    const rewritten = await this.ctx.waterfall('agent/request', req);
    const adapter = this.current();
    if (adapter.stream) return adapter.stream(rewritten, onDelta);
    return adapter.complete(rewritten);
  }

  constructor(private readonly ctx: Context) {}
}

export function llmPlugin(ctx: Context): void {
  ctx.provide('llm', new LLMService(ctx));
}
