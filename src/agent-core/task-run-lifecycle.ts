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
    return { staleRuns, applied: !!input.apply, updated: 0 };
  }

  const nowIso = input.nowIso ?? dayjs().toISOString();
  const update = db.prepare(`
    UPDATE task_runs
    SET status = 'abandoned',
        finished_at = ?,
        error = ?
    WHERE id = ? AND status = 'running'
  `);
  const tx = db.transaction((runs: StaleTaskRun[]) => {
    let updated = 0;
    for (const run of runs) {
      const reason = [
        `abandoned_after_${run.ageMinutes}m_without_active_process`,
        `mode=${run.mode}`,
        `toolCalls=${run.toolCalls}`,
        `runActions=${run.runActions}`,
      ].join('; ');
      updated += update.run(nowIso, reason, run.id).changes;
    }
    return updated;
  });

  return { staleRuns, applied: true, updated: tx(staleRuns) };
}

export function formatStaleTaskRuns(result: ReconcileTaskRunResult): string {
  if (result.staleRuns.length === 0) {
    return '没有发现超时 running run。';
  }
  const header = result.applied
    ? `已收口 ${result.updated}/${result.staleRuns.length} 个超时 running run：`
    : `发现 ${result.staleRuns.length} 个超时 running run（预览，不修改）：`;
  return [
    header,
    ...result.staleRuns.map(run => (
      `- #${run.id} ${run.channel}/${run.mode} ${run.ageMinutes}m job=${run.jobId} toolCalls=${run.toolCalls} runActions=${run.runActions}`
    )),
  ].join('\n');
}
