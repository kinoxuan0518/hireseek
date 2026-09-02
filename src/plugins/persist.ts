import type { Context } from '../dsh/context';
import { saveAgentSessionMessages } from '../agent-core/session-store';
import { db } from '../db';
import './session-events';
import type { Session } from '../dsh/session';
import type { SessionEvent } from '../dsh/types';

interface SessionEventNotice {
  session: Session;
  event: SessionEvent;
}

export function persistPlugin(ctx: Context): void {
  ctx.on('session/event', (notice: SessionEventNotice) => {
    const { session, event } = notice;
    try {
      if (event.type === 'turn/end' || event.type === 'step/end') {
        persistSession(session);
      }
    } catch {
      // 持久化失败不影响主循环
    }
  });
}

function persistSession(session: Session): void {
  const events = session.list();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM agent_session_events WHERE session_id = ?`).run(session.id);
    const insert = db.prepare(`
      INSERT INTO agent_session_events
        (session_id, seq, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const event of events) {
      insert.run(event.sessionId, event.seq, event.type, JSON.stringify(event.payload), event.at);
    }
  });
  tx();
  saveAgentSessionMessages({
    sessionId: session.id,
    title: session.title,
    source: session.source,
    messages: session.deriveMessages(),
    createdAt: session.createdAt,
  });
}
