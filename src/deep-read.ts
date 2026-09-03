/**
 * 深读分层——点进简历通读，还是只看列表卡片。
 *
 * 模型早就能读整份简历了，老 skill 只看卡片是"模型看不见"那个年代的产物。
 * 但深读每人一份要花时间和 token，所以默认分层：
 *
 *   contact（默认）— 卡片可以直接淘汰，但要建议触达，必须先通读简历
 *   all            — 每个看过的人都要通读（未来的常态）
 *   off            — 保持旧行为，只看卡片也能建议触达
 *
 * 分层落在"建议触达"这个门上，而不是"看了几个人"上：真正稀缺的是推进名额，
 * 而 execute 只能触达 screen 标了 contact 的人，所以这道门一关，
 * 最终被触达的每一个人都必然是通读过简历的。
 */

import { productEnv } from './product';
import type { JobConfig } from './skills/loader';

export type DeepReadMode = 'off' | 'contact' | 'all';

const MODES: DeepReadMode[] = ['off', 'contact', 'all'];

export const DEFAULT_DEEP_READ_MODE: DeepReadMode = 'contact';

function normalize(raw: unknown): DeepReadMode | undefined {
  const key = String(raw ?? '').trim().toLowerCase();
  return MODES.find(mode => mode === key);
}

/**
 * 职位配置优先于环境变量——「先对特定职位开」就是这么表达的。
 */
export function resolveDeepReadMode(
  job?: Pick<JobConfig, 'deep_read'> | null,
  env: NodeJS.Dict<string | undefined> = process.env,
): DeepReadMode {
  return normalize(job?.deep_read)
    ?? normalize(productEnv('DEEP_READ', env))
    ?? DEFAULT_DEEP_READ_MODE;
}

/** 这条筛选判断要不要求通读简历 */
export function deepReadRequiredFor(
  mode: DeepReadMode,
  recommendation: 'contact' | 'maybe' | 'skip',
): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return recommendation === 'contact';
}

export function describeDeepReadMode(mode: DeepReadMode): string {
  switch (mode) {
    case 'all':
      return '每查看一个候选人都必须点进简历详情通读后再记录。';
    case 'contact':
      return '卡片信息足以淘汰的人可以直接 skip；但要给出 contact（建议正式触达），必须先点进简历详情通读整份简历。';
    case 'off':
      return '本轮不强制通读简历详情，但读到详情时仍要如实记录 reading_depth。';
  }
}
