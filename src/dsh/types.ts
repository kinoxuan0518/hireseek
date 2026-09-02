/**
 * DeepSeek Harness 风格的运行时词汇。
 *
 * 对齐 dsh 的核心约定：
 * - 一切皆插件：服务、事件、可逆副作用挂在同一个 Context 上
 * - 模型看见的必须能从 Session Log 重建
 * - 一步 step = 一次模型请求 + 它触发的工具调用
 * - 一轮 turn = 若干 step，直到不再欠下一次请求
 */

import type OpenAI from 'openai';
import type { ToolExecutionContext, ToolExecutionMode } from '../agent-core/tool-registry';

export type ProfileName = 'chat' | 'headless' | 'subagent';

export type Disposer = () => void;

export type WaterfallNext<T> = (payload?: T) => Promise<T>;
export type WaterfallHandler<T = any> = (payload: T, next: WaterfallNext<T>) => Promise<T> | T;
export type ObserverHandler<T = any> = (payload: T) => void | Promise<void>;

export type SessionEventType =
  | 'turn/start'
  | 'turn/end'
  | 'step/start'
  | 'step/end'
  | 'system/set'
  | 'user/message'
  | 'assistant/message'
  | 'assistant/chunk'
  | 'tool/call'
  | 'tool/result'
  | 'inject/context';

export interface SessionEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: SessionEventType;
  at: string;
  payload: Record<string, unknown>;
}

export type ChatMessage = OpenAI.ChatCompletionMessageParam;

export interface PromptSection {
  id: string;
  priority: number;
  render: () => string | null | undefined;
}

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  tools: OpenAI.ChatCompletionTool[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
}

export interface LLMAdapter {
  id: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream?(req: LLMRequest, onDelta: (delta: string) => void): Promise<LLMResponse>;
}

export interface ToolCallPayload {
  name: string;
  args: Record<string, unknown>;
  rawArgs?: string;
  context: ToolExecutionContext;
  output?: string;
  error?: string | null;
  blocked?: boolean;
  ok?: boolean;
  mode?: ToolExecutionMode;
  kind?: string;
}

export type TurnStopReason = 'complete' | 'max-steps' | 'abort' | 'pause' | 'reject';

export interface TurnOptions {
  session: import('./session').Session;
  /** 若提供，则作为本轮 user/message 追加；若省略，则假定 session 里已有待处理输入 */
  input?: string;
  model?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  stream?: boolean;
  toolFilter?: (name: string) => boolean;
  /** 覆盖默认 system prompt 装配；true 时保留 hydrate 进来的 system */
  preserveSystem?: boolean;
  kind?: string;
  source?: string;
  onStepStart?: (step: number) => void;
  onStepEnd?: (step: number, response: LLMResponse) => void;
  onAssistantDelta?: (delta: string) => void;
  onBeforeTool?: (
    name: string,
    args: Record<string, unknown>,
    call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  ) => void | Promise<void>;
  onAfterTool?: (name: string, output: string) => void;
  shouldStop?: () => boolean;
  drainInbox?: () => string[];
  pausePrompt?: string;
}

export interface TurnResult {
  text: string;
  steps: number;
  stopped: TurnStopReason;
}

export interface Plugin {
  name: string;
  apply: (ctx: import('./context').Context) => void | Disposer | Promise<void | Disposer>;
}
