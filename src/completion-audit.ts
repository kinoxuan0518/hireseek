import type { DoctorCheck, DoctorReport, DoctorStatus } from './doctor';

export interface CompletionAudit {
  complete: boolean;
  status: DoctorStatus;
  blockers: DoctorCheck[];
  nextSteps: string[];
}

export function collectCompletionAudit(report: DoctorReport): CompletionAudit {
  const blockers = report.checks.filter(check => check.status !== 'pass');
  return {
    complete: report.status === 'pass' && blockers.length === 0,
    status: report.status,
    blockers,
    nextSteps: report.nextSteps,
  };
}

function statusLabel(status: DoctorStatus): string {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

export function formatCompletionAudit(audit: CompletionAudit): string {
  const lines = [
    'HireSeek Completion Audit',
    '',
    `Complete: ${audit.complete ? 'YES' : 'NO'}`,
    `Doctor status: ${statusLabel(audit.status)}`,
  ];
  if (audit.blockers.length > 0) {
    lines.push('', `Blocking checks (${audit.blockers.length})`);
    lines.push(...audit.blockers.map(check => (
      `- ${statusLabel(check.status)} ${check.name}: ${check.detail}`
    )));
  }
  if (audit.nextSteps.length > 0) {
    lines.push('', 'Next steps');
    lines.push(...audit.nextSteps.map(step => `- ${step}`));
  }
  return lines.join('\n');
}
