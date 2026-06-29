import { db } from '../db';
import './store';

export interface ContextCompactionRecordInput {
  sessionId?: string | null;
  source?: string;
  originalTokens: number;
  compressedTokens: number;
  originalMessages: number;
  compressedMessages: number;
  reductionPercent: number;
  summary: string;
}

export interface ContextCompactionRecord {
  id: number;
  sessionId: string | null;
  source: string;
  originalTokens: number;
  compressedTokens: number;
  originalMessages: number;
  compressedMessages: number;
  reductionPercent: number;
  summary: string | null;
  createdAt: string;
}

function rowToRecord(row: {
  id: number;
  session_id: string | null;
  source: string;
  original_tokens: number;
  compressed_tokens: number;
  original_messages: number;
  compressed_messages: number;
  reduction_percent: number;
  summary: string | null;
  created_at: string;
}): ContextCompactionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    originalTokens: row.original_tokens,
    compressedTokens: row.compressed_tokens,
    originalMessages: row.original_messages,
    compressedMessages: row.compressed_messages,
    reductionPercent: row.reduction_percent,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export function recordContextCompaction(input: ContextCompactionRecordInput): number {
  const result = db.prepare(`
    INSERT INTO agent_context_compactions
      (session_id, source, original_tokens, compressed_tokens, original_messages, compressed_messages, reduction_percent, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.sessionId ?? null,
    input.source ?? 'chat',
    input.originalTokens,
    input.compressedTokens,
    input.originalMessages,
    input.compressedMessages,
    input.reductionPercent,
    input.summary.slice(0, 2000),
  );
  return Number(result.lastInsertRowid);
}

export function listContextCompactions(limit = 8): ContextCompactionRecord[] {
  const rows = db.prepare(`
    SELECT id, session_id, source, original_tokens, compressed_tokens, original_messages,
           compressed_messages, reduction_percent, summary, created_at
    FROM agent_context_compactions
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as Parameters<typeof rowToRecord>[0][];
  return rows.map(rowToRecord);
}

export function formatContextCompactionLine(record: ContextCompactionRecord): string {
  const session = record.sessionId ? ` session=${record.sessionId}` : '';
  return `- ${record.createdAt} #${record.id}${session} ${record.originalTokens}->${record.compressedTokens} tokens (${record.reductionPercent}% reduction), messages ${record.originalMessages}->${record.compressedMessages}`;
}
