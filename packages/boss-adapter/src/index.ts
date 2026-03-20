// @hireclaw/boss-adapter — BOSS直聘平台适配器
//
// 基于 Playwright 的浏览器自动化，实现 PlatformAdapter 接口
// 核心能力：候选人获取、页面解析、触达执行、频率控制、登录管理

import type {
  PlatformAdapter,
  CandidateFetchRequest,
  CandidateFetchResult,
  ReachOutRequest,
  ReachOutResult,
  ConversationStatus,
  PlatformStatus,
  Candidate,
} from '@hireclaw/core';

export interface BossAdapterConfig {
  /** 是否无头模式 */
  headless?: boolean;
  /** Chromium 可执行路径 */
  executablePath?: string;
  /** 登录状态文件路径 */
  accountStatePath?: string;
  /** 浏览器实例的用户数据目录 */
  userDataDir?: string;
}

/**
 * BOSS直聘适配器
 *
 * 实现 @hireclaw/core 的 PlatformAdapter 接口
 * 通过 Playwright 控制浏览器完成招聘自动化
 *
 * @example
 * ```ts
 * import { BossAdapter } from '@hireclaw/boss-adapter';
 *
 * const adapter = new BossAdapter({ headless: false });
 * await adapter.init();
 *
 * const result = await adapter.getCandidates({
 *   job: { id: '1', title: 'AI算法工程师', platforms: ['boss'] },
 *   limit: 30,
 * });
 *
 * for (const candidate of result.candidates) {
 *   await adapter.reachOut({ candidate, message: '...' });
 * }
 * ```
 */
export class BossAdapter implements PlatformAdapter {
  readonly name = 'boss';

  private config: Required<BossAdapterConfig>;
  private initialized = false;

  constructor(config: BossAdapterConfig = {}) {
    this.config = {
      headless: config.headless ?? false,
      executablePath: config.executablePath ?? '',
      accountStatePath: config.accountStatePath ?? '',
      userDataDir: config.userDataDir ?? '',
    };
  }

  async init(): Promise<void> {
    // TODO: Sprint 4 — 初始化 Playwright、加载登录状态
    this.initialized = true;
  }

  async destroy(): Promise<void> {
    // TODO: Sprint 4 — 关闭浏览器
    this.initialized = false;
  }

  async getCandidates(request: CandidateFetchRequest): Promise<CandidateFetchResult> {
    this.ensureInitialized();
    // TODO: Sprint 4
    // 1. 导航到 BOSS直聘推荐页
    // 2. 解析候选人列表（截图 → LLM → 提取信息）
    // 3. 转换为标准 Candidate 格式
    throw new Error('Not implemented — coming in Sprint 4');
  }

  async reachOut(request: ReachOutRequest): Promise<ReachOutResult> {
    this.ensureInitialized();
    // TODO: Sprint 4
    // 1. 导航到候选人聊天页
    // 2. 发送消息
    // 3. 检测频率限制/上限
    throw new Error('Not implemented — coming in Sprint 4');
  }

  async getConversationStatus(candidateId: string): Promise<ConversationStatus> {
    this.ensureInitialized();
    // TODO: Sprint 4
    throw new Error('Not implemented — coming in Sprint 4');
  }

  async getStatus(): Promise<PlatformStatus> {
    return {
      platform: 'boss',
      loggedIn: false,
      rateLimited: false,
      accountStatus: 'active',
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`BossAdapter not initialized. Call await adapter.init() first.`);
    }
  }
}
