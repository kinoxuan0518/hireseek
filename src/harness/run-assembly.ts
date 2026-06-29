import { config } from '../config';
import { buildMemoryContext } from '../memory';
import { buildRecruitingCapabilityContext, buildRecruitingCapabilityManifest } from '../capabilities';
import { getPlatformProtocol } from '../platform-protocols';
import { DOM_RUNNER_TOOL_REGISTRY, domRunnerToolNamesForMode } from '../runners/dom-runner';
import { jobToPrompt, loadSkill, loadWorkspaceFile, type JobConfig } from '../skills/loader';
import { buildSkillAssetManifest } from '../skills/skill-asset-manifest';
import type { Channel } from '../types';

export type HarnessRunMode = 'execute' | 'dry_run' | 'prepare' | 'screen';
export type HarnessContextLayer = 'lower' | 'middle' | 'external';

export interface HarnessContextBlock {
  id: string;
  layer: HarnessContextLayer;
  source: string;
  included: boolean;
  priority: number;
  reason: string;
}

export interface HarnessToolGrant {
  name: string;
  category: string;
  sideEffect: boolean;
  requiresApproval: boolean;
  supportsDryRun: boolean;
  declaredToModel: boolean;
  reason: string;
}

export interface HarnessRunAssembly {
  channel: Channel;
  mode: HarnessRunMode;
  provider: string;
  platformProtocol: string | null;
  contractName: string | null;
  skillAssetMode: string | null;
  contextBlocks: HarnessContextBlock[];
  tools: HarnessToolGrant[];
  boundaries: string[];
}

export interface ChannelSkillAssetContext {
  mode: 'preloaded' | 'fallback-only';
  content: string;
}

export interface HarnessSystemPromptResult {
  assembly: HarnessRunAssembly;
  systemPrompt: string;
}

function contextBlock(
  id: string,
  layer: HarnessContextLayer,
  source: string,
  included: boolean,
  priority: number,
  reason: string,
): HarnessContextBlock {
  return { id, layer, source, included, priority, reason };
}

export function channelSkillAssetContext(channel: Channel): ChannelSkillAssetContext {
  const protocol = getPlatformProtocol(channel);
  if (!protocol || config.skills.preloadLegacyForProductizedChannels) {
    return { mode: 'preloaded', content: loadSkill(channel) };
  }
  return {
    mode: 'fallback-only',
    content: [
      '# Legacy skill fallback',
      `渠道 ${channel} 已由 HireSeek 产品协议 ${protocol.name} 接管。`,
      '完整 legacy skill 不预加载进本轮 prompt，避免历史规则覆盖产品协议。',
      'skill 文件仍保留在外部 skill homes，供 CC/Codex 原生使用，也可通过显式回退配置重新启用。',
    ].join('\n'),
  };
}

export function buildHarnessRunAssembly(channel: Channel, mode: HarnessRunMode): HarnessRunAssembly {
  const protocol = getPlatformProtocol(channel);
  const capabilityManifest = buildRecruitingCapabilityManifest(channel);
  const skillAsset = buildSkillAssetManifest().find(entry => entry.channel === channel) ?? null;
  const declaredToolNames = new Set(domRunnerToolNamesForMode(mode));

  const tools = DOM_RUNNER_TOOL_REGISTRY.list().map(tool => {
    const declaredToModel = declaredToolNames.has(tool.name);
    return {
      name: tool.name,
      category: tool.policy.category,
      sideEffect: tool.policy.sideEffect,
      requiresApproval: tool.policy.requiresApproval,
      supportsDryRun: tool.policy.supportsDryRun,
      declaredToModel,
      reason: declaredToModel
        ? `available in ${mode} mode`
        : `withheld from ${mode} mode by harness assembly`,
    };
  });

  const contextBlocks = [
    contextBlock('runtime-context', 'lower', 'RuntimeContext', true, 0, '统一暴露配置、路径、账号状态和 active job 入口。'),
    contextBlock('soul', 'lower', 'workspace/SOUL.md', true, 10, '产品身份与长期工作方式。'),
    contextBlock('active-job-facts', 'lower', 'workspace/jobs/active.yaml', true, 20, '当前岗位原始事实；这里只注入事实，不做渠道判断。'),
    contextBlock('memory-context', 'lower', 'agent-core memory stores', true, 30, '历史触达、反馈和运行记忆的摘要入口。'),
    contextBlock(
      'platform-protocol',
      'middle',
      protocol?.name ?? 'none',
      !!protocol,
      40,
      protocol ? '渠道平台协议，约束站内流程、工具护栏和完成条件。' : '未注册产品平台协议，回退到 legacy skill/工作区 skill。',
    ),
    contextBlock(
      'recruiting-capabilities',
      'middle',
      capabilityManifest.map(entry => entry.id).join(', ') || 'none',
      capabilityManifest.length > 0,
      50,
      '跨渠道招聘能力：触达话术、候选人判断、搜索策略等中层模块。',
    ),
    contextBlock(
      'skill-asset',
      'external',
      skillAsset?.activeAsset?.path ?? 'none',
      !!skillAsset?.activeAsset,
      90,
      skillAsset?.mode === 'productized-fallback-only'
        ? '外部 skill 只作为历史经验、异常案例和显式 fallback，不覆盖产品协议。'
        : '外部 skill 作为 legacy 执行素材预加载。',
    ),
  ].sort((a, b) => a.priority - b.priority);

  return {
    channel,
    mode,
    provider: config.llm.provider,
    platformProtocol: protocol?.name ?? null,
    contractName: protocol?.contractName ?? null,
    skillAssetMode: skillAsset?.mode ?? null,
    contextBlocks,
    tools,
    boundaries: [
      'code-guards-override-prompts',
      'platform-protocol-overrides-legacy-skill',
      'mode-specific-tool-disclosure',
      'structured-tool-results-required',
      'tool-calls-must-have-tool-results',
      'trace-every-tool-call',
    ],
  };
}

export function buildHarnessSystemPrompt(
  channel: Channel,
  mode: HarnessRunMode,
  job: JobConfig | null,
  jobId: string,
): HarnessSystemPromptResult {
  const assembly = buildHarnessRunAssembly(channel, mode);
  const soul = loadWorkspaceFile('SOUL.md');
  const jobCtx = job ? jobToPrompt(job) : '';
  const skillAsset = channelSkillAssetContext(channel);
  const protocolContext = getPlatformProtocol(channel)?.buildSystemContext?.() ?? '';
  const capabilities = buildRecruitingCapabilityContext({
    channel,
    includeKinds: ['principles', 'evaluation', 'outreach', 'search'],
  });
  const memory = buildMemoryContext(channel, jobId);
  const systemPrompt = [soul, jobCtx, skillAsset.content, protocolContext, capabilities, memory]
    .filter(Boolean)
    .join('\n\n---\n\n');
  return { assembly, systemPrompt };
}

export function formatHarnessRunAssembly(channel: Channel, mode: HarnessRunMode): string {
  const assembly = buildHarnessRunAssembly(channel, mode);
  const contextLines = assembly.contextBlocks.map(block => (
    `- ${block.id}: ${block.included ? 'included' : 'skipped'} | ${block.layer} | ${block.source}`
  ));
  const toolLines = assembly.tools.map(tool => (
    `- ${tool.name}: ${tool.declaredToModel ? 'declared' : 'withheld'} | ${tool.category} | sideEffect=${tool.sideEffect}`
  ));
  return [
    'HireSeek Harness Run Assembly',
    '',
    `channel: ${assembly.channel}`,
    `mode: ${assembly.mode}`,
    `provider: ${assembly.provider}`,
    `platformProtocol: ${assembly.platformProtocol ?? 'none'}`,
    `contract: ${assembly.contractName ?? 'none'}`,
    `skillAssetMode: ${assembly.skillAssetMode ?? 'none'}`,
    '',
    'Context blocks:',
    ...contextLines,
    '',
    'Tools:',
    ...toolLines,
    '',
    `Boundaries: ${assembly.boundaries.join(', ')}`,
  ].join('\n');
}
