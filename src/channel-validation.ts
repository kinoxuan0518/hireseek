import type { Channel } from './types';
import { loadAgentRunState } from './agent-core/run-state-store';
import {
  formatBrowserReadiness,
  formatBrowserReadinessSummary,
  formatOpenMissingBrowserChannels,
  openMissingBrowserChannels,
  probeBrowserReadiness,
  probeBrowserReadinessMany,
  type BrowserOpenMissingResult,
  type BrowserReadinessReport,
  type BrowserReadinessSummary,
} from './browser-readiness';

export type ChannelValidationStep = 'dry-run' | 'prepare' | 'screen';

export interface ChannelValidationResult {
  channel: Channel;
  readiness: BrowserReadinessReport;
  attemptedSteps: ChannelValidationStep[];
  runIds: ChannelValidationRunEvidence[];
  ok: boolean;
}

export interface ChannelValidationRunEvidence {
  step: ChannelValidationStep;
  runId: number;
  status?: string;
  phase?: string;
  ok?: boolean;
  reason?: string | null;
}

export interface ChannelValidationBatchResult {
  channels: Channel[];
  readiness: BrowserReadinessSummary;
  results: ChannelValidationResult[];
  openedMissing?: BrowserOpenMissingResult;
  wait?: ChannelValidationWaitResult;
  ok: boolean;
}

const DEFAULT_STEPS: ChannelValidationStep[] = ['dry-run', 'prepare', 'screen'];
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_WAIT_INTERVAL_MS = 5000;

export interface ChannelValidationWaitOptions {
  enabled: boolean;
  timeoutMs: number;
  intervalMs: number;
}

export interface ChannelValidationWaitResult extends ChannelValidationWaitOptions {
  attempts: number;
  timedOut: boolean;
}

export interface ChannelValidationWaitProgress {
  attempt: number;
  elapsedMs: number;
  timeoutMs: number;
  intervalMs: number;
  readiness: BrowserReadinessSummary;
}

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

export function channelValidationWaitOptions(args: string[] = []): ChannelValidationWaitOptions {
  const enabled = args.includes('--wait');
  const timeoutArg = args.find(arg => arg.startsWith('--wait-ms='));
  const secondsArg = args.find(arg => arg.startsWith('--wait-seconds='));
  const intervalArg = args.find(arg => arg.startsWith('--wait-interval-ms='));
  const parsedTimeout = timeoutArg
    ? Number(timeoutArg.split('=')[1])
    : secondsArg
      ? Number(secondsArg.split('=')[1]) * 1000
      : DEFAULT_WAIT_TIMEOUT_MS;
  const parsedInterval = intervalArg ? Number(intervalArg.split('=')[1]) : DEFAULT_WAIT_INTERVAL_MS;
  return {
    enabled,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_WAIT_TIMEOUT_MS,
    intervalMs: Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : DEFAULT_WAIT_INTERVAL_MS,
  };
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

export function formatChannelValidationBatchPlan(channels: Channel[], steps: ChannelValidationStep[]): string {
  return [
    `Channel validation: ${channels.join(', ')}`,
    'Plan:',
    '- readiness 只读预检全部启用渠道',
    ...channels.flatMap(channel => steps.map(step => `- ${channel}: ${STEP_LABEL[step]}`)),
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
    lines.push(...result.runIds.map(row => `- ${formatRunEvidence(row)}`));
  }
  return lines.join('\n');
}

export function formatChannelValidationBatchResult(result: ChannelValidationBatchResult): string {
  const lines = [
    result.openedMissing
      ? formatOpenMissingBrowserChannels(result.openedMissing)
      : formatBrowserReadinessSummary(result.readiness),
    '',
    result.ok
      ? 'Channel validation completed.'
      : result.wait?.timedOut
        ? 'Channel validation stopped after waiting for login.'
      : result.openedMissing?.opened.length
        ? 'Channel validation paused for login.'
        : 'Channel validation stopped.',
  ];
  if (result.wait) {
    lines.push(`Wait: attempts=${result.wait.attempts}, timeoutMs=${result.wait.timeoutMs}, intervalMs=${result.wait.intervalMs}, timedOut=${result.wait.timedOut}`);
  }
  if (result.results.length > 0) {
    lines.push('Run evidence:');
    for (const channelResult of result.results) {
      lines.push(`- ${channelResult.channel}: ${channelResult.ok ? 'completed' : 'stopped'}`);
      lines.push(...channelResult.runIds.map(row => `  - ${formatRunEvidence(row)}`));
    }
  }
  return lines.join('\n');
}

function formatRunEvidence(row: ChannelValidationRunEvidence): string {
  const state = [row.status, row.phase].filter(Boolean).join('/');
  const suffix = state ? ` (${state})` : '';
  const reason = !row.ok && row.reason ? ` — ${row.reason.slice(0, 140)}` : '';
  return `${row.step}: run#${row.runId}${suffix}${reason}`;
}

export function formatChannelValidationWaitProgress(progress: ChannelValidationWaitProgress): string {
  const missing = progress.readiness.reports
    .filter(report => report.status !== 'ready')
    .map(report => `${report.channel}:${report.issues[0] ?? report.status}`)
    .join(' | ');
  return [
    `等待浏览器 readiness：${progress.readiness.ready}/${progress.readiness.reports.length} ready`,
    `attempt=${progress.attempt}`,
    `elapsed=${Math.round(progress.elapsedMs / 1000)}s/${Math.round(progress.timeoutMs / 1000)}s`,
    missing ? `missing=${missing}` : '',
  ].filter(Boolean).join(' · ');
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function waitForReadiness(
  channels: Channel[],
  opts: ChannelValidationWaitOptions,
  onProgress?: (progress: ChannelValidationWaitProgress) => void,
): Promise<{ readiness: BrowserReadinessSummary; wait: ChannelValidationWaitResult }> {
  const started = Date.now();
  let attempts = 0;
  let readiness = await probeBrowserReadinessMany(channels);
  onProgress?.({
    attempt: attempts,
    elapsedMs: Date.now() - started,
    timeoutMs: opts.timeoutMs,
    intervalMs: opts.intervalMs,
    readiness,
  });
  while (!readiness.ok && Date.now() - started < opts.timeoutMs) {
    attempts++;
    await sleep(opts.intervalMs);
    readiness = await probeBrowserReadinessMany(channels);
    onProgress?.({
      attempt: attempts,
      elapsedMs: Date.now() - started,
      timeoutMs: opts.timeoutMs,
      intervalMs: opts.intervalMs,
      readiness,
    });
  }
  return {
    readiness,
    wait: {
      ...opts,
      attempts,
      timedOut: !readiness.ok,
    },
  };
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
    const state = loadAgentRunState(runId);
    const ok = state?.taskStatus === 'completed' && state.status === 'completed';
    runIds.push({
      step,
      runId,
      status: state?.taskStatus ?? state?.status ?? 'unknown',
      phase: state?.phase ?? undefined,
      ok,
      reason: state?.reason ?? null,
    });
    if (!ok) return { channel, readiness, attemptedSteps, runIds, ok: false };
  }

  return { channel, readiness, attemptedSteps, runIds, ok: true };
}

export async function validateChannels(
  channels: Channel[],
  steps: ChannelValidationStep[] = DEFAULT_STEPS,
  opts: {
    openMissing?: boolean;
    wait?: ChannelValidationWaitOptions;
    onWaitProgress?: (progress: ChannelValidationWaitProgress) => void;
  } = {},
): Promise<ChannelValidationBatchResult> {
  const readiness = await probeBrowserReadinessMany(channels);
  if (!readiness.ok) {
    const openedMissing = opts.openMissing ? await openMissingBrowserChannels(channels) : undefined;
    if (!opts.wait?.enabled) {
      return { channels, readiness, results: [], openedMissing, ok: false };
    }
    const waited = await waitForReadiness(channels, opts.wait, opts.onWaitProgress);
    if (!waited.readiness.ok) {
      return {
        channels,
        readiness: waited.readiness,
        results: [],
        openedMissing,
        wait: waited.wait,
        ok: false,
      };
    }
    const results: ChannelValidationResult[] = [];
    for (const channel of channels) {
      results.push(await validateChannel(channel, steps));
    }
    return {
      channels,
      readiness: waited.readiness,
      results,
      openedMissing,
      wait: waited.wait,
      ok: results.length === channels.length && results.every(result => result.ok),
    };
  }

  const results: ChannelValidationResult[] = [];
  for (const channel of channels) {
    results.push(await validateChannel(channel, steps));
  }

  return {
    channels,
    readiness,
    results,
    ok: results.length === channels.length && results.every(result => result.ok),
  };
}
