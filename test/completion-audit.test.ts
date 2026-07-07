import { describe, expect, it } from 'vitest';
import {
  classifyCompletionBlocker,
  collectCompletionAudit,
  formatCompletionAudit,
} from '../src/completion-audit';
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
      classifiedBlockers: [],
      internalBlockerCount: 0,
      externalValidationBlockerCount: 0,
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
    expect(audit.classifiedBlockers?.map(blocker => blocker.kind)).toEqual(['live_evidence']);
    expect(audit.internalBlockerCount).toBe(0);
    expect(audit.externalValidationBlockerCount).toBe(1);
    expect(audit.nextSteps[0]).toContain('validate');
  });

  it('classifies blocker kinds so incomplete status is actionable', () => {
    expect(classifyCompletionBlocker({
      layer: 'upper',
      name: 'Browser readiness',
      status: 'warn',
      detail: 'maimai not ready',
    }).kind).toBe('browser_readiness');

    expect(classifyCompletionBlocker({
      layer: 'upper',
      name: 'Live 脉脉 prepare',
      status: 'warn',
      detail: 'no evidence',
    }).kind).toBe('live_evidence');

    expect(classifyCompletionBlocker({
      layer: 'lower',
      name: 'Pending run states',
      status: 'warn',
      detail: 'run #54 failed/external_control reason=用户接管保护',
    }).kind).toBe('external_control');

    expect(classifyCompletionBlocker({
      layer: 'middle',
      name: 'BOSS protocol',
      status: 'fail',
      detail: 'missing',
    }).kind).toBe('product_contract');

    expect(classifyCompletionBlocker({
      layer: 'lower',
      name: 'RuntimeContext',
      status: 'fail',
      detail: 'missing',
    }).kind).toBe('agent_core');
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
    expect(output).toContain('Internal implementation blockers: none');
    expect(output).toContain('External validation blockers: 1');
    expect(output).toContain('Blocking checks (1)');
    expect(output).toContain('Blocking categories: browser readiness=1');
    expect(output).toContain('WARN [browser readiness] Browser readiness: 脉脉:not_ready');
    expect(output).toContain('Next steps');
  });

  it('counts external browser control separately from internal implementation blockers', () => {
    const audit = collectCompletionAudit({
      status: 'warn',
      checks: [{
        layer: 'lower',
        name: 'Pending run states',
        status: 'warn',
        detail: 'run #54 failed/external_control reason=用户接管保护',
      }],
      nextSteps: [],
    });

    expect(audit.internalBlockerCount).toBe(0);
    expect(audit.externalValidationBlockerCount).toBe(1);
    expect(formatCompletionAudit(audit)).toContain('External validation blockers: 1');
    expect(formatCompletionAudit(audit)).toContain('[external browser control]');
  });
});
