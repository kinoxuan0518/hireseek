import { describe, expect, it } from 'vitest';
import { collectCompletionAudit, formatCompletionAudit } from '../src/completion-audit';
import type { DoctorReport } from '../src/doctor';

describe('completion audit', () => {
  it('marks completion only when doctor has no non-pass checks', () => {
    const report: DoctorReport = {
      status: 'pass',
      checks: [
        { layer: 'lower', name: 'RuntimeContext', status: 'pass', detail: 'ok' },
        { layer: 'upper', name: 'Live BOSS run', status: 'pass', detail: 'ok' },
      ],
      nextSteps: [],
    };

    expect(collectCompletionAudit(report)).toMatchObject({
      complete: true,
      status: 'pass',
      blockers: [],
    });
  });

  it('keeps warning checks as blockers for goal completion', () => {
    const report: DoctorReport = {
      status: 'warn',
      checks: [
        { layer: 'lower', name: 'RuntimeContext', status: 'pass', detail: 'ok' },
        {
          layer: 'upper',
          name: 'Live 脉脉 run',
          status: 'warn',
          detail: 'no 脉脉 dry-run evidence',
        },
      ],
      nextSteps: ['运行 `hireseek validate --open-missing --wait`。'],
    };

    const audit = collectCompletionAudit(report);

    expect(audit.complete).toBe(false);
    expect(audit.blockers.map(blocker => blocker.name)).toEqual(['Live 脉脉 run']);
    expect(audit.nextSteps[0]).toContain('validate');
  });

  it('formats blockers and next steps for the CLI', () => {
    const output = formatCompletionAudit({
      complete: false,
      status: 'warn',
      blockers: [{
        layer: 'upper',
        name: 'Browser readiness',
        status: 'warn',
        detail: '脉脉:not_ready',
      }],
      nextSteps: ['运行 `hireseek validate --open-missing --wait`。'],
    });

    expect(output).toContain('HireSeek Completion Audit');
    expect(output).toContain('Complete: NO');
    expect(output).toContain('Doctor status: WARN');
    expect(output).toContain('Blocking checks (1)');
    expect(output).toContain('WARN Browser readiness: 脉脉:not_ready');
    expect(output).toContain('Next steps');
  });
});
