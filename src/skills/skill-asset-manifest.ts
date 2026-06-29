import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { getPlatformProtocol } from '../platform-protocols';
import type { Channel } from '../types';

export type SkillAssetMode = 'productized-fallback-only' | 'preloaded' | 'legacy-only';

export interface SkillAssetFileStatus {
  path: string;
  exists: boolean;
  bytes: number;
  source: 'external' | 'workspace';
}

export interface SkillAssetManifestEntry {
  channel: Channel;
  productProtocol: string | null;
  mode: SkillAssetMode;
  preloadLegacy: boolean;
  externalAssets: SkillAssetFileStatus[];
  workspaceFallback: SkillAssetFileStatus;
  activeAsset: SkillAssetFileStatus | null;
  boundary: {
    mayInform: string[];
    mustNotOverride: string[];
  };
}

const CHANNELS: Channel[] = ['boss', 'maimai', 'linkedin', 'followup'];

const WORKSPACE_SKILL_FILES: Record<Channel, string> = {
  boss: 'boss.md',
  maimai: 'maimai.md',
  linkedin: 'linkedin.md',
  followup: 'followup.md',
};

const EXTERNAL_SKILL_FILES: Partial<Record<Channel, string>> = {
  boss: path.join('bosszhibin-auto-recruiter', 'SKILL.md'),
  maimai: path.join('maimai-recruiter', 'SKILL.md'),
  linkedin: path.join('linkedin-candidate-recruiter', 'SKILL.md'),
};

function fileStatus(filePath: string, source: SkillAssetFileStatus['source']): SkillAssetFileStatus {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false, bytes: 0, source };
  return { path: filePath, exists: true, bytes: fs.statSync(filePath).size, source };
}

function modeFor(channel: Channel): SkillAssetMode {
  const protocol = getPlatformProtocol(channel);
  if (!protocol) return 'legacy-only';
  return config.skills.preloadLegacyForProductizedChannels ? 'preloaded' : 'productized-fallback-only';
}

function boundaryFor(mode: SkillAssetMode): SkillAssetManifestEntry['boundary'] {
  const mayInform = [
    'page-experience',
    'exception-cases',
    'migration-material',
    'examples',
  ];
  const mustNotOverride = [
    'code-guards',
    'tool-registry-policy',
    'platform-protocol',
    'capability-manifest',
    'structured-output-contracts',
    'user-current-instructions',
  ];
  if (mode === 'legacy-only') {
    return {
      mayInform: [...mayInform, 'runtime-prompt'],
      mustNotOverride: ['code-guards', 'tool-registry-policy', 'user-current-instructions'],
    };
  }
  return { mayInform, mustNotOverride };
}

export function buildSkillAssetManifest(): SkillAssetManifestEntry[] {
  return CHANNELS.map(channel => {
    const externalRel = EXTERNAL_SKILL_FILES[channel];
    const externalAssets = externalRel
      ? config.skills.homes.map(home => fileStatus(path.join(home, externalRel), 'external'))
      : [];
    const workspaceFallback = fileStatus(
      path.join(config.workspace.dir, 'skills', WORKSPACE_SKILL_FILES[channel]),
      'workspace',
    );
    const mode = modeFor(channel);
    const protocol = getPlatformProtocol(channel);
    return {
      channel,
      productProtocol: protocol?.name ?? null,
      mode,
      preloadLegacy: config.skills.preloadLegacyForProductizedChannels,
      externalAssets,
      workspaceFallback,
      activeAsset: externalAssets.find(asset => asset.exists) ?? (workspaceFallback.exists ? workspaceFallback : null),
      boundary: boundaryFor(mode),
    };
  });
}

export function formatSkillAssetManifest(): string {
  const manifest = buildSkillAssetManifest();
  return [
    'HireSeek Skill Asset Manifest',
    '',
    ...manifest.map(entry => {
      const external = entry.externalAssets.length
        ? entry.externalAssets.map(asset => `${asset.exists ? 'ok' : 'missing'}:${asset.path}`).join(', ')
        : 'none';
      const active = entry.activeAsset ? entry.activeAsset.path : 'none';
      return [
        `- ${entry.channel}`,
        `  productProtocol: ${entry.productProtocol ?? 'none'}`,
        `  mode: ${entry.mode}`,
        `  activeAsset: ${active}`,
        `  externalAssets: ${external}`,
        `  workspaceFallback: ${entry.workspaceFallback.exists ? 'ok' : 'missing'}:${entry.workspaceFallback.path}`,
        `  mayInform: ${entry.boundary.mayInform.join(', ')}`,
        `  mustNotOverride: ${entry.boundary.mustNotOverride.join(', ')}`,
      ].join('\n');
    }),
  ].join('\n');
}
