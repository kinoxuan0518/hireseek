import type OpenAI from 'openai';
import { db } from '../db';
import { repairToolMessageHistory } from '../message-integrity';
import './store';

export interface SaveAgentSessionInput {
  sessionId: string;
  title: string;
  source?: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  createdAt?: string;
}

function messageContent(msg: OpenAI.ChatCompletionMessageParam): string {
  const content = (msg as any).content;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  return JSON.stringify(content);
}

function firstToolCallName(msg: OpenAI.ChatCompletionMessageParam): string | null {
  const calls = (msg as any).tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return null;
  return calls[0]?.function?.name ?? null;
}

export function saveAgentSessionMessages(input: SaveAgentSessionInput): void {
  const repaired = repairToolMessageHistory(input.messages).messages;
  const now = new Date().toISOString();
  const createdAt = input.createdAt ?? now;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_sessions (id, title, source, created_at, updated_at, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        source = excluded.source,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count
    `).run(input.sessionId, input.title, input.source ?? 'chat', createdAt, now, repaired.length);

    db.prepare(`DELETE FROM agent_messages WHERE session_id = ?`).run(input.sessionId);
    const insert = db.prepare(`
      INSERT INTO agent_messages
        (session_id, seq, role, content, tool_call_id, tool_call_name, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    repaired.forEach((msg, index) => {
      insert.run(
        input.sessionId,
        index + 1,
        msg.role,
        messageContent(msg).slice(0, 4000),
        (msg as any).tool_call_id ?? null,
        firstToolCallName(msg),
        JSON.stringify(msg),
      );
    });
  });
  tx();
}

export function loadAgentSessionMessages(sessionId: string): OpenAI.ChatCompletionMessageParam[] {
  const rows = db.prepare(`
    SELECT raw_json FROM agent_messages
    WHERE session_id = ?
    ORDER BY seq
  `).all(sessionId) as { raw_json: string }[];
  const messages = rows.map(r => JSON.parse(r.raw_json)) as OpenAI.ChatCompletionMessageParam[];
  return repairToolMessageHistory(messages).messages;
}

