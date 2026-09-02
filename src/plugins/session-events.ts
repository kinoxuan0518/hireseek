import '../agent-core/store';
import { db } from '../db';
import type { SessionEvent } from '../dsh/types';

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_session_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    seq          INTEGER NOT NULL,
    type         TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE(session_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_session_events_session ON agent_session_events(session_id);
`);

export function loadSessionEvents(sessionId: string): SessionEvent[] {
  const rows = db.prepare(`
    SELECT session_id AS sessionId, seq, type, payload_json AS payloadJson, created_at AS at
    FROM agent_session_events
    WHERE session_id = ?
    ORDER BY seq
  `).all(sessionId) as Array<{ sessionId: string; seq: number; type: SessionEvent['type']; payloadJson: string; at: string }>;
  return rows.map(row => ({
    id: `evt-${row.sessionId}-${row.seq}`,
    sessionId: row.sessionId,
    seq: row.seq,
    type: row.type,
    at: row.at,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
  }));
}
