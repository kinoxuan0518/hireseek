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
    excerpt    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    priority    INTEGER NOT NULL DEFAULT 0,
    parent_id   INTEGER,
    job_id      TEXT,
    assigned_to TEXT,
    due_date    TEXT,
    completed_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_candidates_channel  ON candidates(channel);
  CREATE INDEX IF NOT EXISTS idx_candidates_job_id   ON candidates(job_id);
  CREATE INDEX IF NOT EXISTS idx_candidates_status   ON candidates(status);
  CREATE INDEX IF NOT EXISTS idx_task_runs_channel   ON task_runs(channel);
  CREATE INDEX IF NOT EXISTS idx_reflections_channel ON reflections(channel);
  CREATE INDEX IF NOT EXISTS idx_tasks_status        ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_parent        ON tasks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_job_id        ON tasks(job_id);

  -- 人才记忆库：每个候选人的沟通要点 / 印象 / 跟进笔记
  CREATE TABLE IF NOT EXISTS candidate_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    name        TEXT,
    note        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notes_fingerprint ON candidate_notes(fingerprint);
`);

// ── 人才记忆库 FTS5 全文检索（"之前聊过的做供应链的人"）─────────────────
// FTS5 在多数 better-sqlite3 构建中默认可用；万一缺失则降级为 LIKE 检索。
export let ftsEnabled = false;
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS candidate_fts USING fts5(
      fingerprint UNINDEXED,
      name,
      company,
      school,
      notes,
      tokenize = 'unicode61'
    );
  `);
  ftsEnabled = true;
} catch (err) {
  console.error('[db] FTS5 不可用，人才检索降级为 LIKE：', err instanceof Error ? err.message : err);
}

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

// ── 人才记忆库：笔记 + FTS5 检索 ──────────────────────────
const noteStmts = {
  insert: db.prepare<{ fingerprint: string; name: string; note: string }>(`
    INSERT INTO candidate_notes (fingerprint, name, note)
    VALUES (@fingerprint, @name, @note)
  `),
  byFingerprint: db.prepare<[string]>(`
    SELECT note, created_at FROM candidate_notes
    WHERE fingerprint = ? ORDER BY created_at DESC LIMIT 20
  `),
};

const ftsStmts = ftsEnabled
  ? {
      del: db.prepare<[string]>(`DELETE FROM candidate_fts WHERE fingerprint = ?`),
      ins: db.prepare<{ fingerprint: string; name: string; company: string; school: string; notes: string }>(`
        INSERT INTO candidate_fts (fingerprint, name, company, school, notes)
        VALUES (@fingerprint, @name, @company, @school, @notes)
      `),
      candidate: db.prepare<[string]>(`SELECT name, company, school FROM candidates WHERE fingerprint = ?`),
      notes: db.prepare<[string]>(`SELECT note FROM candidate_notes WHERE fingerprint = ?`),
    }
  : null;

/**
 * CJK 字符级分词：unicode61 会把连续中文当成一个 token，导致"供应链"匹配不到
 * "做供应链数字化"（前缀只能从词首）。解法：给每个 CJK 字符两侧加空格，
 * 变成字符 unigram，再用短语匹配 → 等价于子串检索，长短查询都覆盖。
 * ASCII 单词（公司英文名等）保持完整。
 */
function segmentCJK(text: string): string {
  return text.replace(/[㐀-鿿豈-﫿぀-ヿ]/g, ' $& ').replace(/\s+/g, ' ').trim();
}

/** 重建某候选人在 FTS 索引中的整行（姓名+公司+学校+全部笔记聚合） */
export function reindexCandidate(fingerprint: string): void {
  if (!ftsStmts) return;
  try {
    const c = ftsStmts.candidate.get(fingerprint) as { name?: string; company?: string; school?: string } | undefined;
    const noteRows = ftsStmts.notes.all(fingerprint) as { note: string }[];
    const notes = noteRows.map(n => n.note).join(' ');
    // 候选人不在 candidates 表（note-only 档案）时，从笔记取姓名兜底
    const noteName = c?.name
      ?? ((db.prepare(`SELECT name FROM candidate_notes WHERE fingerprint = ? LIMIT 1`).get(fingerprint) as { name?: string } | undefined)?.name);
    if (!c && noteRows.length === 0) return; // 既无候选人也无笔记，无需索引
    ftsStmts.del.run(fingerprint);
    ftsStmts.ins.run({
      fingerprint,
      name: segmentCJK(noteName ?? ''),
      company: segmentCJK(c?.company ?? ''),
      school: segmentCJK(c?.school ?? ''),
      notes: segmentCJK(notes),
    });
  } catch { /* 索引失败不影响主流程 */ }
}

export const memoryOps = {
  /** 给候选人添加一条笔记并刷新检索索引 */
  addNote(fingerprint: string, name: string, note: string): void {
    noteStmts.insert.run({ fingerprint, name, note });
    reindexCandidate(fingerprint);
  },

  notesOf(fingerprint: string): { note: string; created_at: string }[] {
    return noteStmts.byFingerprint.all(fingerprint) as { note: string; created_at: string }[];
  },

  /** 自然语言/关键词检索人才库；FTS 不可用时降级到 LIKE */
  search(query: string, limit = 15): Array<{
    fingerprint: string; name: string; company: string; school: string;
    status: string; channel: string; contacted_at: string; notes: string;
  }> {
    const q = query.trim();
    if (!q) return [];

    if (ftsEnabled) {
      // 每个用户词转成字符 unigram 短语（子串匹配），多个词之间 AND
      const ftsQuery = q.split(/\s+/).filter(Boolean)
        .map(t => `"${segmentCJK(t).replace(/"/g, '')}"`)
        .join(' ');
      try {
        const rows = db.prepare(`
          SELECT f.fingerprint, f.notes AS seg_notes,
                 c.name AS c_name, f.name AS f_name,
                 COALESCE(c.company, '') AS company,
                 COALESCE(c.school, '')  AS school,
                 COALESCE(c.status, '已存档')  AS status,
                 COALESCE(c.channel, '笔记')   AS channel,
                 c.contacted_at
          FROM candidate_fts f
          LEFT JOIN candidates c ON c.fingerprint = f.fingerprint
          WHERE candidate_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsQuery, limit) as any[];
        // FTS 字段是分词后的（带空格），姓名优先取 candidates 原值，笔记去掉分词空格
        return rows.map(r => ({
          fingerprint: r.fingerprint,
          name: r.c_name ?? String(r.f_name ?? '').replace(/\s+/g, ''),
          company: r.company,
          school: r.school,
          status: r.status,
          channel: r.channel,
          contacted_at: r.contacted_at ?? '',
          notes: String(r.seg_notes ?? '').replace(/\s+(?=[㐀-鿿])/g, '').replace(/(?<=[㐀-鿿])\s+/g, ''),
        }));
      } catch { /* MATCH 语法异常时降级 */ }
    }

    const like = `%${q}%`;
    return db.prepare(`
      SELECT c.fingerprint, c.name, c.company, c.school, c.status, c.channel, c.contacted_at,
             COALESCE((SELECT GROUP_CONCAT(note, ' ') FROM candidate_notes n WHERE n.fingerprint = c.fingerprint), '') AS notes
      FROM candidates c
      WHERE c.name LIKE ? OR c.company LIKE ? OR c.school LIKE ?
         OR c.fingerprint IN (SELECT fingerprint FROM candidate_notes WHERE note LIKE ?)
      ORDER BY c.contacted_at DESC
      LIMIT ?
    `).all(like, like, like, like, limit) as any[];
  },

  /** 人才库规模统计（供心跳信号用） */
  stats(): { total: number; withNotes: number } {
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get() as { n: number }).n;
    const withNotes = (db.prepare(`SELECT COUNT(DISTINCT fingerprint) AS n FROM candidate_notes`).get() as { n: number }).n;
    return { total, withNotes };
  },
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
  save: db.prepare<{ job_id: string; summary: string; highlights: string; excerpt: string }>(`
    INSERT INTO conversations (job_id, summary, highlights, excerpt)
    VALUES (@job_id, @summary, @highlights, @excerpt)
  `),

  recent: db.prepare<[string]>(`
    SELECT summary, highlights, excerpt, created_at FROM conversations
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

// ── 任务管理操作 ──────────────────────────────────────────
export const taskOps = {
  create: db.prepare<{
    title: string;
    description?: string;
    priority?: number;
    parent_id?: number;
    job_id?: string;
    assigned_to?: string;
    due_date?: string;
  }>(`
    INSERT INTO tasks (title, description, priority, parent_id, job_id, assigned_to, due_date)
    VALUES (@title, @description, @priority, @parent_id, @job_id, @assigned_to, @due_date)
  `),

  update: db.prepare<{
    id: number;
    status?: string;
    title?: string;
    description?: string;
    priority?: number;
    assigned_to?: string;
    due_date?: string;
    completed_at?: string;
  }>(`
    UPDATE tasks
    SET status      = COALESCE(@status, status),
        title       = COALESCE(@title, title),
        description = COALESCE(@description, description),
        priority    = COALESCE(@priority, priority),
        assigned_to = COALESCE(@assigned_to, assigned_to),
        due_date    = COALESCE(@due_date, due_date),
        completed_at = @completed_at,
        updated_at  = datetime('now')
    WHERE id = @id
  `),

  delete: db.prepare<[number]>(`
    DELETE FROM tasks WHERE id = ?
  `),

  get: db.prepare<[number]>(`
    SELECT * FROM tasks WHERE id = ?
  `),

  listAll: db.prepare(`
    SELECT * FROM tasks
    ORDER BY
      CASE status
        WHEN 'in_progress' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'blocked' THEN 3
        WHEN 'completed' THEN 4
        ELSE 5
      END,
      priority DESC,
      created_at DESC
  `),

  listByStatus: db.prepare<[string]>(`
    SELECT * FROM tasks
    WHERE status = ?
    ORDER BY priority DESC, created_at DESC
  `),

  listByJob: db.prepare<[string]>(`
    SELECT * FROM tasks
    WHERE job_id = ?
    ORDER BY priority DESC, created_at DESC
  `),

  listSubtasks: db.prepare<[number]>(`
    SELECT * FROM tasks
    WHERE parent_id = ?
    ORDER BY priority DESC, created_at DESC
  `),

  stats: db.prepare(`
    SELECT
      status,
      COUNT(*) as count
    FROM tasks
    GROUP BY status
  `),
};

// ── 人才库 FTS 全量回填 ────────────────────────────────────
// 候选人写入路径分散在各渠道适配器，启动时统一把尚未进 FTS 索引的候选人补齐，
// 保证"之前聊过的人"无论从哪条路径入库都能被检索到。
export function backfillCandidateIndex(): void {
  if (!ftsEnabled) return;
  try {
    const missing = db.prepare(`
      SELECT fingerprint FROM candidates
      WHERE fingerprint NOT IN (SELECT fingerprint FROM candidate_fts)
    `).all() as { fingerprint: string }[];
    for (const m of missing) reindexCandidate(m.fingerprint);
  } catch { /* 回填失败不影响启动 */ }
}

backfillCandidateIndex();
