import type { Channel } from '../types';
import type { BrowserActionPolicy } from '../runners/interface';
import type { JobConfig } from '../skills/loader';
import {
  bossBrowserActionPolicy,
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

export interface PlatformProtocol {
  channel: Channel;
  name: string;
  contractName?: string;
  stageManifest?: () => Array<{ id: string; name: string; required: string[]; evidence: string[]; onFailure: string }>;
  buildSystemContext?: () => string;
  buildTaskPrompt: (opts?: PlatformTaskPromptOptions) => string;
  browserActionPolicy?: BrowserActionPolicy;
  processRules?: () => string;
}

const PROTOCOLS: Partial<Record<Channel, PlatformProtocol>> = {
  boss: {
    channel: 'boss',
    name: 'boss-platform.v1',
    contractName: 'boss-greeting.v1',
    stageManifest: bossProtocolStages,
    buildSystemContext: buildBossSystemContext,
    buildTaskPrompt: buildBossTaskPrompt,
    browserActionPolicy: bossBrowserActionPolicy,
    processRules: bossProcessRules,
  },
};

export function getPlatformProtocol(channel: Channel): PlatformProtocol | null {
  return PROTOCOLS[channel] ?? null;
}

export function listPlatformProtocols(): PlatformProtocol[] {
  return Object.values(PROTOCOLS).filter(Boolean) as PlatformProtocol[];
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
      `  Stage manifest: ${p.stageManifest ? `${p.stageManifest().length} stages` : '未接入'}`,
      `  System context: ${p.buildSystemContext ? '已接入' : '未接入'}`,
      `  Browser action policy: ${p.browserActionPolicy ? '已接入' : '未接入'}`,
      `  Compliance rules: ${p.processRules ? '已接入' : '未接入'}`,
    ].join('\n')),
    '',
    '说明：外部 skill 仍可作为知识资产和兜底执行素材；当它与产品中层协议冲突时，以产品中层协议为准。',
  ].join('\n');
}
