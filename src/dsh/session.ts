/**
 * 追加写入的 Session Log。deriveMessages() 从日志投影出模型历史。
 * 原则：模型看见的必须能从日志重建。
 */

import { repairToolMessageHistory } from '../message-integrity';
import type { Context } from './context';
import { newId } from './context';
import type { ChatMessage, SessionEvent, SessionEventType } from './types';

export interface CreateSessionInput {
  id?: string;
  title?: string;
  source?: string;
}

export class Session {
  readonly id: string;
  title: string;
  source: string;
  readonly createdAt: string;
  private readonly ctx: Context;
  private readonly events: SessionEvent[] = [];

  constructor(ctx: Context, input: CreateSessionInput = {}) {
    this.ctx = ctx;
    this.id = input.id ?? newId('session');
    this.title = input.title ?? `Agent 会话-${new Date().toLocaleString('zh-CN')}`;
    this.source = input.source ?? 'dsh';
    this.createdAt = new Date().toISOString();
  }

  get length(): number {
    return this.events.length;
  }

  list(): SessionEvent[] {
    return this.events.slice();
  }

  append(type: SessionEventType, payload: Record<string, unknown> = {}, opts: { silent?: boolean } = {}): SessionEvent {
    const event: SessionEvent = {
      id: newId('evt'),
      sessionId: this.id,
      seq: this.events.length + 1,
      type,
      at: new Date().toISOString(),
      payload,
    };
    this.events.push(event);
    if (!opts.silent) this.ctx.emit('session/event', { session: this, event });
    return event;
  }

  hydrate(messages: ChatMessage[]): void {
    this.events.length = 0;
    for (const msg of messages) {
      if (msg.role === 'system') {
        this.append('system/set', { content: messageContent(msg) }, { silent: true });
      } else if (msg.role === 'user') {
        this.append('user/message', { content: messageContent(msg) }, { silent: true });
      } else if (msg.role === 'assistant') {
        const reasoning = assistantReasoning(msg);
        this.append('assistant/message', {
          content: messageContent(msg),
          tool_calls: (msg as any).tool_calls ?? null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        }, { silent: true });
      } else if (msg.role === 'tool') {
        this.append('tool/result', {
          content: messageContent(msg),
          tool_call_id: (msg as any).tool_call_id,
          name: (msg as any).name ?? null,
        }, { silent: true });
      }
    }
  }

  ensureSystem(content: string): void {
    const existing = this.events.find(event => event.type === 'system/set');
    if (!existing) {
      this.events.unshift({
        id: newId('evt'),
        sessionId: this.id,
        seq: 0,
        type: 'system/set',
        at: new Date().toISOString(),
        payload: { content },
      });
      this.resequence();
      this.ctx.emit('session/event', { session: this, event: this.events[0] });
      return;
    }
    if (existing.payload.content !== content) {
      existing.payload.content = content;
      this.ctx.emit('session/event', { session: this, event: existing });
    }
  }

  deriveMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const event of this.events) {
      switch (event.type) {
        case 'system/set':
          replaceOrUnshiftSystem(messages, String(event.payload.content ?? ''));
          break;
        case 'user/message':
        case 'inject/context':
          messages.push({ role: 'user', content: String(event.payload.content ?? '') });
          break;
        case 'assistant/message': {
          const toolCalls = event.payload.tool_calls as ChatMessage extends never ? never : any;
          const msg: OpenAIAssistant = {
            role: 'assistant',
            content: event.payload.content == null ? null : String(event.payload.content),
          };
          if (Array.isArray(toolCalls) && toolCalls.length > 0) msg.tool_calls = toolCalls;
          const reasoning = event.payload.reasoning_content;
          if (typeof reasoning === 'string' && reasoning) msg.reasoning_content = reasoning;
          messages.push(msg as ChatMessage);
          break;
        }
        case 'tool/result':
          messages.push({
            role: 'tool',
            tool_call_id: String(event.payload.tool_call_id ?? ''),
            content: String(event.payload.content ?? ''),
          });
          break;
        default:
          break;
      }
    }
    return repairToolMessageHistory(messages).messages;
  }

  private resequence(): void {
    this.events.forEach((event, index) => {
      event.seq = index + 1;
    });
  }
}

type OpenAIAssistant = {
  role: 'assistant';
  content: string | null;
  tool_calls?: any;
  reasoning_content?: string;
};

function assistantReasoning(msg: ChatMessage): string | undefined {
  const rec = msg as { reasoning_content?: unknown; reasoning?: unknown };
  if (typeof rec.reasoning_content === 'string' && rec.reasoning_content) return rec.reasoning_content;
  if (typeof rec.reasoning === 'string' && rec.reasoning) return rec.reasoning;
  return undefined;
}

function messageContent(msg: ChatMessage): string {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  return JSON.stringify(content);
}

function replaceOrUnshiftSystem(messages: ChatMessage[], content: string): void {
  const index = messages.findIndex(msg => msg.role === 'system');
  const system = { role: 'system' as const, content };
  if (index >= 0) messages[index] = system;
  else messages.unshift(system);
}

export class SessionService {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ctx: Context) {}

  create(input: CreateSessionInput = {}): Session {
    const session = new Session(this.ctx, input);
    this.sessions.set(session.id, session);
    this.ctx.effect(() => () => this.sessions.delete(session.id));
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }
}

export function sessionPlugin(ctx: Context): void {
  ctx.provide('sessions', new SessionService(ctx));
}
