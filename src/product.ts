/**
 * 产品身份与路径/环境变量兼容层。
 *
 * 用户可见名称是 Seeya。命令、数据目录、环境变量仍识别 HireSeek / HireClaw，
 * 避免改名把已有配置和数据库丢掉。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export const PRODUCT_NAME = 'Seeya';
export const PRODUCT_CLI = 'seeya';
export const PRODUCT_CLI_ALIASES = ['hireseek'] as const;
export const LAUNCHD_LABEL = 'com.seeya.daemon';
export const LEGACY_LAUNCHD_LABELS = ['com.hireseek.daemon'] as const;

const ENV_PREFIXES = ['SEEYA', 'HIRESEEK', 'HIRECLAW'] as const;

export type EnvMap = NodeJS.Dict<string | undefined>;

export interface PathResolveOptions {
  env?: EnvMap;
  homedir?: string;
  exists?: (p: string) => boolean;
}

export function resolveHome(p: string, homedir: string = os.homedir()): string {
  return p.startsWith('~') ? path.join(homedir, p.slice(1)) : p;
}

export function productEnv(suffix: string, env: EnvMap = process.env): string {
  for (const prefix of ENV_PREFIXES) {
    const value = env[`${prefix}_${suffix}`];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function io(opts: PathResolveOptions = {}): {
  env: EnvMap;
  homedir: string;
  exists: (p: string) => boolean;
} {
  return {
    env: opts.env ?? process.env,
    homedir: opts.homedir ?? os.homedir(),
    exists: opts.exists ?? (p => fs.existsSync(p)),
  };
}

function firstExisting(paths: string[], exists: (p: string) => boolean): string | undefined {
  return paths.find(p => exists(p));
}

/** 数据目录：已有 ~/.seeya 用它；否则回退 ~/.hireseek / ~/.hireclaw；都没有则用 ~/.seeya */
export function resolveProductHome(opts: PathResolveOptions = {}): string {
  const { env, homedir, exists } = io(opts);
  const explicit = productEnv('HOME', env);
  if (explicit) return resolveHome(explicit, homedir);
  const seeyaHome = path.join(homedir, '.seeya');
  const hireseekHome = path.join(homedir, '.hireseek');
  const hireclawHome = path.join(homedir, '.hireclaw');
  return firstExisting([seeyaHome, hireseekHome, hireclawHome], exists) ?? seeyaHome;
}

export function resolveDbPath(opts: PathResolveOptions = {}): string {
  const { env, homedir, exists } = io(opts);
  const explicit = productEnv('DB_PATH', env);
  if (explicit) return resolveHome(explicit, homedir);
  const candidates = [
    path.join(homedir, '.seeya', 'seeya.db'),
    path.join(homedir, '.hireseek', 'hireseek.db'),
    path.join(homedir, '.hireclaw', 'hireclaw.db'),
  ];
  return firstExisting(candidates, exists) ?? candidates[0];
}

export function resolveBrowserProfileDir(opts: PathResolveOptions = {}): string {
  const { env, homedir, exists } = io(opts);
  const explicit = productEnv('BROWSER_PROFILE_DIR', env);
  if (explicit) return resolveHome(explicit, homedir);
  const candidates = [
    path.join(homedir, '.seeya', 'browser-profile'),
    path.join(homedir, '.hireseek', 'browser-profile'),
    path.join(homedir, '.hireclaw', 'browser-profile'),
  ];
  return firstExisting(candidates, exists) ?? candidates[0];
}

export function resolveDaemonLogPath(opts: PathResolveOptions = {}): string {
  return path.join(resolveProductHome(opts), 'daemon.log');
}

export function launchdPlistPath(label: string = LAUNCHD_LABEL, homedir: string = os.homedir()): string {
  return path.join(homedir, 'Library', 'LaunchAgents', `${label}.plist`);
}

/** 自有浏览器控制值内部仍记为 hireseek，避免改库里的 controller 枚举 */
export function normalizeBrowserControl(raw?: string | null): string {
  const key = (raw ?? 'chrome').trim().toLowerCase();
  if (key === 'seeya') return 'hireseek';
  return key || 'chrome';
}

export function usesOwnBrowser(control: string): boolean {
  return control === 'hireseek' || control === 'seeya';
}
