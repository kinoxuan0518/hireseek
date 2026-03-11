import fs from 'fs';
import path from 'path';
import { config } from './config';
import type { Channel } from './types';

const ACCOUNTS_DIR = path.join(config.workspace.dir, 'accounts');

/**
 * 生成账号唯一标识
 * 例如：boss_1, boss_2, maimai_1
 */
export function getAccountId(channel: Channel, index: number): string {
  return `${channel}_${index + 1}`;
}

/**
 * 获取账号 storage state 文件路径
 */
export function getAccountStoragePath(accountId: string): string {
  ensureAccountsDir();
  return path.join(ACCOUNTS_DIR, `${accountId}.json`);
}

/**
 * 检查账号是否已有保存的登录状态
 */
export function hasStorageState(accountId: string): boolean {
  const storagePath = getAccountStoragePath(accountId);
  return fs.existsSync(storagePath);
}

/**
 * 保存账号登录状态
 */
export async function saveStorageState(accountId: string, state: any): Promise<void> {
  ensureAccountsDir();
  const storagePath = getAccountStoragePath(accountId);
  fs.writeFileSync(storagePath, JSON.stringify(state, null, 2), 'utf-8');
  console.log(`[Accounts] ✓ 已保存 ${accountId} 的登录状态`);
}

/**
 * 删除账号登录状态（用于重新登录）
 */
export function removeStorageState(accountId: string): void {
  const storagePath = getAccountStoragePath(accountId);
  if (fs.existsSync(storagePath)) {
    fs.unlinkSync(storagePath);
    console.log(`[Accounts] 🗑️  已删除 ${accountId} 的登录状态`);
  }
}

/**
 * 获取所有已保存的账号列表
 */
export function listSavedAccounts(): string[] {
  ensureAccountsDir();
  const files = fs.readdirSync(ACCOUNTS_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * 确保 accounts 目录存在
 */
function ensureAccountsDir(): void {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  }
}
