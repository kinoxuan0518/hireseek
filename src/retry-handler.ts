import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

export interface Checkpoint {
  jobId: string;
  channel: string;
  accountId: string;
  contactedCandidates: string[];  // 已触达的候选人名单
  currentPosition: number;  // 当前浏览位置
  timestamp: string;
  status: 'in_progress' | 'paused' | 'error';
  errorMessage?: string;
}

const CHECKPOINTS_DIR = path.join(config.workspace.dir, 'checkpoints');

/**
 * 带指数退避的重试机制
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: any;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 检查是否应该重试
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // 等待后重试
      console.log(`[Retry] 第 ${attempt + 1} 次失败，${delay}ms 后重试...`);
      await sleep(delay);

      // 指数退避
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * 保存执行检查点
 */
export function saveCheckpoint(checkpoint: Checkpoint): void {
  ensureCheckpointsDir();

  const filename = `${checkpoint.jobId}_${checkpoint.channel}_${checkpoint.accountId}.json`;
  const filepath = path.join(CHECKPOINTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  console.log(`[Checkpoint] 💾 已保存进度：${filename}`);
}

/**
 * 加载执行检查点
 */
export function loadCheckpoint(jobId: string, channel: string, accountId: string): Checkpoint | null {
  ensureCheckpointsDir();

  const filename = `${jobId}_${channel}_${accountId}.json`;
  const filepath = path.join(CHECKPOINTS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const checkpoint = JSON.parse(content) as Checkpoint;

    // 检查检查点是否过期（超过 24 小时）
    const age = Date.now() - new Date(checkpoint.timestamp).getTime();
    if (age > 24 * 60 * 60 * 1000) {
      console.log(`[Checkpoint] ⚠️  检查点已过期（超过 24 小时），忽略`);
      removeCheckpoint(jobId, channel, accountId);
      return null;
    }

    return checkpoint;
  } catch (err) {
    console.error(`[Checkpoint] ✗ 加载失败：${err}`);
    return null;
  }
}

/**
 * 删除检查点
 */
export function removeCheckpoint(jobId: string, channel: string, accountId: string): void {
  const filename = `${jobId}_${channel}_${accountId}.json`;
  const filepath = path.join(CHECKPOINTS_DIR, filename);

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    console.log(`[Checkpoint] 🗑️  已删除检查点：${filename}`);
  }
}

/**
 * 列出所有检查点
 */
export function listCheckpoints(): Checkpoint[] {
  ensureCheckpointsDir();

  const files = fs.readdirSync(CHECKPOINTS_DIR).filter(f => f.endsWith('.json'));
  const checkpoints: Checkpoint[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(CHECKPOINTS_DIR, file), 'utf-8');
      checkpoints.push(JSON.parse(content));
    } catch (err) {
      console.error(`[Checkpoint] ✗ 读取失败：${file}`, err);
    }
  }

  return checkpoints;
}

/**
 * 等待用户处理问题（验证码、登录等）
 */
export async function waitForUserIntervention(message: string): Promise<void> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`⚠️  ${message}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`请在浏览器中处理后，按 Enter 继续...\n`);

  await new Promise<void>(resolve => {
    process.stdin.once('data', () => resolve());
  });

  console.log('[Recovery] ✓ 继续执行\n');
}

/**
 * 确保 checkpoints 目录存在
 */
function ensureCheckpointsDir(): void {
  if (!fs.existsSync(CHECKPOINTS_DIR)) {
    fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
  }
}

/**
 * 睡眠指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
