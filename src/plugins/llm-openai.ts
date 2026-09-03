import OpenAI from 'openai';
import {
  cloneAssistantMessage,
  mergeChatParams,
  openaiClient,
  resolveEndpoint,
} from '../llm/provider';
import type { Context } from '../dsh/context';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../dsh/types';
import type { LLMService } from '../dsh/llm';

type AssistantExtras = {
  reasoning_content?: string;
  reasoning?: string;
};

/** 兼容旧入口：chat 角色的 OpenAI 兼容 client + 模型名 */
export function resolveLLM(): { client: OpenAI; model: string } {
  const endpoint = resolveEndpoint('chat');
  return { client: openaiClient(endpoint), model: endpoint.model };
}

function toResponse(message: OpenAI.Chat.Completions.ChatCompletionMessage): LLMResponse {
  const cloned = cloneAssistantMessage(message) as OpenAI.Chat.Completions.ChatCompletionMessage & AssistantExtras;
  const reasoning = cloned.reasoning_content || cloned.reasoning;
  return {
    content: cloned.content,
    tool_calls: cloned.tool_calls,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  };
}

function chatCall(req: LLMRequest): {
  client: OpenAI;
  params: Record<string, unknown>;
  options: { signal: AbortSignal } | undefined;
} {
  const endpoint = resolveEndpoint('chat');
  return {
    client: openaiClient(endpoint),
    params: mergeChatParams(endpoint, {
      model: req.model || endpoint.model,
      messages: req.messages,
      tools: req.tools.length ? req.tools : undefined,
      tool_choice: req.tools.length ? 'auto' : undefined,
      max_tokens: req.maxTokens ?? 4096,
    }),
    options: req.signal ? { signal: req.signal } : undefined,
  };
}

export function openaiAdapter(): LLMAdapter {
  return {
    id: 'openai-compatible',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const { client, params, options } = chatCall(req);
      const res = await client.chat.completions.create(
        params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        options,
      );
      return toResponse(res.choices[0].message);
    },
    async stream(req: LLMRequest, onDelta: (delta: string) => void): Promise<LLMResponse> {
      const { client, params, options } = chatCall(req);
      const stream = client.beta.chat.completions.stream(params as any, options);
      stream.on('content', delta => onDelta(delta));
      const completion = await stream.finalChatCompletion();
      return toResponse(completion.choices[0].message);
    },
  };
}

export function llmOpenAIPlugin(ctx: Context): void {
  const llm = ctx.get<LLMService>('llm');
  llm.register(openaiAdapter());
  llm.setDefaultModel(resolveEndpoint('chat').model);
}
