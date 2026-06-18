import { db } from '../db';
import './store';
import type { ToolExecutionMode, ToolRegistry } from './tool-registry';

export interface ToolTraceInput {
  runId?: number | null;
  sessionId?: string | null;
  toolCallId?: string | null;
  toolName: string;
  input?: unknown;
  output?: unknown;
  ok: boolean;
  error?: string | null;
  sideEffect?: boolean;
  mode?: ToolExecutionMode;
}

export interface RejectedToolCallInput {
  registry?: ToolRegistry;
  runId?: number | null;
  sessionId?: string | null;
  toolCallId?: string | null;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error: string;
}

function summarize(value: unknown, max = 700): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, max);
}

export function summarizeForTrace(value: unknown, max = 700): string {
  return summarize(value, max);
}

export function recordToolCall(input: ToolTraceInput): void {
  try {
    db.prepare(`
      INSERT INTO agent_tool_calls
        (run_id, session_id, tool_call_id, tool_name, input_summary, output_summary, ok, error, side_effect, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId ?? null,
      input.sessionId ?? null,
      input.toolCallId ?? null,
      input.toolName,
      summarize(input.input),
      summarize(input.output),
      input.ok ? 1 : 0,
      input.error ?? null,
      input.sideEffect ? 1 : 0,
      input.mode ?? (input.sideEffect ? 'execute' : 'read'),
    );
  } catch {
    // Trace 是观测层，失败不能阻断主流程。
  }
}

export function recordRejectedToolCall(input: RejectedToolCallInput): void {
  const registered = input.registry?.get(input.toolName);
  const sideEffect = registered?.policy.sideEffect ?? false;
  recordToolCall({
    runId: input.runId,
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: input.input,
    output: input.output,
    ok: false,
    error: input.error,
    sideEffect,
    mode: sideEffect ? 'execute' : 'read',
  });
}
