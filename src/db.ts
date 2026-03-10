import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import type { Candidate, TaskRun } from './types';

// 确保目录存在
const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.db.path);

// WAL 模式，提升并发读写性能
db.pragma('journal_mode = WAL');

// 初始化 Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    school      TEXT,
    company     TEXT,
    channel     TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'contacted',
    score       INTEGER,
    contacted_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          TEXT NOT NULL,
    channel         TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running',
    contacted_count INTEGER NOT NULL DEFAULT 0,
    skipped_count   INTEGER NOT NULL DEFAULT 0,
    error           TEXT
  );

  CREATE TABLE IF NOT EXISTS interaction_log (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_fingerprint TEXT NOT NULL,
    action               TEXT NOT NULL,
    note                 TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reflections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL,
    channel    TEXT NOT NULL,
    run_id     INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL,
    summary    TEXT NOT NULL,
    highlights TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_candidates_channel  ON candidates(channel);
  CREATE INDEX IF NOT EXISTS idx_candidates_job_id   ON candidates(job_id);
  CREATE INDEX IF NOT EXISTS idx_candidates_status   ON candidates(status);
  CREATE INDEX IF NOT EXISTS idx_task_runs_channel   ON task_runs(channel);
  CREATE INDEX IF NOT EXISTS idx_reflections_channel ON reflections(channel);
`);

// ── 候选人操作 ────────────────────────────────────────────
export const candidateOps = {
  upsert: db.prepare<Omit<Candidate, 'id'>>(`
    INSERT INTO candidates (fingerprint, name, school, company, channel, job_id, status, score, contacted_at)
    VALUES (@fingerprint, @name, @school, @company, @channel, @job_id, @status, @score, @contacted_at)
    ON CONFLICT(fingerprint) DO UPDATE SET
      status       = excluded.status,
      score        = COALESCE(excluded.score, score),
      contacted_at = COALESCE(excluded.contacted_at, contacted_at)
  `),

  findByFingerprint: db.prepare<[string]>(`
    SELECT * FROM candidates WHERE fingerprint = ?
  `),

  findByName: db.prepare<[string]>(`
    SELECT * FROM candidates WHERE name LIKE ? ORDER BY contacted_at DESC LIMIT 10
  `),

  updateStatus: db.prepare<{ status: string; id: number }>(`
    UPDATE candidates SET status = @status WHERE id = @id
  `),

  listByStatus: db.prepare<[string]>(`
    SELECT * FROM candidates WHERE status = ? ORDER BY created_at DESC LIMIT 50
  `),

  todayStats: db.prepare(`
    SELECT channel, COUNT(*) as count
    FROM candidates
    WHERE date(contacted_at) = date('now')
    GROUP BY channel
  `),

  funnelStats: db.prepare<[string]>(`
    SELECT
      status,
      COUNT(*) as count
    FROM candidates
    WHERE job_id = ?
    GROUP BY status
    ORDER BY count DESC
  `),
};

// ── 任务记录操作 ──────────────────────────────────────────
export const taskRunOps = {
  start: db.prepare<Pick<TaskRun, 'job_id' | 'channel' | 'started_at'>>(`
    INSERT INTO task_runs (job_id, channel, started_at)
    VALUES (@job_id, @channel, @started_at)
  `),

  complete: db.prepare<{
    id: number;
    finished_at: string;
    status: string;
    contacted_count: number;
    skipped_count: number;
    error: string | null;
  }>(`
    UPDATE task_runs
    SET finished_at     = @finished_at,
        status          = @status,
        contacted_count = @contacted_count,
        skipped_count   = @skipped_count,
        error           = @error
    WHERE id = @id
  `),

  lastRun: db.prepare<[string]>(`
    SELECT * FROM task_runs
    WHERE channel = ?
    ORDER BY started_at DESC
    LIMIT 1
  `),
};

export const conversationOps = {
  save: db.prepare<{ job_id: string; summary: string; highlights: string }>(`
    INSERT INTO conversations (job_id, summary, highlights)
    VALUES (@job_id, @summary, @highlights)
  `),

  recent: db.prepare<[string]>(`
    SELECT summary, highlights, created_at FROM conversations
    WHERE job_id = ?
    ORDER BY created_at DESC LIMIT 5
  `),
};

export const reflectionOps = {
  save: db.prepare<{ job_id: string; channel: string; run_id: number; content: string }>(`
    INSERT INTO reflections (job_id, channel, run_id, content)
    VALUES (@job_id, @channel, @run_id, @content)
  `),

  recent: db.prepare<[string, string]>(`
    SELECT content, created_at FROM reflections
    WHERE channel = ? AND job_id = ?
    ORDER BY created_at DESC LIMIT 5
  `),
};
