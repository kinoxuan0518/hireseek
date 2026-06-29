import type { Channel } from '../types';
import type { BrowserActionPolicy, RunCompletionPolicy } from '../runners/interface';
import type { JobConfig } from '../skills/loader';
import {
  bossBrowserActionPolicy,
  bossRunCompletionPolicy,
  bossProcessRules,
  bossProtocolStages,
  buildBossSystemContext,
  buildBossTaskPrompt,
} from './boss';

export interface PlatformTaskPromptOptions {
  channelLabel?: string;
  fromCurrent?: boolean;
  activeJob?: JobConfig | null;
}

export interface PlatformProtocolStage {
  id: string;
  name: string;
  required: string[];
  evidence: string[];
  onFailure: string;
}

export interface PlatformProtocol {
  channel: Channel;
  name: string;
  contractName?: string;
  writes?: string[];
  stageManifest?: () => PlatformProtocolStage[];
  buildSystemContext?: () => string;
  buildTaskPrompt: (opts?: PlatformTaskPromptOptions) => string;
  browserActionPolicy?: BrowserActionPolicy;
  completionPolicy?: RunCompletionPolicy;
  processRules?: () => string;
}

export interface PlatformProtocolManifestEntry {
  channel: Channel;
  name: string;
  version: number;
  contractName: string | null;
  writes: string[];
  stageCount: number;
  stageIds: string[];
  hooks: {
    systemContext: boolean;
    taskPrompt: boolean;
    browserActionPolicy: boolean;
    completionPolicy: boolean;
    processRules: boolean;
  };
}

const PROTOCOLS: Partial<Record<Channel, PlatformProtocol>> = {
  boss: {
    channel: 'boss',
    name: 'boss-platform.v1',
    contractName: 'boss-greeting.v1',
    writes: ['contacted_candidates', 'run_trace', 'interaction_log'],
    stageManifest: bossProtocolStages,
    buildSystemContext: buildBossSystemContext,
    buildTaskPrompt: buildBossTaskPrompt,
    browserActionPolicy: bossBrowserActionPolicy,
    completionPolicy: bossRunCompletionPolicy,
    processRules: bossProcessRules,
  },
};

export function getPlatformProtocol(channel: Channel): PlatformProtocol | null {
  return PROTOCOLS[channel] ?? null;
}

export function listPlatformProtocols(): PlatformProtocol[] {
  return Object.values(PROTOCOLS).filter(Boolean) as PlatformProtocol[];
}

function versionOf(name: string): number {
  const match = name.match(/\.v(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function buildPlatformProtocolManifest(): PlatformProtocolManifestEntry[] {
  return listPlatformProtocols().map(protocol => {
    const stages = protocol.stageManifest?.() ?? [];
    return {
      channel: protocol.channel,
      name: protocol.name,
      version: versionOf(protocol.name),
      contractName: protocol.contractName ?? null,
      writes: [...(protocol.writes ?? [])],
      stageCount: stages.length,
      stageIds: stages.map(stage => stage.id),
      hooks: {
        systemContext: !!protocol.buildSystemContext,
        taskPrompt: !!protocol.buildTaskPrompt,
        browserActionPolicy: !!protocol.browserActionPolicy,
        completionPolicy: !!protocol.completionPolicy,
        processRules: !!protocol.processRules,
      },
    };
  });
}

export function formatPlatformProtocols(): string {
  const protocols = listPlatformProtocols();
  if (protocols.length === 0) return '当前没有注册任何中层平台协议。';

  return [
    'HireSeek 中层平台协议',
    '',
    ...protocols.map(p => [
      `- ${p.channel}: ${p.name}`,
      `  契约: ${p.contractName ?? '未绑定'}`,
      `  写入: ${p.writes?.join(', ') || '未声明'}`,
      `  Stage manifest: ${p.stageManifest ? `${p.stageManifest().length} stages` : '未接入'}`,
      `  System context: ${p.buildSystemContext ? '已接入' : '未接入'}`,
      `  Browser action policy: ${p.browserActionPolicy ? '已接入' : '未接入'}`,
      `  Compliance rules: ${p.processRules ? '已接入' : '未接入'}`,
    ].join('\n')),
    '',
    '说明：外部 skill 仍可作为知识资产和兜底执行素材；当它与产品中层协议冲突时，以产品中层协议为准。',
  ].join('\n');
}

export function formatPlatformProtocolManifest(): string {
  const manifest = buildPlatformProtocolManifest();
  if (manifest.length === 0) return '当前没有平台协议 manifest。';
  return [
    'HireSeek Platform Protocol Manifest',
    '',
    ...manifest.map(entry => [
      `- ${entry.channel}: ${entry.name}`,
      `  version: ${entry.version}`,
      `  contract: ${entry.contractName ?? 'none'}`,
      `  writes: ${entry.writes.join(', ') || 'none'}`,
      `  stages: ${entry.stageCount} (${entry.stageIds.join(', ')})`,
      `  hooks: system=${entry.hooks.systemContext}, task=${entry.hooks.taskPrompt}, actionPolicy=${entry.hooks.browserActionPolicy}, completion=${entry.hooks.completionPolicy}, processRules=${entry.hooks.processRules}`,
    ].join('\n')),
  ].join('\n');
}
