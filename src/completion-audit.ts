import type { DoctorCheck, DoctorReport, DoctorStatus } from './doctor';

export type CompletionBlockerKind =
  | 'browser_readiness'
  | 'external_control'
  | 'live_evidence'
  | 'pending_run_state'
  | 'task_lifecycle'
  | 'product_contract'
  | 'external_skill'
  | 'agent_core'
  | 'unknown';

export interface CompletionBlocker extends DoctorCheck {
  kind: CompletionBlockerKind;
}

export interface CompletionAudit {
  complete: boolean;
  status: DoctorStatus;
  blockers: DoctorCheck[];
  classifiedBlockers?: CompletionBlocker[];
  internalBlockerCount?: number;
  externalValidationBlockerCount?: number;
  nextSteps: string[];
}

export function collectCompletionAudit(report: DoctorReport): CompletionAudit {
  const blockers = report.checks.filter(check => check.status !== 'pass');
  const classifiedBlockers = blockers.map(classifyCompletionBlocker);
  const externalValidationBlockerCount = classifiedBlockers.filter(isExternalValidationBlocker).length;
  return {
    complete: report.status === 'pass' && blockers.length === 0,
    status: report.status,
    blockers,
    classifiedBlockers,
    internalBlockerCount: classifiedBlockers.length - externalValidationBlockerCount,
    externalValidationBlockerCount,
    nextSteps: report.nextSteps,
  };
}

export function classifyCompletionBlocker(check: DoctorCheck): CompletionBlocker {
  if (check.name === 'Browser readiness') return { ...check, kind: 'browser_readiness' };
  if (check.name.startsWith('Live ')) return { ...check, kind: 'live_evidence' };
  if (check.name === 'Pending run states' && /external_control|用户接管|正在使用浏览器|不再是激活标签/.test(check.detail)) {
    return { ...check, kind: 'external_control' };
  }
  if (check.name === 'Pending run states') return { ...check, kind: 'pending_run_state' };
  if (check.name === 'Task run lifecycle') return { ...check, kind: 'task_lifecycle' };
  if (check.layer === 'middle') return { ...check, kind: 'product_contract' };
  if (check.layer === 'external') return { ...check, kind: 'external_skill' };
  if (check.layer === 'lower') return { ...check, kind: 'agent_core' };
  return { ...check, kind: 'unknown' };
}

function statusLabel(status: DoctorStatus): string {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

function blockerKindLabel(kind: CompletionBlockerKind): string {
  switch (kind) {
    case 'browser_readiness': return 'browser readiness';
    case 'external_control': return 'external browser control';
    case 'live_evidence': return 'live validation evidence';
    case 'pending_run_state': return 'pending run state';
    case 'task_lifecycle': return 'task lifecycle';
    case 'product_contract': return 'product contract';
    case 'external_skill': return 'external skill';
    case 'agent_core': return 'agent core';
    case 'unknown': return 'unknown';
  }
}

function blockerKindCounts(blockers: CompletionBlocker[]): string {
  const counts = new Map<CompletionBlockerKind, number>();
  for (const blocker of blockers) {
    counts.set(blocker.kind, (counts.get(blocker.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => `${blockerKindLabel(kind)}=${count}`)
    .join(', ');
}

function isExternalValidationBlocker(blocker: CompletionBlocker): boolean {
  return blocker.kind === 'browser_readiness' || blocker.kind === 'external_control' || blocker.kind === 'live_evidence';
}

export function formatCompletionAudit(audit: CompletionAudit): string {
  const classifiedBlockers = audit.classifiedBlockers ?? audit.blockers.map(classifyCompletionBlocker);
  const externalValidationBlockerCount = audit.externalValidationBlockerCount
    ?? classifiedBlockers.filter(isExternalValidationBlocker).length;
  const internalBlockerCount = audit.internalBlockerCount
    ?? classifiedBlockers.length - externalValidationBlockerCount;
  const lines = [
    'HireSeek Completion Audit',
    '',
    `Complete: ${audit.complete ? 'YES' : 'NO'}`,
    `Doctor status: ${statusLabel(audit.status)}`,
    `Internal implementation blockers: ${internalBlockerCount === 0 ? 'none' : internalBlockerCount}`,
    `External validation blockers: ${externalValidationBlockerCount}`,
  ];
  if (classifiedBlockers.length > 0) {
    lines.push('', `Blocking checks (${classifiedBlockers.length})`);
    lines.push(`Blocking categories: ${blockerKindCounts(classifiedBlockers)}`);
    lines.push(...classifiedBlockers.map(check => (
      `- ${statusLabel(check.status)} [${blockerKindLabel(check.kind)}] ${check.name}: ${check.detail}`
    )));
  }
  if (audit.nextSteps.length > 0) {
    lines.push('', 'Next steps');
    lines.push(...audit.nextSteps.map(step => `- ${step}`));
  }
  return lines.join('\n');
}
