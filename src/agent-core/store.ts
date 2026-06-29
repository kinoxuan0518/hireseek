import { db } from '../db';

let initialized = false;

export function ensureAgentCoreSchema(): void {
  if (initialized) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         INTEGER,
      session_id     TEXT,
      tool_call_id   TEXT,
      tool_name      TEXT NOT NULL,
      input_summary  TEXT,
      output_summary TEXT,
      ok             INTEGER NOT NULL DEFAULT 1,
      error          TEXT,
      side_effect    INTEGER NOT NULL DEFAULT 0,
      mode           TEXT NOT NULL DEFAULT 'read',
      stage_id       TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(run_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_session ON agent_tool_calls(session_id);

    CREATE TABLE IF NOT EXISTS agent_run_states (
      run_id           INTEGER PRIMARY KEY,
      session_id       TEXT,
      status           TEXT NOT NULL,
      phase            TEXT NOT NULL,
      stage_id         TEXT,
      last_action      TEXT,
      last_url         TEXT,
      reason           TEXT,
      snapshot_summary TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_states_status ON agent_run_states(status);
    CREATE INDEX IF NOT EXISTS idx_agent_run_states_stage ON agent_run_states(stage_id);

    CREATE TABLE IF NOT EXISTS agent_execution_environments (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      label       TEXT,
      controller  TEXT NOT NULL DEFAULT 'unknown',
      status      TEXT NOT NULL,
      mode        TEXT NOT NULL DEFAULT 'read',
      run_id      INTEGER,
      session_id  TEXT,
      url         TEXT,
      title       TEXT,
      active      INTEGER,
      reason      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_execution_env_status ON agent_execution_environments(status);
    CREATE INDEX IF NOT EXISTS idx_agent_execution_env_run ON agent_execution_environments(run_id);

    CREATE TABLE IF NOT EXISTS agent_context_compactions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id          TEXT,
      source              TEXT NOT NULL DEFAULT 'chat',
      original_tokens     INTEGER NOT NULL,
      compressed_tokens   INTEGER NOT NULL,
      original_messages   INTEGER NOT NULL,
      compressed_messages INTEGER NOT NULL,
      reduction_percent   INTEGER NOT NULL,
      summary             TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_context_compactions_session ON agent_context_compactions(session_id);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'chat',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT NOT NULL,
      seq            INTEGER NOT NULL,
      role           TEXT NOT NULL,
      content        TEXT,
      tool_call_id   TEXT,
      tool_call_name TEXT,
      raw_json       TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id);

    CREATE TABLE IF NOT EXISTS agent_memory_raw (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      scope         TEXT NOT NULL DEFAULT 'global',
      source        TEXT NOT NULL,
      visibility    TEXT NOT NULL DEFAULT 'private',
      version       INTEGER NOT NULL DEFAULT 1,
      inject_allowed INTEGER NOT NULL DEFAULT 1,
      expires_at    TEXT,
      archived_at   TEXT,
      content_hash  TEXT,
      content       TEXT NOT NULL,
      metadata_json TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_raw_scope ON agent_memory_raw(scope);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_raw_source ON agent_memory_raw(source);

    CREATE TABLE IF NOT EXISTS agent_memory_episodic (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL DEFAULT 'default',
      source        TEXT NOT NULL,
      visibility    TEXT NOT NULL DEFAULT 'private',
      version       INTEGER NOT NULL DEFAULT 1,
      inject_allowed INTEGER NOT NULL DEFAULT 1,
      expires_at    TEXT,
      archived_at   TEXT,
      content_hash  TEXT,
      summary       TEXT NOT NULL,
      content       TEXT NOT NULL,
      metadata_json TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_episodic_user ON agent_memory_episodic(user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_episodic_source ON agent_memory_episodic(source);

    CREATE TABLE IF NOT EXISTS agent_memory_semantic (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_key      TEXT NOT NULL,
      fact_value    TEXT NOT NULL,
      source        TEXT NOT NULL,
      visibility    TEXT NOT NULL DEFAULT 'private',
      version       INTEGER NOT NULL DEFAULT 1,
      inject_allowed INTEGER NOT NULL DEFAULT 1,
      expires_at    TEXT,
      archived_at   TEXT,
      metadata_json TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(fact_key, source, version)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_semantic_key ON agent_memory_semantic(fact_key);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_semantic_source ON agent_memory_semantic(source);
  `);

  for (const sql of [
    `ALTER TABLE agent_memory_raw ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`,
    `ALTER TABLE agent_memory_raw ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE agent_memory_raw ADD COLUMN content_hash TEXT`,
    `ALTER TABLE agent_memory_episodic ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`,
    `ALTER TABLE agent_memory_episodic ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE agent_memory_episodic ADD COLUMN content_hash TEXT`,
    `ALTER TABLE agent_memory_semantic ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`,
    `ALTER TABLE agent_memory_raw ADD COLUMN inject_allowed INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE agent_memory_raw ADD COLUMN expires_at TEXT`,
    `ALTER TABLE agent_memory_raw ADD COLUMN archived_at TEXT`,
    `ALTER TABLE agent_memory_episodic ADD COLUMN inject_allowed INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE agent_memory_episodic ADD COLUMN expires_at TEXT`,
    `ALTER TABLE agent_memory_episodic ADD COLUMN archived_at TEXT`,
    `ALTER TABLE agent_memory_semantic ADD COLUMN inject_allowed INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE agent_memory_semantic ADD COLUMN expires_at TEXT`,
    `ALTER TABLE agent_memory_semantic ADD COLUMN archived_at TEXT`,
    `ALTER TABLE agent_tool_calls ADD COLUMN stage_id TEXT`,
    `ALTER TABLE agent_run_states ADD COLUMN snapshot_summary TEXT`,
  ]) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_stage ON agent_tool_calls(stage_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_raw_active ON agent_memory_raw(archived_at, expires_at, inject_allowed);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_episodic_active ON agent_memory_episodic(archived_at, expires_at, inject_allowed);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_semantic_active ON agent_memory_semantic(archived_at, expires_at, inject_allowed);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_raw_dedupe
      ON agent_memory_raw(scope, source, content_hash)
      WHERE content_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_episodic_dedupe
      ON agent_memory_episodic(user_id, source, content_hash)
      WHERE content_hash IS NOT NULL;
  `);
  initialized = true;
}

ensureAgentCoreSchema();
