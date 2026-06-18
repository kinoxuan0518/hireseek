import { db } from '../db';
import './store';

export interface MemoryMetadata {
  [key: string]: unknown;
}

function encodeMeta(meta?: MemoryMetadata): string | null {
  return meta ? JSON.stringify(meta) : null;
}

export function writeRawMemory(input: {
  scope?: string;
  source: string;
  content: string;
  metadata?: MemoryMetadata;
}): number {
  const r = db.prepare(`
    INSERT INTO agent_memory_raw (scope, source, content, metadata_json)
    VALUES (?, ?, ?, ?)
  `).run(input.scope ?? 'global', input.source, input.content, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function writeEpisodicMemory(input: {
  userId?: string;
  source: string;
  summary: string;
  content: string;
  metadata?: MemoryMetadata;
}): number {
  const r = db.prepare(`
    INSERT INTO agent_memory_episodic (user_id, source, summary, content, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(input.userId ?? 'default', input.source, input.summary, input.content, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function upsertSemanticFact(input: {
  key: string;
  value: string;
  source: string;
  version?: number;
  metadata?: MemoryMetadata;
}): number {
  const version = input.version ?? 1;
  const r = db.prepare(`
    INSERT INTO agent_memory_semantic (fact_key, fact_value, source, version, metadata_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(fact_key, source, version) DO UPDATE SET
      fact_value = excluded.fact_value,
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now','localtime')
  `).run(input.key, input.value, input.source, version, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function searchEpisodicMemory(input: {
  userId?: string;
  source?: string;
  query?: string;
  limit?: number;
}): Array<{ id: number; user_id: string; source: string; summary: string; content: string; created_at: string }> {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (input.userId) {
    clauses.push('user_id = ?');
    args.push(input.userId);
  }
  if (input.source) {
    clauses.push('source = ?');
    args.push(input.source);
  }
  if (input.query) {
    clauses.push('(summary LIKE ? OR content LIKE ?)');
    args.push(`%${input.query}%`, `%${input.query}%`);
  }
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, user_id, source, summary, content, created_at
    FROM agent_memory_episodic
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args) as Array<{ id: number; user_id: string; source: string; summary: string; content: string; created_at: string }>;
}

export function getSemanticFacts(input: {
  key?: string;
  source?: string;
  limit?: number;
}): Array<{ id: number; fact_key: string; fact_value: string; source: string; version: number; updated_at: string }> {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (input.key) {
    clauses.push('fact_key = ?');
    args.push(input.key);
  }
  if (input.source) {
    clauses.push('source = ?');
    args.push(input.source);
  }
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, fact_key, fact_value, source, version, updated_at
    FROM agent_memory_semantic
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...args) as Array<{ id: number; fact_key: string; fact_value: string; source: string; version: number; updated_at: string }>;
}

