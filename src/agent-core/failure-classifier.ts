import { db } from '../db';
import './store';

export type HarnessFailureSeverity = 'info' | 'warn' | 'fail';

export type HarnessFailureCode =
  | 'external_control'
  | 'unknown_tool'
  | 'invalid_tool_arguments'
  | 'approval_denied'
  | 'mode_blocked'
  | 'policy_blocked'
  | 'environment_unavailable'
  | 'session_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'browser_action_failed'
  | 'tool_execution_failed'
  | 'unknown';

export interface HarnessFailureInput {
  toolName?: string | null;
  mode?: string | null;
  stageId?: string | null;
  error?: string | null;
  output?: string | null;
  environmentStatus?: string | null;
  environmentController?: string | null;
  environmentKind?: string | null;
}

export interface HarnessFailureClassification {
  code: HarnessFailureCode;
  severity: HarnessFailureSeverity;
  retryable: boolean;
  source: 'tool_trace' | 'execution_environment';
  reason: string;
}

export interface HarnessFailureEvent extends HarnessFailureClassification {
  id: string;
  runId?: number | null;
  sessionId?: string | null;
  toolName?: string | null;
  mode?: string | null;
  stageId?: string | null;
  createdAt: string;
}

export interface HarnessFailureReport {
  total: number;
  byCode: Record<string, number>;
  recent: HarnessFailureEvent[];
}

function textOf(input: HarnessFailureInput): string {
  return [input.error, input.output, input.environmentStatus, input.environmentController, input.environmentKind]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function includesAny(text: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some(pattern => (
    typeof pattern === 'string' ? text.includes(pattern.toLowerCase()) : pattern.test(text)
  ));
}

function classification(
  input: HarnessFailureInput,
  source: HarnessFailureClassification['source'],
  code: HarnessFailureCode,
  severity: HarnessFailureSeverity,
  retryable: boolean,
  reason: string,
): HarnessFailureClassification {
  return { code, severity, retryable, source, reason };
}

export function classifyHarnessFailure(
  input: HarnessFailureInput,
  source: HarnessFailureClassification['source'] = 'tool_trace',
): HarnessFailureClassification {
  const text = textOf(input);
  const toolName = input.toolName ?? '';

  if (
    input.environmentStatus === 'blocked' ||
    input.environmentController === 'user' ||
    includesAny(text, ['用户接管', 'user is using chrome', 'external_control', '不再是激活标签', '外部改变', '我在用'])
  ) {
    return classification(input, source, 'external_control', 'warn', true, '用户或外部进程正在占用执行环境。');
  }

  if (includesAny(text, ['unknown tool', '未知工具'])) {
    return classification(input, source, 'unknown_tool', 'fail', false, '模型调用了未注册工具，或工具清单与模型上下文不一致。');
  }

  if (includesAny(text, ['参数不是合法 json', 'expected property name', 'unexpected token', 'json', 'tool_call'])) {
    return classification(input, source, 'invalid_tool_arguments', 'fail', true, '模型生成的工具参数不合法或工具调用结构不完整。');
  }

  if (includesAny(text, ['approval denied', '工具调用被拒绝', '需审批', 'requires approval'])) {
    return classification(input, source, 'approval_denied', 'warn', true, '工具调用被权限闸门拒绝。');
  }

  if (includesAny(text, ['当前模式禁止', 'blocked by run mode', 'dry-run', 'prepare 模式', 'screen 模式'])) {
    return classification(input, source, 'mode_blocked', 'info', true, '当前运行模式拒绝了该动作。');
  }

  if (includesAny(text, ['平台协议禁止', '产品协议', '协议阶段', '阶段门禁', 'blocked by platform protocol', 'completion_check_failed'])) {
    return classification(input, source, 'policy_blocked', 'warn', true, '上层或中层协议拒绝了该动作。');
  }

  if (includesAny(text, ['没有检测到正在运行的 google chrome', 'chrome 没有可接管', 'applescript', 'javascript 权限', 'cdp'])) {
    return classification(input, source, 'environment_unavailable', 'fail', true, '执行环境不可用或缺少必要连接权限。');
  }

  if (includesAny(text, ['登录态', '未登录', 'login', 'session', 'cookie', '访问的资源不存在'])) {
    return classification(input, source, 'session_unavailable', 'warn', true, '目标站点会话或账号状态不可用。');
  }

  if (includesAny(text, ['频繁', '上限', 'rate limit', 'too many', '限制'])) {
    return classification(input, source, 'rate_limited', 'warn', true, '外部平台触发频率或额度限制。');
  }

  if (includesAny(text, ['timeout', 'timed out', '超时'])) {
    return classification(input, source, 'timeout', 'warn', true, '工具或外部环境超时。');
  }

  if (toolName === 'browser' || input.environmentKind === 'browser') {
    return classification(input, source, 'browser_action_failed', 'warn', true, '浏览器动作失败，需要检查页面状态、ref 或环境控制权。');
  }

  if (includesAny(text, ['工具执行失败', 'failed', 'error'])) {
    return classification(input, source, 'tool_execution_failed', 'warn', true, '工具执行失败，但未匹配到更具体原因。');
  }

  return classification(input, source, 'unknown', 'warn', true, '未知 harness 失败，需要保留原始 trace 继续分析。');
}

export function collectHarnessFailureReport(limit = 8): HarnessFailureReport {
  const events: HarnessFailureEvent[] = [];

  const toolRows = db.prepare(`
    SELECT id, run_id, session_id, tool_name, mode, stage_id, error, output_summary, created_at
    FROM agent_tool_calls
    WHERE ok = 0
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    run_id: number | null;
    session_id: string | null;
    tool_name: string;
    mode: string | null;
    stage_id: string | null;
    error: string | null;
    output_summary: string | null;
    created_at: string;
  }>;

  for (const row of toolRows) {
    const classified = classifyHarnessFailure({
      toolName: row.tool_name,
      mode: row.mode,
      stageId: row.stage_id,
      error: row.error,
      output: row.output_summary,
    }, 'tool_trace');
    events.push({
      ...classified,
      id: `tool:${row.id}`,
      runId: row.run_id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      mode: row.mode,
      stageId: row.stage_id,
      createdAt: row.created_at,
    });
  }

  const envRows = db.prepare(`
    SELECT id, kind, controller, status, mode, run_id, session_id, reason, updated_at
    FROM agent_execution_environments
    WHERE status IN ('blocked', 'error')
    ORDER BY updated_at DESC, id ASC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    kind: string;
    controller: string;
    status: string;
    mode: string | null;
    run_id: number | null;
    session_id: string | null;
    reason: string | null;
    updated_at: string;
  }>;

  for (const row of envRows) {
    const classified = classifyHarnessFailure({
      mode: row.mode,
      error: row.reason,
      environmentStatus: row.status,
      environmentController: row.controller,
      environmentKind: row.kind,
    }, 'execution_environment');
    events.push({
      ...classified,
      id: `env:${row.id}`,
      runId: row.run_id,
      sessionId: row.session_id,
      mode: row.mode,
      createdAt: row.updated_at,
    });
  }

  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recent = events.slice(0, limit);
  const byCode: Record<string, number> = {};
  for (const event of recent) byCode[event.code] = (byCode[event.code] ?? 0) + 1;
  return { total: recent.length, byCode, recent };
}

export function formatHarnessFailureReport(report: HarnessFailureReport): string {
  if (report.total === 0) return '无';
  const rows = report.recent.map(event => {
    const run = event.runId == null ? '' : ` run#${event.runId}`;
    const tool = event.toolName ? ` ${event.toolName}` : '';
    const stage = event.stageId ? ` stage=${event.stageId}` : '';
    return `- ${event.createdAt} ${event.code}/${event.severity}${run}${tool}${stage} — ${event.reason}`;
  });
  return rows.join('\n');
}
