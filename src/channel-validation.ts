import type { Channel } from './types';
import { formatBrowserReadiness, probeBrowserReadiness, type BrowserReadinessReport } from './browser-readiness';

export type ChannelValidationStep = 'dry-run' | 'prepare' | 'screen';

export interface ChannelValidationResult {
  channel: Channel;
  readiness: BrowserReadinessReport;
  attemptedSteps: ChannelValidationStep[];
  runIds: Array<{ step: ChannelValidationStep; runId: number }>;
  ok: boolean;
}

const DEFAULT_STEPS: ChannelValidationStep[] = ['dry-run', 'prepare', 'screen'];

const STEP_LABEL: Record<ChannelValidationStep, string> = {
  'dry-run': 'dry-run 预检',
  prepare: 'prepare 安全验收',
  screen: 'screen 候选人筛选验收',
};

export function channelValidationSteps(args: string[] = []): ChannelValidationStep[] {
  if (args.includes('--dry-run-only') || args.includes('--dry-only')) return ['dry-run'];
  if (args.includes('--prepare-only')) return ['prepare'];
  if (args.includes('--screen-only')) return ['screen'];
  return [...DEFAULT_STEPS];
}

export function runOptionsForValidationStep(step: ChannelValidationStep): {
  fromCurrent: true;
  dryRun?: true;
  prepare?: true;
  screen?: true;
} {
  switch (step) {
    case 'dry-run':
      return { fromCurrent: true, dryRun: true };
    case 'prepare':
      return { fromCurrent: true, prepare: true };
    case 'screen':
      return { fromCurrent: true, screen: true };
  }
}

export function formatChannelValidationPlan(channel: Channel, steps: ChannelValidationStep[]): string {
  return [
    `Channel validation: ${channel}`,
    'Plan:',
    '- readiness 只读预检',
    ...steps.map(step => `- ${STEP_LABEL[step]}`),
  ].join('\n');
}

export function formatChannelValidationResult(result: ChannelValidationResult): string {
  const lines = [
    formatBrowserReadiness(result.readiness),
    '',
    result.ok ? 'Channel validation completed.' : 'Channel validation stopped.',
  ];
  if (result.runIds.length > 0) {
    lines.push('Run evidence:');
    lines.push(...result.runIds.map(row => `- ${row.step}: run#${row.runId}`));
  }
  return lines.join('\n');
}

export async function validateChannel(
  channel: Channel,
  steps: ChannelValidationStep[] = DEFAULT_STEPS,
): Promise<ChannelValidationResult> {
  const readiness = await probeBrowserReadiness(channel);
  const runIds: ChannelValidationResult['runIds'] = [];
  const attemptedSteps: ChannelValidationStep[] = [];
  if (readiness.status !== 'ready') {
    return { channel, readiness, attemptedSteps, runIds, ok: false };
  }

  const { runChannel } = await import('./orchestrator');
  for (const step of steps) {
    attemptedSteps.push(step);
    const runId = await runChannel(channel, undefined, runOptionsForValidationStep(step));
    runIds.push({ step, runId });
  }

  return { channel, readiness, attemptedSteps, runIds, ok: true };
}
