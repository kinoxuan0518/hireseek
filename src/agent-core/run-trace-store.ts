import { db } from '../db';
import type { TraceStep } from '../types';

export function saveRunTrace(
  runId: number,
  jobId: string,
  channel: string,
  trace: TraceStep[],
): void {
  if (!trace.length) return;
  const insert = db.prepare(`
    INSERT INTO run_actions (run_id, job_id, channel, seq, action, target, detail, ok, stage_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction((steps: TraceStep[]) => {
    for (const step of steps) {
      insert.run(
        runId,
        jobId,
        channel,
        step.seq,
        step.action,
        step.target ?? null,
        step.detail ?? null,
        step.ok ? 1 : 0,
        step.stageId ?? null,
      );
    }
  });
  transaction(trace);
}

export function loadRunTrace(runId: number): TraceStep[] {
  return (db.prepare(`
    SELECT seq, action, target, detail, ok, stage_id
    FROM run_actions
    WHERE run_id = ?
    ORDER BY seq
  `).all(runId) as Array<{
    seq: number;
    action: string;
    target: string | null;
    detail: string | null;
    ok: number;
    stage_id: string | null;
  }>).map(row => ({
    seq: row.seq,
    action: row.action,
    target: row.target ?? undefined,
    detail: row.detail ?? undefined,
    ok: !!row.ok,
    stageId: row.stage_id ?? undefined,
  }));
}

export function latestRunWithTrace(): number | null {
  const row = db.prepare(`
    SELECT run_id FROM run_actions ORDER BY id DESC LIMIT 1
  `).get() as { run_id: number } | undefined;
  return row?.run_id ?? null;
}
