import { db } from '../db';
import './store';

export type AgentRunStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface AgentRunState {
  runId: number;
  sessionId?: string | null;
  status: AgentRunStatus;
  phase: string;
  stageId?: string | null;
  lastAction?: string | null;
  lastUrl?: string | null;
  reason?: string | null;
  snapshotSummary?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpsertAgentRunStateInput {
  runId: number;
  sessionId?: string | null;
  status: AgentRunStatus;
  phase: string;
  stageId?: string | null;
  lastAction?: string | null;
  lastUrl?: string | null;
  reason?: string | null;
  snapshotSummary?: string | null;
}

function truncate(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

export function upsertAgentRunState(input: UpsertAgentRunStateInput): void {
  db.prepare(`
    INSERT INTO agent_run_states
      (run_id, session_id, status, phase, stage_id, last_action, last_url, reason, snapshot_summary, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(run_id) DO UPDATE SET
      session_id = COALESCE(excluded.session_id, agent_run_states.session_id),
      status = excluded.status,
      phase = excluded.phase,
      stage_id = excluded.stage_id,
      last_action = excluded.last_action,
      last_url = excluded.last_url,
      reason = excluded.reason,
      snapshot_summary = excluded.snapshot_summary,
      updated_at = datetime('now','localtime')
  `).run(
    input.runId,
    input.sessionId ?? null,
    input.status,
    truncate(input.phase, 80) ?? 'unknown',
    truncate(input.stageId, 80),
    truncate(input.lastAction, 80),
    truncate(input.lastUrl, 500),
    truncate(input.reason, 700),
    truncate(input.snapshotSummary, 1200),
  );
}

export function loadAgentRunState(runId: number): AgentRunState | null {
  const row = db.prepare(`
    SELECT run_id, session_id, status, phase, stage_id, last_action, last_url,
           reason, snapshot_summary, created_at, updated_at
    FROM agent_run_states
    WHERE run_id = ?
  `).get(runId) as {
    run_id: number;
    session_id: string | null;
    status: AgentRunStatus;
    phase: string;
    stage_id: string | null;
    last_action: string | null;
    last_url: string | null;
    reason: string | null;
    snapshot_summary: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) return null;
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    status: row.status,
    phase: row.phase,
    stageId: row.stage_id,
    lastAction: row.last_action,
    lastUrl: row.last_url,
    reason: row.reason,
    snapshotSummary: row.snapshot_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToState(row: {
  run_id: number;
  session_id: string | null;
  status: AgentRunStatus;
  phase: string;
  stage_id: string | null;
  last_action: string | null;
  last_url: string | null;
  reason: string | null;
  snapshot_summary: string | null;
  created_at: string;
  updated_at: string;
}): AgentRunState {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    status: row.status,
    phase: row.phase,
    stageId: row.stage_id,
    lastAction: row.last_action,
    lastUrl: row.last_url,
    reason: row.reason,
    snapshotSummary: row.snapshot_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAgentRunStates(limit = 8): AgentRunState[] {
  const rows = db.prepare(`
    SELECT run_id, session_id, status, phase, stage_id, last_action, last_url,
           reason, snapshot_summary, created_at, updated_at
    FROM agent_run_states
    ORDER BY updated_at DESC, run_id DESC
    LIMIT ?
  `).all(limit) as Parameters<typeof rowToState>[0][];
  return rows.map(rowToState);
}

export function latestPausedRunState(input: {
  jobId?: string;
  channel?: string;
  maxAgeHours?: number;
} = {}): AgentRunState | null {
  const maxAgeHours = input.maxAgeHours ?? 24;
  const filters = [
    `ars.status = 'paused'`,
    `ars.updated_at >= datetime('now', ?)`,
  ];
  const args: unknown[] = [`-${maxAgeHours} hours`];
  if (input.jobId) {
    filters.push(`tr.job_id = ?`);
    args.push(input.jobId);
  }
  if (input.channel) {
    filters.push(`tr.channel = ?`);
    args.push(input.channel);
  }
  const row = db.prepare(`
    SELECT ars.run_id, ars.session_id, ars.status, ars.phase, ars.stage_id, ars.last_action,
           ars.last_url, ars.reason, ars.snapshot_summary, ars.created_at, ars.updated_at
    FROM agent_run_states ars
    LEFT JOIN task_runs tr ON tr.id = ars.run_id
    WHERE ${filters.join(' AND ')}
    ORDER BY ars.updated_at DESC, ars.run_id DESC
    LIMIT 1
  `).get(...args) as Parameters<typeof rowToState>[0] | undefined;
  return row ? rowToState(row) : null;
}

export function formatRunStateForContext(state: AgentRunState): string {
  return [
    `runId: ${state.runId}`,
    `status: ${state.status}`,
    `phase: ${state.phase}`,
    state.stageId ? `stage: ${state.stageId}` : '',
    state.lastAction ? `lastAction: ${state.lastAction}` : '',
    state.lastUrl ? `lastUrl: ${state.lastUrl}` : '',
    state.reason ? `reason: ${state.reason}` : '',
    state.snapshotSummary ? `snapshot:\n${state.snapshotSummary}` : '',
  ].filter(Boolean).join('\n');
}
