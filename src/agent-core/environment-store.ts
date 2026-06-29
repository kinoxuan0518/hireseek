import { db } from '../db';
import './store';
import type { ToolExecutionMode } from './tool-registry';

export type ExecutionEnvironmentKind = 'browser' | 'shell' | 'filesystem' | 'mcp' | 'database' | 'other';
export type ExecutionEnvironmentController = 'hireseek' | 'user' | 'external' | 'unknown';
export type ExecutionEnvironmentStatus = 'available' | 'claimed' | 'observing' | 'blocked' | 'released' | 'error';

export interface ExecutionEnvironmentState {
  id: string;
  kind: ExecutionEnvironmentKind;
  label?: string | null;
  controller: ExecutionEnvironmentController;
  status: ExecutionEnvironmentStatus;
  mode: ToolExecutionMode;
  runId?: number | null;
  sessionId?: string | null;
  url?: string | null;
  title?: string | null;
  active?: boolean | null;
  reason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpsertExecutionEnvironmentInput {
  id: string;
  kind: ExecutionEnvironmentKind;
  label?: string | null;
  controller?: ExecutionEnvironmentController;
  status: ExecutionEnvironmentStatus;
  mode?: ToolExecutionMode;
  runId?: number | null;
  sessionId?: string | null;
  url?: string | null;
  title?: string | null;
  active?: boolean | null;
  reason?: string | null;
}

function truncate(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

function rowToEnvironment(row: {
  id: string;
  kind: ExecutionEnvironmentKind;
  label: string | null;
  controller: ExecutionEnvironmentController;
  status: ExecutionEnvironmentStatus;
  mode: ToolExecutionMode;
  run_id: number | null;
  session_id: string | null;
  url: string | null;
  title: string | null;
  active: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}): ExecutionEnvironmentState {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    controller: row.controller,
    status: row.status,
    mode: row.mode,
    runId: row.run_id,
    sessionId: row.session_id,
    url: row.url,
    title: row.title,
    active: row.active == null ? null : !!row.active,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertExecutionEnvironment(input: UpsertExecutionEnvironmentInput): void {
  db.prepare(`
    INSERT INTO agent_execution_environments
      (id, kind, label, controller, status, mode, run_id, session_id, url, title, active, reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      label = COALESCE(excluded.label, agent_execution_environments.label),
      controller = excluded.controller,
      status = excluded.status,
      mode = excluded.mode,
      run_id = COALESCE(excluded.run_id, agent_execution_environments.run_id),
      session_id = COALESCE(excluded.session_id, agent_execution_environments.session_id),
      url = COALESCE(excluded.url, agent_execution_environments.url),
      title = COALESCE(excluded.title, agent_execution_environments.title),
      active = COALESCE(excluded.active, agent_execution_environments.active),
      reason = excluded.reason,
      updated_at = datetime('now','localtime')
  `).run(
    truncate(input.id, 120) ?? 'unknown',
    input.kind,
    truncate(input.label, 120),
    input.controller ?? 'unknown',
    input.status,
    input.mode ?? 'read',
    input.runId ?? null,
    input.sessionId ?? null,
    truncate(input.url, 700),
    truncate(input.title, 200),
    input.active == null ? null : input.active ? 1 : 0,
    truncate(input.reason, 700),
  );
}

export function loadExecutionEnvironment(id: string): ExecutionEnvironmentState | null {
  const row = db.prepare(`
    SELECT id, kind, label, controller, status, mode, run_id, session_id, url, title, active, reason, created_at, updated_at
    FROM agent_execution_environments
    WHERE id = ?
  `).get(id) as Parameters<typeof rowToEnvironment>[0] | undefined;
  return row ? rowToEnvironment(row) : null;
}

export function listExecutionEnvironments(limit = 8): ExecutionEnvironmentState[] {
  const rows = db.prepare(`
    SELECT id, kind, label, controller, status, mode, run_id, session_id, url, title, active, reason, created_at, updated_at
    FROM agent_execution_environments
    ORDER BY updated_at DESC, id ASC
    LIMIT ?
  `).all(limit) as Parameters<typeof rowToEnvironment>[0][];
  return rows.map(rowToEnvironment);
}

export function formatExecutionEnvironmentLine(env: ExecutionEnvironmentState): string {
  const run = env.runId == null ? '' : ` run#${env.runId}`;
  const session = env.sessionId ? ` session=${env.sessionId}` : '';
  const active = env.active == null ? '' : ` active=${env.active ? 'yes' : 'no'}`;
  const url = env.url ? ` url=${env.url.slice(0, 90)}` : '';
  const reason = env.reason ? ` — ${env.reason.slice(0, 100)}` : '';
  const label = env.label ? ` ${env.label}` : '';
  return `- ${env.updatedAt ?? ''} ${env.id}${label} [${env.kind}/${env.status}/${env.controller}/${env.mode}${active}]${run}${session}${url}${reason}`;
}
