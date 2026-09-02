import OpenAI from 'openai';
import { config } from '../config';
import type { Context } from '../dsh/context';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../dsh/types';
import type { LLMService } from '../dsh/llm';

export function resolveLLM(): { client: OpenAI; model: string } {
  const usingDeepseek =
    Boolean(process.env.DEEPSEEK_API_KEY || config.deepseek.apiKey) &&
    !process.env.CUSTOM_API_KEY;

  const apiKey =
    process.env.DEEPSEEK_API_KEY ||
    process.env.CUSTOM_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    config.deepseek.apiKey ||
    config.custom.apiKey ||
    config.anthropic.apiKey;

  const baseURL = usingDeepseek
    ? config.deepseek.baseUrl
    : process.env.CUSTOM_BASE_URL ||
      process.env.ANTHROPIC_BASE_URL ||
      config.custom.baseUrl ||
      config.anthropic.baseUrl ||
      undefined;

  const model = process.env.LLM_MODEL || config.llm.model;
  return { client: new OpenAI({ apiKey, baseURL }), model };
}

function toResponse(message: OpenAI.Chat.Completions.ChatCompletionMessage): LLMResponse {
  return {
    content: message.content,
    tool_calls: message.tool_calls,
  };
}

export function openaiAdapter(): LLMAdapter {
  return {
    id: 'openai-compatible',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const { client } = resolveLLM();
      const res = await client.chat.completions.create(
        {
          model: req.model,
          messages: req.messages,
          tools: req.tools.length ? req.tools : undefined,
          tool_choice: req.tools.length ? 'auto' : undefined,
          max_tokens: req.maxTokens ?? 4096,
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      return toResponse(res.choices[0].message);
    },
    async stream(req: LLMRequest, onDelta: (delta: string) => void): Promise<LLMResponse> {
      const { client } = resolveLLM();
      const stream = client.beta.chat.completions.stream(
        {
          model: req.model,
          messages: req.messages,
          tools: req.tools.length ? req.tools : undefined,
          tool_choice: req.tools.length ? 'auto' : undefined,
          max_tokens: req.maxTokens ?? 4096,
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      stream.on('content', delta => onDelta(delta));
      const completion = await stream.finalChatCompletion();
      return toResponse(completion.choices[0].message);
    },
  };
}

export function llmOpenAIPlugin(ctx: Context): void {
  const llm = ctx.get<LLMService>('llm');
  llm.register(openaiAdapter());
  llm.setDefaultModel(process.env.LLM_MODEL || config.llm.model);
}
