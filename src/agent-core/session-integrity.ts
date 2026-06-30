import type OpenAI from 'openai';
import { db } from '../db';
import { repairToolMessageHistory } from '../message-integrity';
import './store';

export interface SessionIntegrityIssue {
  sessionId: string;
  title: string;
  problem: string;
  detail: string;
}

export interface SessionIntegrityReport {
  totalSessions: number;
  checkedSessions: number;
  totalMessages: number;
  resumableSessions: number;
  issues: SessionIntegrityIssue[];
}

interface SessionRow {
  id: string;
  title: string;
  message_count: number;
}

interface MessageRow {
  role: string;
  raw_json: string;
}

function parseMessages(session: SessionRow, rows: MessageRow[]): {
  messages: OpenAI.ChatCompletionMessageParam[];
  issues: SessionIntegrityIssue[];
} {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  const issues: SessionIntegrityIssue[] = [];

  rows.forEach((row, index) => {
    try {
      const parsed = JSON.parse(row.raw_json) as OpenAI.ChatCompletionMessageParam;
      messages.push(parsed);
      if (parsed.role !== row.role) {
        issues.push({
          sessionId: session.id,
          title: session.title,
          problem: 'role_mismatch',
          detail: `seq=${index + 1} index_role=${row.role} raw_role=${parsed.role}`,
        });
      }
    } catch (err) {
      issues.push({
        sessionId: session.id,
        title: session.title,
        problem: 'invalid_raw_json',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { messages, issues };
}

export function collectSessionIntegrityReport(limit = 20): SessionIntegrityReport {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM agent_sessions) AS sessions,
      (SELECT COUNT(*) FROM agent_messages) AS messages
  `).get() as { sessions: number; messages: number };

  const sessions = db.prepare(`
    SELECT id, title, message_count
    FROM agent_sessions
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit) as SessionRow[];

  const messageStmt = db.prepare(`
    SELECT role, raw_json
    FROM agent_messages
    WHERE session_id = ?
    ORDER BY seq
  `);

  const issues: SessionIntegrityIssue[] = [];
  let resumableSessions = 0;

  for (const session of sessions) {
    const rows = messageStmt.all(session.id) as MessageRow[];
    if (rows.length !== session.message_count) {
      issues.push({
        sessionId: session.id,
        title: session.title,
        problem: 'message_count_mismatch',
        detail: `session=${session.message_count} messages=${rows.length}`,
      });
    }

    const parsed = parseMessages(session, rows);
    issues.push(...parsed.issues);
    const conversationCount = parsed.messages.filter(msg => msg.role !== 'system').length;
    if (conversationCount > 0) resumableSessions++;

    if (parsed.messages.length > 0) {
      const repaired = repairToolMessageHistory(parsed.messages);
      if (repaired.stats.changed) {
        issues.push({
          sessionId: session.id,
          title: session.title,
          problem: 'tool_history_needs_repair',
          detail: `inserted=${repaired.stats.insertedToolResults}, dropped=${repaired.stats.droppedToolMessages}`,
        });
      }
    }
  }

  return {
    totalSessions: totals.sessions,
    checkedSessions: sessions.length,
    totalMessages: totals.messages,
    resumableSessions,
    issues,
  };
}

export function formatSessionIntegrityReport(report: SessionIntegrityReport): string {
  const summary = [
    `sessions=${report.totalSessions}`,
    `messages=${report.totalMessages}`,
    `checked=${report.checkedSessions}`,
    `resumable=${report.resumableSessions}`,
    `issues=${report.issues.length}`,
  ].join(', ');
  if (report.issues.length === 0) return `Session integrity: ${summary}`;
  return [
    `Session integrity: ${summary}`,
    ...report.issues.slice(0, 8).map(issue => (
      `- ${issue.sessionId} ${issue.problem}: ${issue.detail}`
    )),
  ].join('\n');
}
