import fs from 'fs';
import path from 'path';
import { db } from './db';
import { createRuntimeContext } from './agent-core/runtime-context';
import type { ToolRegistry } from './agent-core/tool-registry';
import { buildPlatformProtocolManifest, listPlatformProtocols } from './platform-protocols';
import { buildRecruitingCapabilityManifest, listRecruitingCapabilities } from './capabilities';
import { listClaudeSkills } from './skills/claude-skills';
import { buildSkillAssetManifest } from './skills/skill-asset-manifest';
import { buildChatHarnessContext, buildHarnessRunAssembly } from './harness/run-assembly';
import { DOM_RUNNER_TOOL_REGISTRY } from './runners/dom-runner';
import { GENERIC_VISION_TOOL_REGISTRY } from './runners/generic-vision';
import { channelUsesScreenContactGate } from './orchestrator';
import { listPendingAgentRunStates } from './agent-core/run-state-store';
import { listInconsistentRunStates, listStaleExecutionEnvironments, listStaleTaskRuns } from './agent-core/task-run-lifecycle';
import { collectSessionIntegrityReport } from './agent-core/session-integrity';
import { collectHarnessFailureReport } from './agent-core/failure-classifier';
import { latestRunAssemblySnapshots } from './agent-core/run-assembly-store';
import { contractWritesForChannel } from './contracts';
import { probeBrowserReadinessManySync, type BrowserReadinessSummary } from './browser-readiness';
import type { Channel } from './types';

export type DoctorStatus = 'pass' | 'warn' | 'fail';
export type DoctorLayer = 'lower' | 'middle' | 'upper' | 'external';

export interface DoctorCheck {
  layer: DoctorLayer;
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  checks: DoctorCheck[];
  nextSteps: string[];
}

const STATUS_RANK: Record<DoctorStatus, number> = { pass: 0, warn: 1, fail: 2 };

function worstStatus(statuses: DoctorStatus[]): DoctorStatus {
  return statuses.reduce((worst, current) => (
    STATUS_RANK[current] > STATUS_RANK[worst] ? current : worst
  ), 'pass' as DoctorStatus);
}

function check(layer: DoctorLayer, name: string, status: DoctorStatus, detail: string): DoctorCheck {
  return { layer, name, status, detail };
}

function tableExists(name: string): boolean {
  try {
    const row = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name) as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

function tableColumns(name: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    return new Set(rows.map(row => row.name));
  } catch {
    return new Set();
  }
}

function pathState(target: string): DoctorStatus {
  if (!target) return 'warn';
  return fs.existsSync(target) ? 'pass' : 'warn';
}

function missingWorkspaceSources(sourceFiles: string[], workspaceDir: string): string[] {
  return sourceFiles.filter(file => !fs.existsSync(path.join(workspaceDir, file)));
}

function recentPendingRunStateDetails(limit = 3): string[] {
  return listPendingAgentRunStates(limit, 24)
    .map(state => {
      const stage = state.stageId ? ` stage=${state.stageId}` : '';
      const action = state.lastAction ? ` last=${state.lastAction}` : '';
      const reason = state.reason ? ` reason=${state.reason.slice(0, 90)}` : '';
      return `run #${state.runId} ${state.status}/${state.phase}${stage}${action}${reason}`;
    });
}

function readSourceForDoctor(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');
}

function collectInteractionModelProblems(): string[] {
  try {
    const chat = readSourceForDoctor('chat.ts');
    const askUser = readSourceForDoctor('ask-user.ts');
    const select = readSourceForDoctor('select.ts');
    const slash = readSourceForDoctor(path.join('chat', 'slash-suggestions.ts'));
    const problems: string[] = [];

    if (!slash.includes('SlashSuggestionController')) {
      problems.push('slash suggestions are not isolated in a controller');
    }
    if (chat.includes("if (text === '/')") || chat.includes('clearSubmittedPromptLine') || chat.includes('命令联想')) {
      problems.push('slash input regressed to command selector behavior');
    }
    if (!chat.includes('acceptSlashSuggestion') || !chat.includes('renderSlashSuggestions')) {
      problems.push('chat slash suggestion hooks missing');
    }
    if (!askUser.includes('askEditableChoice')) {
      problems.push('ask_user_question does not use editable choice input');
    }
    if (/select(?:Multiple)?Options?/.test(askUser)) {
      problems.push('ask_user_question still imports hard-confirm selectors');
    }
    if (!chat.includes('const { askEditableChoice }') || /case 'ask_user_choice':[\s\S]{0,700}selectOption/.test(chat)) {
      problems.push('ask_user_choice does not use editable choice input');
    }
    if (!chat.includes('需要用户做决定时用 ask_user_choice 给可编辑候选')) {
      problems.push('system prompt does not describe editable user-choice behavior');
    }
    if (!select.includes('Tab 把候选填入输入框') || !select.includes('Enter 提交当前输入')) {
      problems.push('editable choice affordance text missing');
    }

    const hardSelectorQuestions = [...chat.matchAll(/selectOption\('([^']+)'/g)].map(match => match[1]);
    const allowedHardSelectorQuestions = new Set(['切换到哪个模型？', '恢复哪个会话？']);
    const unexpectedHardSelectors = hardSelectorQuestions.filter(question => !allowedHardSelectorQuestions.has(question));
    if (unexpectedHardSelectors.length > 0) {
      problems.push(`unexpected hard selectors: ${unexpectedHardSelectors.join(', ')}`);
    }

    return problems;
  } catch (err: any) {
    return [`interaction model source check failed: ${err.message}`];
  }
}

export interface ChannelDryRunEvidence {
  channel: Channel;
  id: number;
  status: string;
  contactedCount: number;
  runCandidates: number;
  interactions: number;
  runActions: number;
  toolCalls: number;
  sideEffects: number;
}

export interface ChannelPrepareEvidence extends ChannelDryRunEvidence {
  successfulSideEffects: number;
  unsafeSuccessfulActions: number;
}

export interface ChannelScreenEvidence extends ChannelPrepareEvidence {
  candidateScreenActions: number;
  screenCandidates: number;
  recommendedContacts: number;
}

export type BossDryRunEvidence = ChannelDryRunEvidence;
export type BossPrepareEvidence = ChannelPrepareEvidence;
export type BossScreenEvidence = ChannelScreenEvidence;

export function hasPassingChannelDryRunEvidence(evidence: ChannelDryRunEvidence | null): boolean {
  return !!evidence
    && evidence.status === 'completed'
    && evidence.contactedCount === 0
    && evidence.runCandidates === 0
    && evidence.interactions === 0
    && evidence.runActions > 0
    && evidence.toolCalls > 0
    && evidence.sideEffects === 0;
}

export function hasPassingBossDryRunEvidence(evidence: BossDryRunEvidence | null): boolean {
  return hasPassingChannelDryRunEvidence(evidence);
}

export function latestChannelDryRunEvidence(channel: Channel): ChannelDryRunEvidence | null {
  try {
    return db.prepare(`
      SELECT
        task_runs.channel,
        task_runs.id,
        task_runs.status,
        task_runs.contacted_count AS contactedCount,
        (SELECT COUNT(*) FROM run_candidates WHERE run_id = task_runs.id) AS runCandidates,
        (SELECT COUNT(*) FROM interaction_log WHERE run_id = task_runs.id) AS interactions,
        (SELECT COUNT(*) FROM run_actions WHERE run_id = task_runs.id) AS runActions,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id) AS toolCalls,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id AND side_effect = 1) AS sideEffects
      FROM task_runs
      WHERE channel = ? AND mode = 'dry_run' AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `).get(channel) as ChannelDryRunEvidence | undefined ?? null;
  } catch {
    return null;
  }
}

export function hasPassingChannelPrepareEvidence(evidence: ChannelPrepareEvidence | null): boolean {
  return !!evidence
    && evidence.status === 'completed'
    && evidence.contactedCount === 0
    && evidence.runCandidates === 0
    && evidence.interactions === 0
    && evidence.runActions > 0
    && evidence.toolCalls > 0
    && evidence.successfulSideEffects > 0
    && evidence.unsafeSuccessfulActions === 0;
}

export function hasPassingBossPrepareEvidence(evidence: BossPrepareEvidence | null): boolean {
  return hasPassingChannelPrepareEvidence(evidence);
}

export function latestChannelPrepareEvidence(channel: Channel): ChannelPrepareEvidence | null {
  try {
    return db.prepare(`
      SELECT
        task_runs.channel,
        task_runs.id,
        task_runs.status,
        task_runs.contacted_count AS contactedCount,
        (SELECT COUNT(*) FROM run_candidates WHERE run_id = task_runs.id) AS runCandidates,
        (SELECT COUNT(*) FROM interaction_log WHERE run_id = task_runs.id) AS interactions,
        (SELECT COUNT(*) FROM run_actions WHERE run_id = task_runs.id) AS runActions,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id) AS toolCalls,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id AND side_effect = 1) AS sideEffects,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id AND side_effect = 1 AND ok = 1) AS successfulSideEffects,
        (
          SELECT COUNT(*) FROM agent_tool_calls
          WHERE run_id = task_runs.id AND ok = 1 AND (
            tool_name IN ('prepare_contact', 'record_contacted') OR
            stage_id IN ('candidate-screen', 'batch-confirmation', 'single-contact') OR (
              tool_name = 'browser' AND json_valid(input_summary) = 1
              AND json_extract(input_summary, '$.action') = 'goto'
            )
          )
        ) AS unsafeSuccessfulActions
      FROM task_runs
      WHERE channel = ? AND mode = 'prepare' AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `).get(channel) as ChannelPrepareEvidence | undefined ?? null;
  } catch {
    return null;
  }
}

export function hasPassingChannelScreenEvidence(evidence: ChannelScreenEvidence | null): boolean {
  return !!evidence
    && evidence.status === 'completed'
    && evidence.contactedCount === 0
    && evidence.runCandidates === 0
    && evidence.interactions === 0
    && evidence.runActions > 0
    && evidence.toolCalls > 0
    && evidence.candidateScreenActions > 0
    && evidence.screenCandidates > 0
    && evidence.recommendedContacts > 0
    && evidence.successfulSideEffects > 0
    && evidence.unsafeSuccessfulActions === 0;
}

export function hasPassingBossScreenEvidence(evidence: BossScreenEvidence | null): boolean {
  return hasPassingChannelScreenEvidence(evidence);
}

export function latestChannelScreenEvidence(channel: Channel): ChannelScreenEvidence | null {
  try {
    return db.prepare(`
      SELECT
        task_runs.channel,
        task_runs.id,
        task_runs.status,
        task_runs.contacted_count AS contactedCount,
        (SELECT COUNT(*) FROM run_candidates WHERE run_id = task_runs.id) AS runCandidates,
        (SELECT COUNT(*) FROM interaction_log WHERE run_id = task_runs.id) AS interactions,
        (SELECT COUNT(*) FROM run_actions WHERE run_id = task_runs.id) AS runActions,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id) AS toolCalls,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id AND side_effect = 1) AS sideEffects,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id AND side_effect = 1 AND ok = 1) AS successfulSideEffects,
        (SELECT COUNT(*) FROM run_actions WHERE run_id = task_runs.id AND stage_id = 'candidate-screen' AND ok = 1) AS candidateScreenActions,
        (SELECT COUNT(*) FROM screen_candidates WHERE run_id = task_runs.id) AS screenCandidates,
        (SELECT COUNT(*) FROM screen_candidates WHERE run_id = task_runs.id AND recommendation = 'contact') AS recommendedContacts,
        (
          SELECT COUNT(*) FROM agent_tool_calls
          WHERE run_id = task_runs.id AND ok = 1 AND (
            tool_name = 'prepare_contact' OR
            (
              tool_name = 'record_contacted' AND (
                json_valid(input_summary) = 0 OR COALESCE(json_extract(input_summary, '$.greeting_sent'), 1) != 0
              )
            ) OR
            (tool_name != 'record_contacted' AND stage_id IN ('batch-confirmation', 'single-contact')) OR (
              tool_name = 'browser' AND json_valid(input_summary) = 1
              AND json_extract(input_summary, '$.action') IN ('type', 'press', 'goto')
            )
          )
        ) AS unsafeSuccessfulActions
      FROM task_runs
      WHERE channel = ? AND mode = 'screen' AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `).get(channel) as ChannelScreenEvidence | undefined ?? null;
  } catch {
    return null;
  }
}

function channelLabel(channel: Channel): string {
  switch (channel) {
    case 'boss': return 'BOSS';
    case 'maimai': return '脉脉';
    case 'linkedin': return 'LinkedIn';
    case 'followup': return 'Followup';
  }
}

function liveDryRunDetail(channel: Channel, evidence: ChannelDryRunEvidence | null): string {
  const label = channelLabel(channel);
  return evidence
    ? `latest dry-run #${evidence.id}: status=${evidence.status}, contacted=${evidence.contactedCount}, candidates=${evidence.runCandidates}, interactions=${evidence.interactions}, actions=${evidence.runActions}, toolCalls=${evidence.toolCalls}, sideEffects=${evidence.sideEffects}`
    : `no ${label} dry-run evidence; run hireseek run ${channel} --here --dry-run before real outreach`;
}

function livePrepareDetail(channel: Channel, evidence: ChannelPrepareEvidence | null): string {
  const label = channelLabel(channel);
  return evidence
    ? `latest prepare #${evidence.id}: status=${evidence.status}, contacted=${evidence.contactedCount}, candidates=${evidence.runCandidates}, interactions=${evidence.interactions}, actions=${evidence.runActions}, toolCalls=${evidence.toolCalls}, successfulSideEffects=${evidence.successfulSideEffects}, unsafeSuccessfulActions=${evidence.unsafeSuccessfulActions}`
    : `no ${label} prepare evidence; run hireseek run ${channel} --here --prepare before real outreach`;
}

function liveScreenDetail(channel: Channel, evidence: ChannelScreenEvidence | null): string {
  const label = channelLabel(channel);
  return evidence
    ? `latest screen #${evidence.id}: status=${evidence.status}, contacted=${evidence.contactedCount}, candidates=${evidence.runCandidates}, interactions=${evidence.interactions}, actions=${evidence.runActions}, toolCalls=${evidence.toolCalls}, candidateScreenActions=${evidence.candidateScreenActions}, screenCandidates=${evidence.screenCandidates}, recommendedContacts=${evidence.recommendedContacts}, successfulSideEffects=${evidence.successfulSideEffects}, unsafeSuccessfulActions=${evidence.unsafeSuccessfulActions}`
    : `no ${label} screen evidence; run hireseek run ${channel} --here --screen before real outreach`;
}

function browserReadinessDetail(summary: BrowserReadinessSummary): string {
  if (summary.reports.length === 0) return 'no enabled protocol channels to probe';
  return [
    `ready=${summary.ready}, notReady=${summary.notReady}, unavailable=${summary.unavailable}`,
    summary.reports.map(report => {
      const label = channelLabel(report.channel);
      const issue = report.issues[0] ? ` (${report.issues[0]})` : '';
      return `${label}:${report.status}${issue}`;
    }).join(' | '),
  ].join('; ');
}

export function collectDoctorReport(registry?: ToolRegistry): DoctorReport {
  const runtime = createRuntimeContext();
  const checks: DoctorCheck[] = [];

  checks.push(check(
    'lower',
    'RuntimeContext',
    runtime.activeJob ? 'pass' : 'warn',
    runtime.activeJob
      ? `active job=${runtime.activeJob.title}, channels=${runtime.enabledChannels.map(c => `${c.channel}x${c.accounts}`).join(', ') || 'none'}`
      : 'active job missing; sourcing can still boot, but product context is incomplete',
  ));

  checks.push(check(
    'lower',
    'Workspace path',
    pathState(runtime.paths.workspaceDir),
    runtime.paths.workspaceDir,
  ));

  checks.push(check(
    'lower',
    'Knowledge home',
    runtime.paths.knowledgeHome ? pathState(runtime.paths.knowledgeHome) : 'warn',
    runtime.paths.knowledgeHome || 'not configured',
  ));

  if (registry) {
    const issues = registry.validate();
    const required = ['core_status', 'product_doctor', 'platform_protocols', 'recruiting_capabilities', 'run_sourcing'];
    const missing = required.filter(name => !registry.get(name));
    const status: DoctorStatus = issues.length || missing.length ? 'fail' : 'pass';
    checks.push(check(
      'lower',
      'Tool registry',
      status,
      status === 'pass'
        ? `${registry.list().length} tools registered; schema/policy validation passed`
        : `validation issues=${issues.length}, missing required tools=${missing.join(', ') || 'none'}`,
    ));
  } else {
    checks.push(check('lower', 'Tool registry', 'warn', 'registry not supplied; run from CLI/chat to verify tools'));
  }

  const runnerRegistries = [DOM_RUNNER_TOOL_REGISTRY, GENERIC_VISION_TOOL_REGISTRY];
  const runnerIssues = runnerRegistries.flatMap(runnerRegistry => runnerRegistry.validate());
  const runnerTools = new Set(runnerRegistries.flatMap(runnerRegistry =>
    runnerRegistry.list().map(tool => tool.name),
  ));
  checks.push(check(
    'lower',
    'Runner tool registry',
    runnerIssues.length === 0 && runnerTools.has('browser') && runnerTools.has('computer')
      ? 'pass'
      : 'fail',
    runnerIssues.length === 0
      ? `registered runner tools=${[...runnerTools].sort().join(', ')}`
      : `validation issues=${runnerIssues.map(issue => `${issue.tool}:${issue.problem}`).join(', ')}`,
  ));

  const protocols = listPlatformProtocols();
  const protocolChannels = protocols.map(protocol => protocol.channel);
  const harnessModes = ['dry_run', 'prepare', 'screen', 'execute'] as const;
  const harnessAssemblyProblems = protocolChannels.flatMap(channel => harnessModes.flatMap(mode => {
    const assembly = buildHarnessRunAssembly(channel, mode);
    const declared = new Set(assembly.tools.filter(tool => tool.declaredToModel).map(tool => tool.name));
    const problems: string[] = [];
    const prefix = `${channel}/${mode}`;
    if (!declared.has('browser')) problems.push(`${prefix}:browser missing`);
    if ((mode === 'dry_run' || mode === 'prepare') && declared.size !== 1) {
      problems.push(`${prefix}:should only declare browser`);
    }
    if (
      mode === 'screen' &&
      (!declared.has('record_screened_candidate') || declared.has('prepare_contact') || declared.has('record_contacted'))
    ) {
      problems.push(`${prefix}:screen tool disclosure mismatch`);
    }
    if (
      mode === 'execute' &&
      (!declared.has('prepare_contact') || !declared.has('record_contacted') || declared.has('record_screened_candidate'))
    ) {
      problems.push(`${prefix}:execute tool disclosure mismatch`);
    }
    if (assembly.platformProtocol && !assembly.boundaries.includes('platform-protocol-overrides-legacy-skill')) {
      problems.push(`${prefix}:missing protocol/skill boundary`);
    }
    return problems;
  }));
  checks.push(check(
    'lower',
    'Harness run assembly',
    protocolChannels.length > 0 && harnessAssemblyProblems.length === 0 ? 'pass' : 'fail',
    harnessAssemblyProblems.length === 0
      ? `mode-specific tool/context assembly is explicit for ${protocolChannels.join(', ')} dry_run/prepare/screen/execute`
      : harnessAssemblyProblems.join('; '),
  ));

  const chatHarnessContext = buildChatHarnessContext();
  const chatHarnessProblems = [
    chatHarnessContext.includes('HireSeek Chat Harness Assembly') ? '' : 'missing chat harness header',
    ...protocols.map(protocol => chatHarnessContext.includes(protocol.name) ? '' : `missing ${protocol.channel} platform protocol`),
    chatHarnessContext.includes('platform-protocol-overrides-legacy-skill') ? '' : 'missing protocol/skill boundary',
    chatHarnessContext.includes('mode=productized-fallback-only') ? '' : 'missing productized fallback skill mode',
  ].filter(Boolean);
  checks.push(check(
    'lower',
    'Chat harness assembly',
    chatHarnessProblems.length === 0 ? 'pass' : 'fail',
    chatHarnessProblems.length === 0
      ? 'chat prompt includes platform protocol, capability, and skill asset boundaries'
      : chatHarnessProblems.join('; '),
  ));

  const chatSystemPrompt = (() => {
    try {
      const { buildSystemPrompt } = require('./chat') as typeof import('./chat');
      return buildSystemPrompt();
    } catch {
      return '';
    }
  })();
  const enabledMemoryChannels = runtime.enabledChannels.map(channel => channel.channel);
  const chatMemoryProblems = [
    chatSystemPrompt.includes('多渠道记忆上下文') ? '' : 'missing multi-channel memory context',
    ...enabledMemoryChannels.map(channel => (
      chatSystemPrompt.includes(`今日进度（${channel}）`) ? '' : `missing ${channel} memory`
    )),
  ].filter(Boolean);
  checks.push(check(
    'lower',
    'Chat memory assembly',
    chatMemoryProblems.length === 0 ? 'pass' : 'warn',
    chatMemoryProblems.length === 0
      ? 'chat prompt includes memory for enabled channels'
      : chatMemoryProblems.join('; '),
  ));

  const interactionModelProblems = collectInteractionModelProblems();
  checks.push(check(
    'lower',
    'Interaction model',
    interactionModelProblems.length === 0 ? 'pass' : 'fail',
    interactionModelProblems.length === 0
      ? 'slash and ask-user use editable suggestions; hard selectors are limited to closed system menus'
      : interactionModelProblems.join('; '),
  ));

  const agentTables = [
    'agent_tool_calls',
    'agent_run_states',
    'agent_execution_environments',
    'agent_context_compactions',
    'agent_run_assemblies',
    'agent_sessions',
    'agent_messages',
    'agent_memory_raw',
    'agent_memory_episodic',
    'agent_memory_semantic',
  ];
  const missingAgentTables = agentTables.filter(name => !tableExists(name));
  checks.push(check(
    'lower',
    'Agent Core storage',
    missingAgentTables.length ? 'fail' : 'pass',
    missingAgentTables.length ? `missing tables: ${missingAgentTables.join(', ')}` : 'tool trace, run state, execution environment, run assembly, context compaction, session/message history, and memory tables exist',
  ));

  const sessionIntegrity = collectSessionIntegrityReport(20);
  checks.push(check(
    'lower',
    'Session history integrity',
    sessionIntegrity.issues.length ? 'warn' : 'pass',
    sessionIntegrity.issues.length
      ? `${sessionIntegrity.issues.length} issue(s): ${sessionIntegrity.issues.slice(0, 3).map(issue => `${issue.sessionId}:${issue.problem}`).join(', ')}`
      : `checked=${sessionIntegrity.checkedSessions}, resumable=${sessionIntegrity.resumableSessions}, messages=${sessionIntegrity.totalMessages}`,
  ));

  const toolColumns = tableColumns('agent_tool_calls');
  checks.push(check(
    'lower',
    'Tool trace stage column',
    toolColumns.has('stage_id') ? 'pass' : 'fail',
    toolColumns.has('stage_id') ? 'agent_tool_calls.stage_id exists' : 'agent_tool_calls.stage_id missing',
  ));

  const runActionColumns = tableColumns('run_actions');
  checks.push(check(
    'lower',
    'Run trace stage column',
    runActionColumns.has('stage_id') ? 'pass' : tableExists('run_actions') ? 'fail' : 'warn',
    runActionColumns.has('stage_id')
      ? 'run_actions.stage_id exists'
      : tableExists('run_actions')
        ? 'run_actions exists but stage_id is missing'
        : 'run_actions has not been initialized yet; it will be created by compliance/run trace code',
  ));
  checks.push(check(
    'lower',
    'Run trace action label column',
    runActionColumns.has('action_label') ? 'pass' : tableExists('run_actions') ? 'fail' : 'warn',
    runActionColumns.has('action_label')
      ? 'run_actions.action_label exists'
      : tableExists('run_actions')
        ? 'run_actions exists but action_label is missing'
        : 'run_actions has not been initialized yet; it will be created by compliance/run trace code',
  ));

  const pendingRunStates = recentPendingRunStateDetails();
  checks.push(check(
    'lower',
    'Pending run states',
    pendingRunStates.length ? 'warn' : 'pass',
    pendingRunStates.length
      ? pendingRunStates.join(' | ')
      : 'no paused/failed run states in the last 24h',
  ));

  const staleTaskRuns = listStaleTaskRuns(360, 5);
  const inconsistentRunStates = listInconsistentRunStates(5);
  const staleExecutionEnvironments = listStaleExecutionEnvironments(5);
  checks.push(check(
    'lower',
    'Task run lifecycle',
    staleTaskRuns.length || inconsistentRunStates.length || staleExecutionEnvironments.length ? 'warn' : 'pass',
    [
      staleTaskRuns.length
        ? `stale=${staleTaskRuns.map(run => `#${run.id} ${run.channel}/${run.mode} ${run.ageMinutes}m`).join(' | ')}`
        : 'no stale running task_runs older than 6h',
      inconsistentRunStates.length
        ? `inconsistent=${inconsistentRunStates.map(row => `#${row.runId} task=${row.taskStatus ?? 'missing'} state=${row.runStateStatus}`).join(' | ')}`
        : 'no running run_states for closed task_runs',
      staleExecutionEnvironments.length
        ? `env=${staleExecutionEnvironments.map(env => `${env.id} run#${env.runId ?? 'none'} task=${env.taskStatus ?? 'missing'}`).join(' | ')}`
        : 'no active environments for closed task_runs',
    ].join('; '),
  ));

  const compactionColumns = tableColumns('agent_context_compactions');
  const compactionRequiredColumns = [
    'session_id',
    'original_tokens',
    'compressed_tokens',
    'original_messages',
    'compressed_messages',
    'summary',
  ];
  const missingCompactionColumns = compactionRequiredColumns.filter(column => !compactionColumns.has(column));
  checks.push(check(
    'lower',
    'Context compaction ledger',
    missingCompactionColumns.length ? 'fail' : 'pass',
    missingCompactionColumns.length
      ? `missing columns: ${missingCompactionColumns.join(', ')}`
      : 'context compression events are auditable',
  ));

  const runAssemblyColumns = tableColumns('agent_run_assemblies');
  const runAssemblyRequiredColumns = [
    'run_id',
    'provider',
    'model',
    'context_blocks_json',
    'tools_json',
    'boundaries_json',
    'environments_json',
    'system_prompt_hash',
    'task_prompt_hash',
  ];
  const missingRunAssemblyColumns = runAssemblyRequiredColumns.filter(column => !runAssemblyColumns.has(column));
  const recentRunAssemblies = latestRunAssemblySnapshots(3);
  checks.push(check(
    'lower',
    'Run assembly ledger',
    missingRunAssemblyColumns.length ? 'fail' : 'pass',
    missingRunAssemblyColumns.length
      ? `missing columns: ${missingRunAssemblyColumns.join(', ')}`
      : recentRunAssemblies.length
        ? `latest=${recentRunAssemblies.map(row => `#${row.runId} ${row.channel}/${row.mode}/${row.provider}`).join(' | ')}`
        : 'run assembly table is ready; no run snapshots recorded yet',
  ));

  const memoryGovernanceColumns = ['inject_allowed', 'expires_at', 'archived_at'];
  const memoryGovernanceMissing = [
    'agent_memory_raw',
    'agent_memory_episodic',
    'agent_memory_semantic',
  ].flatMap(table => {
    const columns = tableColumns(table);
    return memoryGovernanceColumns
      .filter(column => !columns.has(column))
      .map(column => `${table}.${column}`);
  });
  checks.push(check(
    'lower',
    'Memory governance columns',
    memoryGovernanceMissing.length ? 'fail' : 'pass',
    memoryGovernanceMissing.length
      ? `missing columns: ${memoryGovernanceMissing.join(', ')}`
      : 'memory lifecycle and context-injection controls exist',
  ));

  const failureReport = collectHarnessFailureReport(12);
  const unknownFailures = failureReport.byCode.unknown ?? 0;
  checks.push(check(
    'lower',
    'Harness failure classifier',
    unknownFailures > 0 ? 'warn' : 'pass',
    failureReport.total === 0
      ? 'no recent harness failures to classify'
      : `classified ${failureReport.total} recent failure signal(s); unknown=${unknownFailures}; codes=${Object.entries(failureReport.byCode).map(([code, n]) => `${code}:${n}`).join(', ')}`,
  ));

  const boss = protocols.find(protocol => protocol.channel === 'boss');
  const maimai = protocols.find(protocol => protocol.channel === 'maimai');
  checks.push(check(
    'middle',
    'Platform protocols',
    boss && maimai ? 'pass' : 'fail',
    boss && maimai
      ? `${protocols.length} protocol(s): ${protocols.map(protocol => `${protocol.channel}=${protocol.name}`).join(', ')}`
      : `missing protocol(s): ${[
        boss ? '' : 'boss',
        maimai ? '' : 'maimai',
      ].filter(Boolean).join(', ')}`,
  ));

  const screenGateProblems = protocols
    .filter(protocol => (protocol.requiredStagesBeforeContact ?? []).includes('candidate-screen'))
    .flatMap(protocol => {
      const problems: string[] = [];
      if (!channelUsesScreenContactGate(protocol.channel, 'execute')) {
        problems.push(`${protocol.channel}:execute missing screen gate`);
      }
      if (channelUsesScreenContactGate(protocol.channel, 'prepare')) {
        problems.push(`${protocol.channel}:prepare must not require screen gate`);
      }
      if (channelUsesScreenContactGate(protocol.channel, 'screen')) {
        problems.push(`${protocol.channel}:screen must not require prior screen gate`);
      }
      if (channelUsesScreenContactGate(protocol.channel, 'dry_run')) {
        problems.push(`${protocol.channel}:dry_run must not require screen gate`);
      }
      return problems;
    });
  checks.push(check(
    'middle',
    'Screen contact gate',
    screenGateProblems.length === 0 ? 'pass' : 'fail',
    screenGateProblems.length === 0
      ? 'execute mode requires latest screen whitelist for protocol channels with candidate-screen'
      : screenGateProblems.join('; '),
  ));

  const protocolManifest = buildPlatformProtocolManifest();
  const protocolProblems = protocolManifest.flatMap(entry => {
    const problems: string[] = [];
    if (entry.version <= 0) problems.push(`${entry.channel}:version missing`);
    if (!entry.contractName) problems.push(`${entry.channel}:contract missing`);
    if (entry.writes.length === 0) problems.push(`${entry.channel}:writes empty`);
    if (entry.stageCount === 0) problems.push(`${entry.channel}:stages empty`);
    const duplicateStages = entry.stageIds.filter((id, index, ids) => ids.indexOf(id) !== index);
    if (duplicateStages.length) problems.push(`${entry.channel}:duplicate stages ${[...new Set(duplicateStages)].join(',')}`);
    const missingHooks = Object.entries(entry.hooks)
      .filter(([, present]) => !present)
      .map(([hook]) => hook);
    if (missingHooks.length) problems.push(`${entry.channel}:missing hooks ${missingHooks.join(',')}`);
    const contractWrites = contractWritesForChannel(entry.channel);
    const missingContractWrites = contractWrites.filter(write => !entry.writes.includes(write));
    const extraProtocolWrites = entry.writes.filter(write => !contractWrites.includes(write));
    if (missingContractWrites.length) problems.push(`${entry.channel}:missing contract writes ${missingContractWrites.join(',')}`);
    if (extraProtocolWrites.length) problems.push(`${entry.channel}:extra writes ${extraProtocolWrites.join(',')}`);
    return problems;
  });
  checks.push(check(
    'middle',
    'Platform protocol manifest',
    protocolManifest.length > 0 && protocolProblems.length === 0 ? 'pass' : 'fail',
    protocolProblems.length
      ? protocolProblems.join('; ')
      : `${protocolManifest.length} protocol manifest entr${protocolManifest.length === 1 ? 'y' : 'ies'} with contract-aligned writes`,
  ));

  for (const protocol of protocols) {
    const entry = protocolManifest.find(item => item.channel === protocol.channel);
    const label = channelLabel(protocol.channel);
    checks.push(check(
      'middle',
      `${label} protocol wiring`,
      entry && protocolProblems.every(problem => !problem.startsWith(`${protocol.channel}:`)) ? 'pass' : 'fail',
      entry
        ? `contract=${entry.contractName}, stages=${entry.stageCount}, writes=${entry.writes.join(', ')}`
        : `${protocol.channel} protocol manifest missing`,
    ));
  }

  const capabilities = listRecruitingCapabilities();
  const missingSources = capabilities.flatMap(capability =>
    missingWorkspaceSources(capability.sourceFiles, runtime.paths.workspaceDir)
      .map(file => `${capability.id}:${file}`),
  );
  checks.push(check(
    'middle',
    'Recruiting capabilities',
    capabilities.length && missingSources.length === 0 ? 'pass' : missingSources.length ? 'warn' : 'fail',
    capabilities.length
      ? `${capabilities.length} capability module(s); missing sources=${missingSources.length ? missingSources.join(', ') : 'none'}`
      : 'no capability modules registered',
  ));

  const capabilityManifest = buildRecruitingCapabilityManifest();
  const duplicateCapabilityIds = capabilityManifest
    .map(entry => entry.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  const manifestProblems = capabilityManifest.flatMap(entry => {
    const problems: string[] = [];
    if (!/\.v\d+$/.test(entry.id)) problems.push(`${entry.id}:id missing .vN suffix`);
    if (entry.version <= 0) problems.push(`${entry.id}:version must be positive`);
    if (entry.contract.produces.length === 0) problems.push(`${entry.id}:contract.produces empty`);
    if (entry.contract.constraints.length === 0) problems.push(`${entry.id}:contract.constraints empty`);
    if (entry.sourceFiles.some(file => !file.exists || file.bytes === 0)) problems.push(`${entry.id}:missing or empty source`);
    return problems;
  });
  const priorities = capabilityManifest.map(entry => entry.priority);
  const duplicatePriorities = priorities.filter((priority, index) => priorities.indexOf(priority) !== index);
  checks.push(check(
    'middle',
    'Capability manifest',
    capabilityManifest.length > 0 && duplicateCapabilityIds.length === 0 && duplicatePriorities.length === 0 && manifestProblems.length === 0
      ? 'pass'
      : 'fail',
    manifestProblems.length || duplicateCapabilityIds.length || duplicatePriorities.length
      ? [
        duplicateCapabilityIds.length ? `duplicate ids=${[...new Set(duplicateCapabilityIds)].join(', ')}` : '',
        duplicatePriorities.length ? `duplicate priorities=${[...new Set(duplicatePriorities)].join(', ')}` : '',
        manifestProblems.join(', '),
      ].filter(Boolean).join('; ')
      : `${capabilityManifest.length} manifest entries with explicit contracts`,
  ));

  for (const channel of protocolChannels) {
    const label = channelLabel(channel);
    const prepare = latestChannelPrepareEvidence(channel);
    checks.push(check(
      'upper',
      `Live ${label} prepare`,
      hasPassingChannelPrepareEvidence(prepare) ? 'pass' : 'warn',
      livePrepareDetail(channel, prepare),
    ));

    const screen = latestChannelScreenEvidence(channel);
    checks.push(check(
      'upper',
      `Live ${label} screen`,
      hasPassingChannelScreenEvidence(screen) ? 'pass' : 'warn',
      liveScreenDetail(channel, screen),
    ));

    const dryRun = latestChannelDryRunEvidence(channel);
    checks.push(check(
      'upper',
      `Live ${label} run`,
      hasPassingChannelDryRunEvidence(dryRun) ? 'pass' : 'warn',
      liveDryRunDetail(channel, dryRun),
    ));
  }

  const browserReadiness = probeBrowserReadinessManySync(protocolChannels);
  checks.push(check(
    'upper',
    'Browser readiness',
    browserReadiness.ok ? 'pass' : 'warn',
    browserReadinessDetail(browserReadiness),
  ));

  const skillHomes = runtime.paths.skillHomes;
  const existingSkillHomes = skillHomes.filter(home => fs.existsSync(home));
  const externalSkills = listClaudeSkills();
  const hasBossSkill = externalSkills.some(skill => /boss|boss直聘|bossz/i.test(`${skill.name} ${skill.description}`));
  const hasMaimaiSkill = externalSkills.some(skill => /maimai|脉脉/i.test(`${skill.name} ${skill.description}`));
  checks.push(check(
    'external',
    'External skill homes',
    runtime.flags.externalSkillsEnabled && existingSkillHomes.length > 0 ? 'pass' : 'warn',
    `enabled=${runtime.flags.externalSkillsEnabled}; homes=${existingSkillHomes.length}/${skillHomes.length}; skills=${externalSkills.length}`,
  ));
  checks.push(check(
    'external',
    'Legacy BOSS skill availability',
    hasBossSkill ? 'pass' : 'warn',
    hasBossSkill ? 'BOSS skill asset is visible as external knowledge/fallback' : 'no BOSS external skill found in configured homes',
  ));
  checks.push(check(
    'external',
    'Legacy 脉脉 skill availability',
    hasMaimaiSkill ? 'pass' : 'warn',
    hasMaimaiSkill ? '脉脉 skill asset is visible as external knowledge/fallback' : 'no 脉脉 external skill found in configured homes',
  ));
  checks.push(check(
    'external',
    'Productized channel skill preload',
    runtime.flags.legacySkillPreload ? 'warn' : 'pass',
    runtime.flags.legacySkillPreload
      ? 'full legacy skill preload is enabled and may override product protocols'
      : 'full legacy skill is not preloaded; external skill remains available to CC/Codex and explicit fallback',
  ));

  const skillAssetManifest = buildSkillAssetManifest();
  const skillAssetProblems = skillAssetManifest.flatMap(entry => {
    const problems: string[] = [];
    if (!entry.activeAsset) problems.push(`${entry.channel}:no active skill asset`);
    if (entry.productProtocol && entry.mode !== 'productized-fallback-only') {
      problems.push(`${entry.channel}:productized channel should use fallback-only mode`);
    }
    if (entry.productProtocol && !entry.boundary.mustNotOverride.includes('platform-protocol')) {
      problems.push(`${entry.channel}:missing platform-protocol boundary`);
    }
    return problems;
  });
  checks.push(check(
    'external',
    'Skill asset manifest',
    skillAssetProblems.length ? 'warn' : 'pass',
    skillAssetProblems.length
      ? skillAssetProblems.join('; ')
      : `${skillAssetManifest.length} channel skill asset entr${skillAssetManifest.length === 1 ? 'y' : 'ies'} with explicit product boundaries`,
  ));

  const status = worstStatus(checks.map(c => c.status));
  const nextSteps: string[] = [];
  if (status === 'fail') nextSteps.push('先修复 fail 项，再跑真实渠道任务。');
  if (checks.some(c => c.name === 'Browser readiness' && c.status === 'warn')) {
    nextSteps.push('可直接运行 `hireseek validate` 做 active job 全渠道验收；readiness 没过就不创建 run。');
    nextSteps.push('浏览器 readiness 未全绿：先运行 `hireseek readiness` 查看哪个渠道缺登录页或权限。');
  }
  for (const channel of protocolChannels) {
    const label = channelLabel(channel);
    if (checks.some(c => c.name === `Live ${label} run` && c.status === 'warn')) {
      nextSteps.push(`可直接运行 \`hireseek validate ${channel}\`；它会先做 readiness，没通过就不创建 run。`);
      nextSteps.push(`先运行 \`hireseek readiness ${channel}\`，确认当前 Chrome 登录态和页面适合真实验收。`);
      nextSteps.push(`真实页面验收从 \`hireseek run ${channel} --here --dry-run\` 开始，不要直接真实触达。`);
    }
    if (checks.some(c => c.name === `Live ${label} prepare` && c.status === 'warn')) {
      nextSteps.push(`真实触达前运行 \`hireseek run ${channel} --here --prepare\`，确认页面准备和筛选提交安全通过。`);
    }
    if (checks.some(c => c.name === `Live ${label} screen` && c.status === 'warn')) {
      nextSteps.push(`真实触达前运行 \`hireseek run ${channel} --here --screen\`，确认候选人查看与筛选判断安全通过。`);
    }
  }
  if (checks.some(c => c.name === 'Pending run states' && c.status === 'warn')) {
    nextSteps.push('有暂停/失败的 run state：先用 `hireseek core` 查看停在哪，再从当前真实页面继续。');
  }
  if (checks.some(c => c.name === 'Task run lifecycle' && c.status === 'warn')) {
    nextSteps.push('有超时 running run：先用 `hireseek runs cleanup` 预览，再用 `hireseek runs cleanup --apply` 收口。');
  }
  if (checks.some(c => c.layer === 'middle' && c.status !== 'pass')) {
    nextSteps.push('中层协议/能力不完整时，先补产品协议，不回退到复制 skill。');
  }

  return { status, checks, nextSteps };
}

function statusLabel(status: DoctorStatus): string {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

function layerLabel(layer: DoctorLayer): string {
  switch (layer) {
    case 'lower': return '下层 Agent Core';
    case 'middle': return '中层协议/能力';
    case 'upper': return '上层工作流';
    case 'external': return '外部 skill 边界';
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const grouped = new Map<DoctorLayer, DoctorCheck[]>();
  for (const item of report.checks) {
    const rows = grouped.get(item.layer) ?? [];
    rows.push(item);
    grouped.set(item.layer, rows);
  }

  const lines = [
    'HireSeek Doctor',
    '',
    `Overall: ${statusLabel(report.status)}`,
  ];

  for (const layer of ['lower', 'middle', 'upper', 'external'] as DoctorLayer[]) {
    const rows = grouped.get(layer) ?? [];
    if (rows.length === 0) continue;
    lines.push('', layerLabel(layer));
    for (const row of rows) {
      lines.push(`- ${statusLabel(row.status)} ${row.name}: ${row.detail}`);
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push('', 'Next steps');
    lines.push(...report.nextSteps.map(step => `- ${step}`));
  }

  return lines.join('\n');
}
