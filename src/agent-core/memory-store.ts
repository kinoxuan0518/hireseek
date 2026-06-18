import crypto from 'crypto';
import { db } from '../db';
import './store';

export interface MemoryMetadata {
  [key: string]: unknown;
}

export type MemoryVisibility = 'private' | 'public';

export interface RawMemoryRow {
  id: number;
  scope: string;
  source: string;
  visibility: MemoryVisibility;
  version: number;
  content: string;
  created_at: string;
}

export interface EpisodicMemoryRow {
  id: number;
  user_id: string;
  source: string;
  visibility: MemoryVisibility;
  version: number;
  summary: string;
  content: string;
  created_at: string;
}

export interface SemanticFactRow {
  id: number;
  fact_key: string;
  fact_value: string;
  source: string;
  visibility: MemoryVisibility;
  version: number;
  updated_at: string;
}

function encodeMeta(meta?: MemoryMetadata): string | null {
  return meta ? JSON.stringify(meta) : null;
}

function normalizeVisibility(visibility?: MemoryVisibility): MemoryVisibility {
  return visibility ?? 'private';
}

function contentHash(parts: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function writeRawMemory(input: {
  scope?: string;
  source: string;
  content: string;
  visibility?: MemoryVisibility;
  version?: number;
  metadata?: MemoryMetadata;
}): number {
  const scope = input.scope ?? 'global';
  const visibility = normalizeVisibility(input.visibility);
  const version = input.version ?? 1;
  const hash = contentHash(['raw', scope, input.source, visibility, version, input.content]);
  const existing = db.prepare(`
    SELECT id FROM agent_memory_raw WHERE scope = ? AND source = ? AND content_hash = ? LIMIT 1
  `).get(scope, input.source, hash) as { id: number } | undefined;
  if (existing) return existing.id;

  const r = db.prepare(`
    INSERT INTO agent_memory_raw (scope, source, visibility, version, content_hash, content, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(scope, input.source, visibility, version, hash, input.content, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function listRawMemory(input: {
  scope?: string;
  source?: string;
  visibility?: MemoryVisibility;
  limit?: number;
}): RawMemoryRow[] {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (input.scope) {
    clauses.push('scope = ?');
    args.push(input.scope);
  }
  if (input.source) {
    clauses.push('source = ?');
    args.push(input.source);
  }
  if (input.visibility) {
    clauses.push('visibility = ?');
    args.push(input.visibility);
  }
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, scope, source, visibility, version, content, created_at
    FROM agent_memory_raw
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args) as RawMemoryRow[];
}

export function writeEpisodicMemory(input: {
  userId?: string;
  source: string;
  summary: string;
  content: string;
  visibility?: MemoryVisibility;
  version?: number;
  metadata?: MemoryMetadata;
}): number {
  const userId = input.userId ?? 'default';
  const visibility = normalizeVisibility(input.visibility);
  const version = input.version ?? 1;
  const hash = contentHash(['episodic', userId, input.source, visibility, version, input.summary, input.content]);
  const existing = db.prepare(`
    SELECT id FROM agent_memory_episodic WHERE user_id = ? AND source = ? AND content_hash = ? LIMIT 1
  `).get(userId, input.source, hash) as { id: number } | undefined;
  if (existing) return existing.id;

  const r = db.prepare(`
    INSERT INTO agent_memory_episodic (user_id, source, visibility, version, content_hash, summary, content, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, input.source, visibility, version, hash, input.summary, input.content, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function upsertSemanticFact(input: {
  key: string;
  value: string;
  source: string;
  visibility?: MemoryVisibility;
  version?: number;
  metadata?: MemoryMetadata;
}): number {
  const version = input.version ?? 1;
  const visibility = normalizeVisibility(input.visibility);
  const r = db.prepare(`
    INSERT INTO agent_memory_semantic (fact_key, fact_value, source, visibility, version, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(fact_key, source, version) DO UPDATE SET
      fact_value = excluded.fact_value,
      visibility = excluded.visibility,
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now','localtime')
  `).run(input.key, input.value, input.source, visibility, version, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function searchEpisodicMemory(input: {
  userId?: string;
  source?: string;
  visibility?: MemoryVisibility;
  query?: string;
  limit?: number;
}): EpisodicMemoryRow[] {
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
  if (input.visibility) {
    clauses.push('visibility = ?');
    args.push(input.visibility);
  }
  if (input.query) {
    clauses.push('(summary LIKE ? OR content LIKE ?)');
    args.push(`%${input.query}%`, `%${input.query}%`);
  }
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, user_id, source, visibility, version, summary, content, created_at
    FROM agent_memory_episodic
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args) as EpisodicMemoryRow[];
}

export function getSemanticFacts(input: {
  key?: string;
  source?: string;
  visibility?: MemoryVisibility;
  limit?: number;
}): SemanticFactRow[] {
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
  if (input.visibility) {
    clauses.push('visibility = ?');
    args.push(input.visibility);
  }
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, fact_key, fact_value, source, visibility, version, updated_at
    FROM agent_memory_semantic
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...args) as SemanticFactRow[];
}
