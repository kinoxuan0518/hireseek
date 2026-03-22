// @hireclaw/core/llm — Multi-LLM Provider
//
// Unified interface for calling Claude / OpenAI / DeepSeek / any OpenAI-compatible API.
// All SDK modules that need LLM go through this single abstraction.

import type { LLMConfig } from '../types.js';

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  /** System prompt (convenience, appended as first message) */
  system?: string;
  /** Conversation messages */
  messages?: LLMMessage[];
  /** User prompt (convenience, appended as last user message) */
  prompt?: string;
  /** Output format hint — we parse JSON from the response */
  jsonMode?: boolean;
  /** Max tokens */
  maxTokens?: number;
  /** Temperature (0 = deterministic, 1 = creative) */
  temperature?: number;
}

export interface LLMResponse {
  /** Raw text from the LLM */
  text: string;
  /** If jsonMode=true, the parsed JSON object */
  json?: unknown;
  /** Model used */
  model: string;
  /** Usage info if available */
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Call an LLM with the given config and options.
 *
 * This is the single entry point all SDK modules use to talk to LLMs.
 * It handles provider routing, authentication, and response parsing.
 */
export async function callLLM(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMResponse> {
  const provider = resolveProvider(config);
  const messages = buildMessages(options);

  const body = {
    model: config.model,
    messages,
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.3,
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const { url, headers } = provider;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers(config),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return parseResponse(data, config.model);
}

// ────────────────────────────────────────────────────────────
// Provider Resolution
// ────────────────────────────────────────────────────────────

interface ProviderConfig {
  url: string;
  headers: (config: LLMConfig) => Record<string, string>;
}

function resolveProvider(config: LLMConfig): ProviderConfig {
  switch (config.provider) {
    case 'claude':
      return {
        url: config.baseUrl ?? 'https://api.anthropic.com/v1/messages',
        headers: (cfg) => ({
          'x-api-key': cfg.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
      };
    case 'openai':
      return {
        url: config.baseUrl ?? 'https://api.openai.com/v1/chat/completions',
        headers: (cfg) => ({
          Authorization: `Bearer ${cfg.apiKey ?? ''}`,
        }),
      };
    case 'custom':
      if (!config.baseUrl) {
        throw new Error('custom provider requires baseUrl in LLMConfig');
      }
      return {
        url: config.baseUrl,
        headers: (cfg) => {
          const h: Record<string, string> = {};
          if (cfg.apiKey) {
            h.Authorization = `Bearer ${cfg.apiKey}`;
          }
          return h;
        },
      };
    default:
      throw new Error(`Unknown LLM provider: ${config.provider as string}`);
  }
}

// ────────────────────────────────────────────────────────────
// Message Building
// ────────────────────────────────────────────────────────────

function buildMessages(options: LLMCallOptions): LLMMessage[] {
  const msgs: LLMMessage[] = [];

  if (options.system) {
    msgs.push({ role: 'system', content: options.system });
  }

  if (options.messages) {
    msgs.push(...options.messages);
  }

  if (options.prompt) {
    msgs.push({ role: 'user', content: options.prompt });
  }

  return msgs;
}

// ────────────────────────────────────────────────────────────
// Response Parsing
// ────────────────────────────────────────────────────────────

function parseResponse(data: Record<string, unknown>, model: string): LLMResponse {
  // Handle Claude API response format
  if ('content' in data && Array.isArray(data.content)) {
    const blocks = data.content as Array<{ type: string; text?: string }>;
    const text = blocks.map(b => b.text ?? '').join('');
    return {
      text,
      json: tryParseJSON(text),
      model,
      usage: parseUsage(data.usage as Record<string, unknown>),
    };
  }

  // Handle OpenAI-compatible response format
  if ('choices' in data && Array.isArray(data.choices)) {
    const choices = data.choices as Array<{ message?: { content?: string } }>;
    const text = choices[0]?.message?.content ?? '';
    return {
      text,
      json: tryParseJSON(text),
      model,
      usage: parseUsage(data.usage as Record<string, unknown>),
    };
  }

  throw new Error(`Unexpected LLM response format: ${JSON.stringify(data).slice(0, 200)}`);
}

function tryParseJSON(text: string): unknown {
  // Try to extract JSON from markdown code blocks or raw text
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ??
    text.match(/(\{[\s\S]*\})/) ??
    text.match(/(\[[\s\S]*\])/);

  if (!jsonMatch) return undefined;

  try {
    return JSON.parse(jsonMatch[1].trim());
  } catch {
    return undefined;
  }
}

function parseUsage(usage?: Record<string, unknown>): LLMResponse['usage'] {
  if (!usage) return undefined;
  return {
    inputTokens: (usage.input_tokens ?? usage.prompt_tokens ?? 0) as number,
    outputTokens: (usage.output_tokens ?? usage.completion_tokens ?? 0) as number,
  };
}
