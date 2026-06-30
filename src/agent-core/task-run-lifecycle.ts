import dayjs from 'dayjs';
import { db } from '../db';

export interface StaleTaskRun {
  id: number;
  jobId: string;
  channel: string;
  mode: string;
  startedAt: string;
  ageMinutes: number;
  toolCalls: number;
  runActions: number;
  error: string | null;
}

export interface ReconcileTaskRunResult {
  staleRuns: StaleTaskRun[];
  applied: boolean;
  updated: number;
  runStatesUpdated: number;
}

export interface InconsistentRunState {
  runId: number;
  runStateStatus: string;
  runStatePhase: string;
  taskStatus: string | null;
  channel: string | null;
  mode: string | null;
  updatedAt: string;
}

export interface StaleExecutionEnvironment {
  id: string;
  kind: string;
  status: string;
  active: boolean;
  runId: number | null;
  taskStatus: string | null;
  controller: string;
  mode: string;
  updatedAt: string;
}

function parseStartedAt(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function listStaleTaskRuns(maxAgeMinutes = 360, limit = 20): StaleTaskRun[] {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT
      tr.id,
      tr.job_id AS jobId,
      tr.channel,
      tr.mode,
      tr.started_at AS startedAt,
      tr.error,
      (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = tr.id) AS toolCalls,
      (SELECT COUNT(*) FROM run_actions WHERE run_id = tr.id) AS runActions
    FROM task_runs tr
    WHERE tr.status = 'running'
    ORDER BY tr.started_at ASC
    LIMIT ?
  `).all(Math.max(limit * 3, limit)) as Array<{
    id: number;
    jobId: string;
    channel: string;
    mode: string;
    startedAt: string;
    error: string | null;
    toolCalls: number;
    runActions: number;
  }>;

  return rows
    .map(row => {
      const ageMinutes = Math.max(0, Math.floor((now - parseStartedAt(row.startedAt)) / 60000));
      return { ...row, ageMinutes };
    })
    .filter(row => row.ageMinutes >= maxAgeMinutes)
    .slice(0, limit);
}

export function reconcileStaleTaskRuns(input: {
  maxAgeMinutes?: number;
  apply?: boolean;
  nowIso?: string;
  limit?: number;
} = {}): ReconcileTaskRunResult {
  const maxAgeMinutes = input.maxAgeMinutes ?? 360;
  const staleRuns = listStaleTaskRuns(maxAgeMinutes, input.limit ?? 20);
  if (!input.apply || staleRuns.length === 0) {
    return { staleRuns, applied: !!input.apply, updated: 0, runStatesUpdated: 0 };
  }

  const nowIso = input.nowIso ?? dayjs().toISOString();
  const updateTaskRun = db.prepare(`
    UPDATE task_runs
    SET status = 'abandoned',
        finished_at = ?,
        error = ?
    WHERE id = ? AND status = 'running'
  `);
  const updateRunState = db.prepare(`
    UPDATE agent_run_states
    SET status = 'abandoned',
        phase = 'task_run_abandoned',
        reason = ?,
        updated_at = datetime('now','localtime')
    WHERE run_id = ? AND status = 'running'
  `);
  const tx = db.transaction((runs: StaleTaskRun[]) => {
    let updated = 0;
    let runStatesUpdated = 0;
    for (const run of runs) {
      const reason = [
        `abandoned_after_${run.ageMinutes}m_without_active_process`,
        `mode=${run.mode}`,
        `toolCalls=${run.toolCalls}`,
        `runActions=${run.runActions}`,
      ].join('; ');
      updated += updateTaskRun.run(nowIso, reason, run.id).changes;
      runStatesUpdated += updateRunState.run(reason, run.id).changes;
    }
    return { updated, runStatesUpdated };
  });

  const result = tx(staleRuns);
  return { staleRuns, applied: true, updated: result.updated, runStatesUpdated: result.runStatesUpdated };
}

export function listInconsistentRunStates(limit = 20): InconsistentRunState[] {
  return db.prepare(`
    SELECT
      ars.run_id AS runId,
      ars.status AS runStateStatus,
      ars.phase AS runStatePhase,
      tr.status AS taskStatus,
      tr.channel,
      tr.mode,
      ars.updated_at AS updatedAt
    FROM agent_run_states ars
    LEFT JOIN task_runs tr ON tr.id = ars.run_id
    WHERE ars.status = 'running'
      AND COALESCE(tr.status, 'missing') != 'running'
    ORDER BY ars.updated_at DESC, ars.run_id DESC
    LIMIT ?
  `).all(limit) as InconsistentRunState[];
}

export function reconcileInconsistentRunStates(input: { apply?: boolean } = {}): {
  inconsistent: InconsistentRunState[];
  applied: boolean;
  updated: number;
} {
  const inconsistent = listInconsistentRunStates(50);
  if (!input.apply || inconsistent.length === 0) {
    return { inconsistent, applied: !!input.apply, updated: 0 };
  }
  const stmt = db.prepare(`
    UPDATE agent_run_states
    SET status = CASE
          WHEN ? = 'abandoned' THEN 'abandoned'
          WHEN ? = 'completed' THEN 'completed'
          ELSE 'failed'
        END,
        phase = 'task_run_reconciled',
        reason = ?,
        updated_at = datetime('now','localtime')
    WHERE run_id = ? AND status = 'running'
  `);
  const tx = db.transaction((rows: InconsistentRunState[]) => {
    let updated = 0;
    for (const row of rows) {
      const taskStatus = row.taskStatus ?? 'missing';
      const reason = `run_state_reconciled_with_task_status=${taskStatus}`;
      updated += stmt.run(taskStatus, taskStatus, reason, row.runId).changes;
    }
    return updated;
  });
  return { inconsistent, applied: true, updated: tx(inconsistent) };
}

export function listStaleExecutionEnvironments(limit = 20): StaleExecutionEnvironment[] {
  const rows = db.prepare(`
    SELECT
      env.id,
      env.kind,
      env.status,
      env.active,
      env.run_id AS runId,
      tr.status AS taskStatus,
      env.controller,
      env.mode,
      env.updated_at AS updatedAt
    FROM agent_execution_environments env
    LEFT JOIN task_runs tr ON tr.id = env.run_id
    WHERE env.active = 1
      AND env.run_id IS NOT NULL
      AND COALESCE(tr.status, 'missing') != 'running'
    ORDER BY env.updated_at DESC, env.id ASC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    kind: string;
    status: string;
    active: number;
    runId: number | null;
    taskStatus: string | null;
    controller: string;
    mode: string;
    updatedAt: string;
  }>;
  return rows.map(row => ({ ...row, active: !!row.active }));
}

export function reconcileStaleExecutionEnvironments(input: { apply?: boolean } = {}): {
  stale: StaleExecutionEnvironment[];
  applied: boolean;
  updated: number;
} {
  const stale = listStaleExecutionEnvironments(50);
  if (!input.apply || stale.length === 0) {
    return { stale, applied: !!input.apply, updated: 0 };
  }
  const stmt = db.prepare(`
    UPDATE agent_execution_environments
    SET active = 0,
        status = 'released',
        reason = ?,
        updated_at = datetime('now','localtime')
    WHERE id = ? AND active = 1
  `);
  const tx = db.transaction((rows: StaleExecutionEnvironment[]) => {
    let updated = 0;
    for (const row of rows) {
      updated += stmt.run(`environment_released_after_task_status=${row.taskStatus ?? 'missing'}`, row.id).changes;
    }
    return updated;
  });
  return { stale, applied: true, updated: tx(stale) };
}

export function formatStaleTaskRuns(result: ReconcileTaskRunResult): string {
  if (result.staleRuns.length === 0) {
    return '没有发现超时 running run。';
  }
  const header = result.applied
    ? `已收口 ${result.updated}/${result.staleRuns.length} 个超时 running run，run state 同步 ${result.runStatesUpdated} 个：`
    : `发现 ${result.staleRuns.length} 个超时 running run（预览，不修改）：`;
  return [
    header,
    ...result.staleRuns.map(run => (
      `- #${run.id} ${run.channel}/${run.mode} ${run.ageMinutes}m job=${run.jobId} toolCalls=${run.toolCalls} runActions=${run.runActions}`
    )),
  ].join('\n');
}

export function formatInconsistentRunStates(result: {
  inconsistent: InconsistentRunState[];
  applied: boolean;
  updated: number;
}): string {
  if (result.inconsistent.length === 0) {
    return '没有发现 run state 与 task run 状态不一致。';
  }
  const header = result.applied
    ? `已修正 ${result.updated}/${result.inconsistent.length} 个 run state 状态不一致：`
    : `发现 ${result.inconsistent.length} 个 run state 状态不一致（预览，不修改）：`;
  return [
    header,
    ...result.inconsistent.map(row => (
      `- #${row.runId} run_state=${row.runStateStatus}/${row.runStatePhase} task=${row.taskStatus ?? 'missing'} ${row.channel ?? 'unknown'}/${row.mode ?? 'unknown'}`
    )),
  ].join('\n');
}

export function formatStaleExecutionEnvironments(result: {
  stale: StaleExecutionEnvironment[];
  applied: boolean;
  updated: number;
}): string {
  if (result.stale.length === 0) {
    return '没有发现已关闭 run 仍占用的执行环境。';
  }
  const header = result.applied
    ? `已释放 ${result.updated}/${result.stale.length} 个 stale execution environment：`
    : `发现 ${result.stale.length} 个 stale execution environment（预览，不修改）：`;
  return [
    header,
    ...result.stale.map(env => (
      `- ${env.id} ${env.kind}/${env.status}/${env.controller}/${env.mode} active=${env.active ? 'yes' : 'no'} run#${env.runId ?? 'none'} task=${env.taskStatus ?? 'missing'}`
    )),
  ].join('\n');
}
