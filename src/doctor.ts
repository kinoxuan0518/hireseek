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
    missingAgentTables.length ? `missing tables: ${missingAgentTables.join(', ')}` : 'tool trace, session/message history, and memory tables exist',
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
