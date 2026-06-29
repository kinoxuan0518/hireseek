import fs from 'fs';
import path from 'path';
import { db } from './db';
import { createRuntimeContext } from './agent-core/runtime-context';
import type { ToolRegistry } from './agent-core/tool-registry';
import { listPlatformProtocols } from './platform-protocols';
import { listRecruitingCapabilities } from './capabilities';
import { listClaudeSkills } from './skills/claude-skills';
import { DOM_RUNNER_TOOL_REGISTRY } from './runners/dom-runner';
import { GENERIC_VISION_TOOL_REGISTRY } from './runners/generic-vision';
import { listPendingAgentRunStates } from './agent-core/run-state-store';
import { collectHarnessFailureReport } from './agent-core/failure-classifier';

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

export interface BossDryRunEvidence {
  id: number;
  status: string;
  contactedCount: number;
  runCandidates: number;
  interactions: number;
  runActions: number;
  toolCalls: number;
  sideEffects: number;
}

export interface BossPrepareEvidence extends BossDryRunEvidence {
  successfulSideEffects: number;
  unsafeSuccessfulActions: number;
}

export interface BossScreenEvidence extends BossPrepareEvidence {
  candidateScreenActions: number;
  screenCandidates: number;
  recommendedContacts: number;
}

export function hasPassingBossDryRunEvidence(evidence: BossDryRunEvidence | null): boolean {
  return !!evidence
    && evidence.status === 'completed'
    && evidence.contactedCount === 0
    && evidence.runCandidates === 0
    && evidence.interactions === 0
    && evidence.runActions > 0
    && evidence.toolCalls > 0
    && evidence.sideEffects === 0;
}

function latestBossDryRunEvidence(): BossDryRunEvidence | null {
  try {
    return db.prepare(`
      SELECT
        task_runs.id,
        task_runs.status,
        task_runs.contacted_count AS contactedCount,
        (SELECT COUNT(*) FROM run_candidates WHERE run_id = task_runs.id) AS runCandidates,
        (SELECT COUNT(*) FROM interaction_log WHERE run_id = task_runs.id) AS interactions,
        (SELECT COUNT(*) FROM run_actions WHERE run_id = task_runs.id) AS runActions,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id) AS toolCalls,
        (SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = task_runs.id AND side_effect = 1) AS sideEffects
      FROM task_runs
      WHERE channel = 'boss' AND mode = 'dry_run'
      ORDER BY id DESC
      LIMIT 1
    `).get() as BossDryRunEvidence | undefined ?? null;
  } catch {
    return null;
  }
}

export function hasPassingBossPrepareEvidence(evidence: BossPrepareEvidence | null): boolean {
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

function latestBossPrepareEvidence(): BossPrepareEvidence | null {
  try {
    return db.prepare(`
      SELECT
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
            tool_name = 'record_contacted' OR (
              tool_name = 'browser' AND json_valid(input_summary) = 1
              AND json_extract(input_summary, '$.action') IN ('type', 'press', 'goto')
            )
          )
        ) AS unsafeSuccessfulActions
      FROM task_runs
      WHERE channel = 'boss' AND mode = 'prepare'
      ORDER BY id DESC
      LIMIT 1
    `).get() as BossPrepareEvidence | undefined ?? null;
  } catch {
    return null;
  }
}

export function hasPassingBossScreenEvidence(evidence: BossScreenEvidence | null): boolean {
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

function latestBossScreenEvidence(): BossScreenEvidence | null {
  try {
    return db.prepare(`
      SELECT
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
            (tool_name != 'record_contacted' AND stage_id = 'single-contact') OR (
              tool_name = 'browser' AND json_valid(input_summary) = 1
              AND json_extract(input_summary, '$.action') IN ('type', 'press', 'goto')
            )
          )
        ) AS unsafeSuccessfulActions
      FROM task_runs
      WHERE channel = 'boss' AND mode = 'screen'
      ORDER BY id DESC
      LIMIT 1
    `).get() as BossScreenEvidence | undefined ?? null;
  } catch {
    return null;
  }
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

  const agentTables = [
    'agent_tool_calls',
    'agent_run_states',
    'agent_execution_environments',
    'agent_context_compactions',
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
    missingAgentTables.length ? `missing tables: ${missingAgentTables.join(', ')}` : 'tool trace, run state, execution environment, context compaction, session/message history, and memory tables exist',
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

  const protocols = listPlatformProtocols();
  const boss = protocols.find(protocol => protocol.channel === 'boss');
  checks.push(check(
    'middle',
    'Platform protocols',
    boss ? 'pass' : 'fail',
    boss ? `${protocols.length} protocol(s), boss=${boss.name}` : 'boss protocol missing',
  ));
  if (boss) {
    const stageCount = boss.stageManifest?.().length ?? 0;
    const missing: string[] = [];
    if (!boss.contractName) missing.push('contract');
    if (!boss.buildSystemContext) missing.push('system context');
    if (!boss.browserActionPolicy) missing.push('browser action policy');
    if (!boss.completionPolicy) missing.push('completion policy');
    if (!boss.processRules) missing.push('process rules');
    if (stageCount === 0) missing.push('stage manifest');
    checks.push(check(
      'middle',
      'BOSS protocol wiring',
      missing.length ? 'fail' : 'pass',
      missing.length ? `missing: ${missing.join(', ')}` : `contract=${boss.contractName}, stages=${stageCount}`,
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

  const prepare = latestBossPrepareEvidence();
  const preparePassed = hasPassingBossPrepareEvidence(prepare);
  checks.push(check(
    'upper',
    'Live BOSS prepare',
    preparePassed ? 'pass' : 'warn',
    prepare
      ? `latest prepare #${prepare.id}: status=${prepare.status}, contacted=${prepare.contactedCount}, candidates=${prepare.runCandidates}, interactions=${prepare.interactions}, actions=${prepare.runActions}, toolCalls=${prepare.toolCalls}, successfulSideEffects=${prepare.successfulSideEffects}, unsafeSuccessfulActions=${prepare.unsafeSuccessfulActions}`
      : 'no BOSS prepare evidence; run hireseek run boss --here --prepare before real outreach',
  ));

  const screen = latestBossScreenEvidence();
  const screenPassed = hasPassingBossScreenEvidence(screen);
  checks.push(check(
    'upper',
    'Live BOSS screen',
    screenPassed ? 'pass' : 'warn',
    screen
      ? `latest screen #${screen.id}: status=${screen.status}, contacted=${screen.contactedCount}, candidates=${screen.runCandidates}, interactions=${screen.interactions}, actions=${screen.runActions}, toolCalls=${screen.toolCalls}, candidateScreenActions=${screen.candidateScreenActions}, screenCandidates=${screen.screenCandidates}, recommendedContacts=${screen.recommendedContacts}, successfulSideEffects=${screen.successfulSideEffects}, unsafeSuccessfulActions=${screen.unsafeSuccessfulActions}`
      : 'no BOSS screen evidence; run hireseek run boss --here --screen before real outreach',
  ));

  const dryRun = latestBossDryRunEvidence();
  const dryRunPassed = hasPassingBossDryRunEvidence(dryRun);
  checks.push(check(
    'upper',
    'Live BOSS run',
    dryRunPassed ? 'pass' : 'warn',
    dryRun
      ? `latest dry-run #${dryRun.id}: status=${dryRun.status}, contacted=${dryRun.contactedCount}, candidates=${dryRun.runCandidates}, interactions=${dryRun.interactions}, actions=${dryRun.runActions}, toolCalls=${dryRun.toolCalls}, sideEffects=${dryRun.sideEffects}`
      : 'no BOSS dry-run evidence; run hireseek run boss --here --dry-run before real outreach',
  ));

  const skillHomes = runtime.paths.skillHomes;
  const existingSkillHomes = skillHomes.filter(home => fs.existsSync(home));
  const externalSkills = listClaudeSkills();
  const hasBossSkill = externalSkills.some(skill => /boss|boss直聘|bossz/i.test(`${skill.name} ${skill.description}`));
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
    'Productized channel skill preload',
    runtime.flags.legacySkillPreload ? 'warn' : 'pass',
    runtime.flags.legacySkillPreload
      ? 'full legacy skill preload is enabled and may override product protocols'
      : 'full legacy skill is not preloaded; external skill remains available to CC/Codex and explicit fallback',
  ));

  const status = worstStatus(checks.map(c => c.status));
  const nextSteps: string[] = [];
  if (status === 'fail') nextSteps.push('先修复 fail 项，再跑真实渠道任务。');
  if (checks.some(c => c.name === 'Live BOSS run' && c.status === 'warn')) {
    nextSteps.push('真实页面验收从 `hireseek run boss --here --dry-run` 开始，不要直接真实触达。');
  }
  if (checks.some(c => c.name === 'Pending run states' && c.status === 'warn')) {
    nextSteps.push('有暂停/失败的 run state：先用 `hireseek core` 查看停在哪，再从当前真实页面继续。');
  }
  if (checks.some(c => c.name === 'Live BOSS prepare' && c.status === 'warn')) {
    nextSteps.push('真实触达前运行 `hireseek run boss --here --prepare`，确认自动切职位和筛选提交安全通过。');
  }
  if (checks.some(c => c.name === 'Live BOSS screen' && c.status === 'warn')) {
    nextSteps.push('真实触达前运行 `hireseek run boss --here --screen`，确认候选人查看与筛选判断安全通过。');
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
