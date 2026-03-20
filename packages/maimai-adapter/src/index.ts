// @hireclaw/maimai-adapter — 脉脉平台适配器
//
// TODO: Sprint 4 之后实现，结构同 boss-adapter
// 参考 workspace/skills/maimai.md 的执行逻辑

import type {
  PlatformAdapter,
  CandidateFetchRequest,
  CandidateFetchResult,
  ReachOutRequest,
  ReachOutResult,
  ConversationStatus,
  PlatformStatus,
} from '@hireclaw/core';

export class MaimaiAdapter implements PlatformAdapter {
  readonly name = 'maimai';

  async init(): Promise<void> {
    // TODO: Sprint 5+
  }

  async getCandidates(_request: CandidateFetchRequest): Promise<CandidateFetchResult> {
    throw new Error('Not implemented');
  }

  async reachOut(_request: ReachOutRequest): Promise<ReachOutResult> {
    throw new Error('Not implemented');
  }

  async getConversationStatus(_candidateId: string): Promise<ConversationStatus> {
    throw new Error('Not implemented');
  }

  async getStatus(): Promise<PlatformStatus> {
    return {
      platform: 'maimai',
      loggedIn: false,
      rateLimited: false,
      accountStatus: 'active',
    };
  }
}
