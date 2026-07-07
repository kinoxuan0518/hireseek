import { describe, expect, it } from 'vitest';
import {
  channelValidationSteps,
  formatChannelValidationBatchPlan,
  formatChannelValidationBatchResult,
  formatChannelValidationPlan,
  formatChannelValidationResult,
  runOptionsForValidationStep,
} from '../src/channel-validation';

describe('channel validation command planning', () => {
  it('runs the safe live-evidence sequence by default', () => {
    expect(channelValidationSteps()).toEqual(['dry-run', 'prepare', 'screen']);
  });

  it('can run a single validation stage when requested', () => {
    expect(channelValidationSteps(['--dry-run-only'])).toEqual(['dry-run']);
    expect(channelValidationSteps(['--prepare-only'])).toEqual(['prepare']);
    expect(channelValidationSteps(['--screen-only'])).toEqual(['screen']);
  });

  it('maps validation stages to current-page safe run options', () => {
    expect(runOptionsForValidationStep('dry-run')).toEqual({ fromCurrent: true, dryRun: true });
    expect(runOptionsForValidationStep('prepare')).toEqual({ fromCurrent: true, prepare: true });
    expect(runOptionsForValidationStep('screen')).toEqual({ fromCurrent: true, screen: true });
  });

  it('formats the validation plan without implying a real run has started', () => {
    const plan = formatChannelValidationPlan('maimai', ['dry-run', 'prepare', 'screen']);

    expect(plan).toContain('Channel validation: maimai');
    expect(plan).toContain('readiness 只读预检');
    expect(plan).toContain('dry-run 预检');
    expect(plan).toContain('prepare 安全验收');
    expect(plan).toContain('screen 候选人筛选验收');
  });

  it('formats an active-job multi-channel validation plan', () => {
    const plan = formatChannelValidationBatchPlan(['boss', 'maimai'], ['dry-run', 'screen']);

    expect(plan).toContain('Channel validation: boss, maimai');
    expect(plan).toContain('readiness 只读预检全部启用渠道');
    expect(plan).toContain('boss: dry-run 预检');
    expect(plan).toContain('boss: screen 候选人筛选验收');
    expect(plan).toContain('maimai: dry-run 预检');
    expect(plan).toContain('maimai: screen 候选人筛选验收');
  });

  it('formats stopped validation results without run evidence', () => {
    const output = formatChannelValidationResult({
      channel: 'maimai',
      readiness: {
        channel: 'maimai',
        status: 'not_ready',
        issues: ['未找到 脉脉 标签页'],
        nextSteps: ['在 Chrome 打开脉脉页面。'],
      },
      attemptedSteps: [],
      runIds: [],
      ok: false,
    });

    expect(output).toContain('Browser readiness: NOT READY');
    expect(output).toContain('Channel validation stopped.');
    expect(output).not.toContain('Run evidence:');
  });

  it('formats successful run evidence', () => {
    const output = formatChannelValidationResult({
      channel: 'boss',
      readiness: {
        channel: 'boss',
        status: 'ready',
        issues: [],
        nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
      },
      attemptedSteps: ['dry-run', 'prepare', 'screen'],
      runIds: [
        { step: 'dry-run', runId: 101 },
        { step: 'prepare', runId: 102 },
        { step: 'screen', runId: 103 },
      ],
      ok: true,
    });

    expect(output).toContain('Channel validation completed.');
    expect(output).toContain('- dry-run: run#101');
    expect(output).toContain('- prepare: run#102');
    expect(output).toContain('- screen: run#103');
  });

  it('formats stopped multi-channel validation without run evidence', () => {
    const output = formatChannelValidationBatchResult({
      channels: ['boss', 'maimai'],
      readiness: {
        ready: 1,
        notReady: 1,
        unavailable: 0,
        ok: false,
        reports: [
          {
            channel: 'boss',
            status: 'ready',
            issues: [],
            nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
          },
          {
            channel: 'maimai',
            status: 'not_ready',
            issues: ['未找到 脉脉 标签页'],
            nextSteps: ['在 Chrome 打开脉脉页面。'],
          },
        ],
      },
      results: [],
      ok: false,
    });

    expect(output).toContain('Browser readiness summary: NOT READY');
    expect(output).toContain('Channel validation stopped.');
    expect(output).not.toContain('Run evidence:');
  });

  it('formats opened missing pages as paused for login', () => {
    const output = formatChannelValidationBatchResult({
      channels: ['boss', 'maimai'],
      readiness: {
        ready: 1,
        notReady: 1,
        unavailable: 0,
        ok: false,
        reports: [
          {
            channel: 'boss',
            status: 'ready',
            issues: [],
            nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
          },
          {
            channel: 'maimai',
            status: 'not_ready',
            issues: ['未找到 脉脉 标签页'],
            nextSteps: ['在 Chrome 打开脉脉页面。'],
          },
        ],
      },
      openedMissing: {
        before: {
          ready: 1,
          notReady: 1,
          unavailable: 0,
          ok: false,
          reports: [
            {
              channel: 'boss',
              status: 'ready',
              issues: [],
              nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
            },
            {
              channel: 'maimai',
              status: 'not_ready',
              issues: ['未找到 脉脉 标签页'],
              nextSteps: ['在 Chrome 打开脉脉页面。'],
            },
          ],
        },
        opened: [{
          channel: 'maimai',
          url: 'https://maimai.cn/ent/v41/recruit/talents?tab=1',
          reason: '未找到 脉脉 标签页',
        }],
        skipped: [],
      },
      results: [],
      ok: false,
    });

    expect(output).toContain('Opened 1 missing channel page(s):');
    expect(output).toContain('Channel validation paused for login.');
    expect(output).not.toContain('Channel validation stopped.');
  });
});
