import { db } from '../db';
import { createRuntimeContext } from './runtime-context';
import { formatExecutionEnvironmentLine, listExecutionEnvironments, type ExecutionEnvironmentState } from './environment-store';
import { listAgentRunStates, type AgentRunState } from './run-state-store';
import type { ToolRegistry } from './tool-registry';
import './store';

export interface CoreStatus {
  runtime: ReturnType<typeof createRuntimeContext>;
  tools: {
    total: number;
    sideEffect: number;
    requiresApproval: number;
    dryRunCapable: number;
    validationIssues: Array<{ tool: string; problem: string }>;
    byCategory: Record<string, number>;
  };
  trace: {
    total: number;
    failed: number;
    sideEffect: number;
    recent: Array<{
      tool_name: string;
      ok: number;
      side_effect: number;
      mode: string;
      stage_id: string | null;
      created_at: string;
      error: string | null;
    }>;
  };
  runStates: {
    recent: AgentRunState[];
  };
  environments: {
    recent: ExecutionEnvironmentState[];
  };
  sessions: {
    total: number;
    messages: number;
    recent: Array<{ id: string; title: string; source: string; message_count: number; updated_at: string }>;
  };
  memory: {
    raw: number;
    episodic: number;
    semantic: number;
  };
}

function count(sql: string): number {
  try {
    return (db.prepare(sql).get() as { n: number }).n;
  } catch {
    return 0;
  }
}

export function collectCoreStatus(registry?: ToolRegistry): CoreStatus {
  const tools = registry?.list() ?? [];
  const byCategory: Record<string, number> = {};
  for (const t of tools) byCategory[t.policy.category] = (byCategory[t.policy.category] ?? 0) + 1;

  return {
    runtime: createRuntimeContext(),
    tools: {
      total: tools.length,
      sideEffect: tools.filter(t => t.policy.sideEffect).length,
      requiresApproval: tools.filter(t => t.policy.requiresApproval).length,
      dryRunCapable: tools.filter(t => t.policy.supportsDryRun).length,
      validationIssues: registry?.validate() ?? [],
      byCategory,
    },
    trace: {
      total: count(`SELECT COUNT(*) AS n FROM agent_tool_calls`),
      failed: count(`SELECT COUNT(*) AS n FROM agent_tool_calls WHERE ok = 0`),
      sideEffect: count(`SELECT COUNT(*) AS n FROM agent_tool_calls WHERE side_effect = 1`),
      recent: db.prepare(`
        SELECT tool_name, ok, side_effect, mode, stage_id, created_at, error
        FROM agent_tool_calls
        ORDER BY id DESC
        LIMIT 8
      `).all() as CoreStatus['trace']['recent'],
    },
    runStates: {
      recent: listAgentRunStates(8),
    },
    environments: {
      recent: listExecutionEnvironments(8),
    },
    sessions: {
      total: count(`SELECT COUNT(*) AS n FROM agent_sessions`),
      messages: count(`SELECT COUNT(*) AS n FROM agent_messages`),
      recent: db.prepare(`
        SELECT id, title, source, message_count, updated_at
        FROM agent_sessions
        ORDER BY updated_at DESC
        LIMIT 5
      `).all() as CoreStatus['sessions']['recent'],
    },
    memory: {
      raw: count(`SELECT COUNT(*) AS n FROM agent_memory_raw`),
      episodic: count(`SELECT COUNT(*) AS n FROM agent_memory_episodic`),
      semantic: count(`SELECT COUNT(*) AS n FROM agent_memory_semantic`),
    },
  };
}

export function formatCoreStatus(status: CoreStatus): string {
  const ctx = status.runtime;
  const categoryRows = Object.entries(status.tools.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('  ') || '无';
  const issues = status.tools.validationIssues.length
    ? status.tools.validationIssues.map(i => `- ${i.tool}: ${i.problem}`).join('\n')
    : '无';
  const recentTrace = status.trace.recent.length
    ? status.trace.recent.map(t => {
      const ok = t.ok ? 'ok' : 'fail';
      const side = t.side_effect ? ` ${t.mode}/side-effect` : ` ${t.mode}`;
      const stage = t.stage_id ? ` stage=${t.stage_id}` : '';
      const err = t.error ? ` — ${t.error.slice(0, 80)}` : '';
      return `- ${t.created_at} ${t.tool_name} [${ok}${side}${stage}]${err}`;
    }).join('\n')
    : '无';
  const recentRunStates = status.runStates.recent.length
    ? status.runStates.recent.map(r => {
      const scope = [r.channel, r.jobId, r.runMode].filter(Boolean).join('/') || 'unknown';
      const stage = r.stageId ? ` stage=${r.stageId}` : '';
      const action = r.lastAction ? ` last=${r.lastAction}` : '';
      const url = r.lastUrl ? ` url=${r.lastUrl.slice(0, 90)}` : '';
      const reason = r.reason ? ` — ${r.reason.slice(0, 80)}` : '';
      return `- ${r.updatedAt ?? ''} run#${r.runId} ${scope} ${r.status}/${r.phase}${stage}${action}${url}${reason}`;
    }).join('\n')
    : '无';
  const recentEnvironments = status.environments.recent.length
    ? status.environments.recent.map(formatExecutionEnvironmentLine).join('\n')
    : '无';
  const recentSessions = status.sessions.recent.length
    ? status.sessions.recent.map(s => `- ${s.updated_at} ${s.title} (${s.source}, ${s.message_count} messages, ${s.id})`).join('\n')
    : '无';

  return [
    'HireSeek Agent Core',
    '',
    `Runtime: ${ctx.llm.provider}/${ctx.llm.model}`,
    `DB: ${ctx.paths.dbPath}`,
    `Workspace: ${ctx.paths.workspaceDir}`,
    `Knowledge home: ${ctx.paths.knowledgeHome || '未配置'}`,
    `Skill homes: ${ctx.paths.skillHomes.join(' | ') || '无'}`,
    `Active job: ${ctx.activeJob?.title ?? '未配置'} (${ctx.activeJobId})`,
    `Enabled channels: ${ctx.enabledChannels.map(c => `${c.channel}x${c.accounts}`).join(', ') || '无'}`,
    '',
    `Tools: ${status.tools.total} total, ${status.tools.sideEffect} side-effect, ${status.tools.requiresApproval} approval, ${status.tools.dryRunCapable} dry-run`,
    `Tool categories: ${categoryRows}`,
    `Tool registry issues:\n${issues}`,
    '',
    `Trace: ${status.trace.total} calls, ${status.trace.failed} failed, ${status.trace.sideEffect} side-effect`,
    `Recent trace:\n${recentTrace}`,
    '',
    `Run states:\n${recentRunStates}`,
    '',
    `Execution environments:\n${recentEnvironments}`,
    '',
    `Sessions: ${status.sessions.total} sessions, ${status.sessions.messages} messages`,
    `Recent sessions:\n${recentSessions}`,
    '',
    `Memory: raw=${status.memory.raw}, episodic=${status.memory.episodic}, semantic=${status.memory.semantic}`,
  ].join('\n');
}
