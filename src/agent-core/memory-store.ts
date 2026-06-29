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
  inject_allowed: number;
  expires_at: string | null;
  archived_at: string | null;
  content: string;
  created_at: string;
}

export interface EpisodicMemoryRow {
  id: number;
  user_id: string;
  source: string;
  visibility: MemoryVisibility;
  version: number;
  inject_allowed: number;
  expires_at: string | null;
  archived_at: string | null;
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
  inject_allowed: number;
  expires_at: string | null;
  archived_at: string | null;
  updated_at: string;
}

function encodeMeta(meta?: MemoryMetadata): string | null {
  return meta ? JSON.stringify(meta) : null;
}

function normalizeVisibility(visibility?: MemoryVisibility): MemoryVisibility {
  return visibility ?? 'private';
}

function normalizeInjectAllowed(value?: boolean): number {
  return value === false ? 0 : 1;
}

function normalizeOptionalDate(value?: string | null): string | null {
  const text = value?.trim();
  return text || null;
}

function activeClauses(includeInactive?: boolean): string[] {
  if (includeInactive) return [];
  return [
    'archived_at IS NULL',
    "(expires_at IS NULL OR datetime(expires_at) > datetime('now','localtime'))",
  ];
}

function addGovernanceFilters(
  clauses: string[],
  args: unknown[],
  input: { includeInactive?: boolean; injectAllowed?: boolean },
): void {
  clauses.push(...activeClauses(input.includeInactive));
  if (typeof input.injectAllowed === 'boolean') {
    clauses.push('inject_allowed = ?');
    args.push(normalizeInjectAllowed(input.injectAllowed));
  }
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
  injectAllowed?: boolean;
  expiresAt?: string | null;
  metadata?: MemoryMetadata;
}): number {
  const scope = input.scope ?? 'global';
  const visibility = normalizeVisibility(input.visibility);
  const version = input.version ?? 1;
  const injectAllowed = normalizeInjectAllowed(input.injectAllowed);
  const expiresAt = normalizeOptionalDate(input.expiresAt);
  const hash = contentHash(['raw', scope, input.source, visibility, version, input.content]);
  const existing = db.prepare(`
    SELECT id FROM agent_memory_raw WHERE scope = ? AND source = ? AND content_hash = ? LIMIT 1
  `).get(scope, input.source, hash) as { id: number } | undefined;
  if (existing) return existing.id;

  const r = db.prepare(`
    INSERT INTO agent_memory_raw (scope, source, visibility, version, inject_allowed, expires_at, content_hash, content, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(scope, input.source, visibility, version, injectAllowed, expiresAt, hash, input.content, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function listRawMemory(input: {
  scope?: string;
  source?: string;
  visibility?: MemoryVisibility;
  injectAllowed?: boolean;
  includeInactive?: boolean;
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
  addGovernanceFilters(clauses, args, input);
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, scope, source, visibility, version, inject_allowed, expires_at, archived_at, content, created_at
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
  injectAllowed?: boolean;
  expiresAt?: string | null;
  metadata?: MemoryMetadata;
}): number {
  const userId = input.userId ?? 'default';
  const visibility = normalizeVisibility(input.visibility);
  const version = input.version ?? 1;
  const injectAllowed = normalizeInjectAllowed(input.injectAllowed);
  const expiresAt = normalizeOptionalDate(input.expiresAt);
  const hash = contentHash(['episodic', userId, input.source, visibility, version, input.summary, input.content]);
  const existing = db.prepare(`
    SELECT id FROM agent_memory_episodic WHERE user_id = ? AND source = ? AND content_hash = ? LIMIT 1
  `).get(userId, input.source, hash) as { id: number } | undefined;
  if (existing) return existing.id;

  const r = db.prepare(`
    INSERT INTO agent_memory_episodic (user_id, source, visibility, version, inject_allowed, expires_at, content_hash, summary, content, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, input.source, visibility, version, injectAllowed, expiresAt, hash, input.summary, input.content, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function upsertSemanticFact(input: {
  key: string;
  value: string;
  source: string;
  visibility?: MemoryVisibility;
  version?: number;
  injectAllowed?: boolean;
  expiresAt?: string | null;
  metadata?: MemoryMetadata;
}): number {
  const version = input.version ?? 1;
  const visibility = normalizeVisibility(input.visibility);
  const injectAllowed = normalizeInjectAllowed(input.injectAllowed);
  const expiresAt = normalizeOptionalDate(input.expiresAt);
  const r = db.prepare(`
    INSERT INTO agent_memory_semantic (fact_key, fact_value, source, visibility, version, inject_allowed, expires_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fact_key, source, version) DO UPDATE SET
      fact_value = excluded.fact_value,
      visibility = excluded.visibility,
      inject_allowed = excluded.inject_allowed,
      expires_at = excluded.expires_at,
      archived_at = NULL,
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now','localtime')
  `).run(input.key, input.value, input.source, visibility, version, injectAllowed, expiresAt, encodeMeta(input.metadata));
  return Number(r.lastInsertRowid);
}

export function searchEpisodicMemory(input: {
  userId?: string;
  source?: string;
  visibility?: MemoryVisibility;
  query?: string;
  injectAllowed?: boolean;
  includeInactive?: boolean;
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
  addGovernanceFilters(clauses, args, input);
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, user_id, source, visibility, version, inject_allowed, expires_at, archived_at, summary, content, created_at
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
  injectAllowed?: boolean;
  includeInactive?: boolean;
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
  addGovernanceFilters(clauses, args, input);
  args.push(input.limit ?? 20);
  return db.prepare(`
    SELECT id, fact_key, fact_value, source, visibility, version, inject_allowed, expires_at, archived_at, updated_at
    FROM agent_memory_semantic
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...args) as SemanticFactRow[];
}

export type MemoryKind = 'raw' | 'episodic' | 'semantic';

export function archiveMemory(kind: MemoryKind, id: number): boolean {
  const table = kind === 'raw'
    ? 'agent_memory_raw'
    : kind === 'episodic'
      ? 'agent_memory_episodic'
      : 'agent_memory_semantic';
  const result = db.prepare(`
    UPDATE ${table}
    SET archived_at = datetime('now','localtime')
    WHERE id = ?
  `).run(id);
  return result.changes > 0;
}
