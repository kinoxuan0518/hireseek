// @hireclaw/core/pipeline/human — 人工介入机制
//
// 参考 Claude Code 的 Ordinal 权限模式，设计三层人工介入机制：
// - Ordinal 0: 完全自主（自动执行）
// - Ordinal 1: 建议后执行（AI 推荐，人工确认）
// - Ordinal 2: 完全人工（仅通知，不自动执行）
//
// 人工介入点：
// - 敏感候选人（高薪/高管）需要 Ordinal 1 确认
// - 批量触达前需要 Ordinal 1 确认
// - 异常情况（平台限流/大量拒绝）触发 Ordinal 1/2

import type { Candidate, EvaluationResult } from '../../types.js';
import type { StageId } from '../stages/Stage.js';

// ────────────────────────────────────────────────────────────
// Ordinal Levels
// ────────────────────────────────────────────────────────────

/**
 * Ordinal 权限级别（参考 Claude Code 的 Ordinal 权限模式）
 *
 * - Ordinal 0: 完全自主，AI 自己决策
 * - Ordinal 1: 建议后执行，需要人工确认
 * - Ordinal 2: 完全人工，仅通知不执行
 */
export type OrdinalLevel = 0 | 1 | 2;

export const ORDINAL_LABELS: Record<OrdinalLevel, string> = {
  0: '🤖 完全自主',
  1: '👤 建议后执行',
  2: '🚫 完全人工',
};

/**
 * Ordinal 权限配置
 */
export interface OrdinalPermission {
  level: OrdinalLevel;
  reason: string;
  /** 需要确认的问题 */
  confirmationPrompt?: string;
  /** 批准人 */
  approvedBy?: string;
  /** 批准时间 */
  approvedAt?: string;
}

// ────────────────────────────────────────────────────────────
// Human In Loop Types
// ────────────────────────────────────────────────────────────

/**
 * 人工介入请求
 */
export interface HumanInLoopRequest {
  /** 请求ID */
  requestId: string;
  /** 关联的阶段 */
  stageId: StageId;
  /** 候选人（如果有） */
  candidate?: Candidate;
  /** 评估结果（如果有） */
  evaluation?: EvaluationResult;
  /** ordinal 级别 */
  ordinal: OrdinalLevel;
  /** 请求描述 */
  description: string;
  /** 建议的行动 */
  suggestedAction: string;
  /** 确认提示 */
  confirmationPrompt?: string;
  /** 批准人 */
  approvedBy?: string;
  /** 批准时间 */
  approvedAt?: string;
  /** 行动上下文 */
  context: Record<string, unknown>;
  /** 请求时间 */
  requestedAt: string;
  /** 状态 */
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  /** 过期时间（可选） */
  expiresAt?: string;
}

/**
 * 人工介入点触发条件
 */
export interface HumanInLoopTrigger {
  /** 触发器ID */
  triggerId: string;
  /** 触发器类型 */
  type: TriggerType;
  /** ordinal 级别 */
  ordinal: OrdinalLevel;
  /** 触发条件描述 */
  description: string;
  /** 触发条件 */
  condition: (ctx: TriggerContext) => boolean;
}

export type TriggerType =
  | 'high_salary'       // 高薪候选人
  | 'high_score'        // 高分候选人
  | 'executive'         // 高管/关键岗位
  | 'bulk_action'       // 批量操作
  | 'platform_limit'    // 平台限流
  | 'high_rejection'    // 大量拒绝
  | 'manual_override'   // 手动触发
  | 'threshold_exceeded'; // 阈值超出

export interface TriggerContext {
  candidate?: Candidate;
  evaluation?: EvaluationResult;
  stageId?: StageId;
  platform?: string;
  stats?: {
    totalCandidates?: number;
    rejectedCount?: number;
    outreachCount?: number;
    replyRate?: number;
  };
  /** 触发时间 */
  timestamp: string;
}

// ────────────────────────────────────────────────────────────
// HumanInLoop Manager
// ────────────────────────────────────────────────────────────

export interface HumanInLoopConfig {
  /** 全局 ordinal 级别 */
  defaultOrdinal?: OrdinalLevel;
  /** 请求过期时间（小时） */
  requestExpiryHours?: number;
  /** 是否启用自动过期 */
  autoExpire?: boolean;
}

export interface HumanInLoopStats {
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  expiredRequests: number;
}

/**
 * 人工介入管理器
 *
 * 参考 Claude Code 的 Ordinal 权限模式：
// - Ordinal 0: 完全自主（自动执行）
// - Ordinal 1: 建议后执行（AI 推荐，人工确认）
// - Ordinal 2: 完全人工（仅通知，不自动执行）
 *
 * @example
 * ```typescript
 * const hil = new HumanInLoop({ defaultOrdinal: 1 });
 *
 * // 注册触发器
 * hil.registerTrigger({
 *   triggerId: 'high_salary',
 *   type: 'high_salary',
 *   ordinal: 1,
 *   description: '高薪候选人需确认',
 *   condition: (ctx) => ctx.evaluation?.salaryExpectation > 50000
 * });
 *
 * // 检查是否需要人工介入
 * const request = hil.checkTriggers(candidate, evaluation, 'outreach');
 *
 * // 批准请求
 * hil.approve('req_123', 'Kino');
 * ```
 */
export class HumanInLoop {
  private config: HumanInLoopConfig;
  private requests: Map<string, HumanInLoopRequest> = new Map();
  private triggers: HumanInLoopTrigger[] = [];
  private listeners: Array<(req: HumanInLoopRequest) => void> = [];

  constructor(config: HumanInLoopConfig = {}) {
    this.config = {
      defaultOrdinal: config.defaultOrdinal ?? 0,
      requestExpiryHours: config.requestExpiryHours ?? 24,
      autoExpire: config.autoExpire ?? true,
    };

    this.registerDefaultTriggers();
  }

  // ── Trigger Management ──

  /**
   * 注册人工介入触发器
   */
  registerTrigger(trigger: HumanInLoopTrigger): void {
    this.triggers.push(trigger);
  }

  /**
   * 移除触发器
   */
  removeTrigger(triggerId: string): void {
    this.triggers = this.triggers.filter(t => t.triggerId !== triggerId);
  }

  /**
   * 获取所有触发器
   */
  getTriggers(): HumanInLoopTrigger[] {
    return [...this.triggers];
  }

  // ── Request Management ──

  /**
   * 检查是否需要人工介入
   */
  checkTriggers(
    candidate: Candidate | undefined,
    evaluation: EvaluationResult | undefined,
    stageId: StageId
  ): HumanInLoopRequest | null {
    const ctx: TriggerContext = {
      candidate,
      evaluation,
      stageId,
      timestamp: new Date().toISOString(),
    };

    // Find the highest ordinal trigger that matches
    let highestOrdinal: OrdinalLevel | null = null;
    let matchedTrigger: HumanInLoopTrigger | null = null;

    for (const trigger of this.triggers) {
      if (trigger.condition(ctx)) {
        if (highestOrdinal === null || trigger.ordinal > highestOrdinal) {
          highestOrdinal = trigger.ordinal;
          matchedTrigger = trigger;
        }
      }
    }

    if (highestOrdinal === null || highestOrdinal === 0) {
      return null; // No trigger matched, or matched ordinal 0 (no human in loop needed)
    }

    const request = this.createRequest(matchedTrigger, candidate, evaluation, stageId);
    this.requests.set(request.requestId, request);
    this.notifyListeners(request);

    return request;
  }

  /**
   * 批准人工介入请求
   */
  approve(requestId: string, approvedBy: string): boolean {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = 'approved';
    request.approvedBy = approvedBy;
    request.approvedAt = new Date().toISOString();

    return true;
  }

  /**
   * 拒绝人工介入请求
   */
  reject(requestId: string, rejectedBy?: string): boolean {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = 'rejected';
    if (rejectedBy) request.approvedBy = rejectedBy;
    request.approvedAt = new Date().toISOString();

    return true;
  }

  /**
   * 获取待处理的请求
   */
  getPendingRequests(): HumanInLoopRequest[] {
    return [...this.requests.values()].filter(r => r.status === 'pending');
  }

  /**
   * 获取请求详情
   */
  getRequest(requestId: string): HumanInLoopRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * 获取统计信息
   */
  getStats(): HumanInLoopStats {
    const requests = [...this.requests.values()];
    return {
      pendingRequests: requests.filter(r => r.status === 'pending').length,
      approvedRequests: requests.filter(r => r.status === 'approved').length,
      rejectedRequests: requests.filter(r => r.status === 'rejected').length,
      expiredRequests: requests.filter(r => r.status === 'expired').length,
    };
  }

  /**
   * 订阅新的请求
   */
  subscribe(listener: (req: HumanInLoopRequest) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * 清除过期请求
   */
  expireOldRequests(): number {
    if (!this.config.autoExpire) return 0;

    const expiryMs = (this.config.requestExpiryHours ?? 24) * 60 * 60 * 1000;
    const now = Date.now();
    let count = 0;

    for (const [id, req] of this.requests) {
      if (req.status === 'pending') {
        const requestedAt = new Date(req.requestedAt).getTime();
        if (now - requestedAt > expiryMs) {
          req.status = 'expired';
          count++;
        }
      }
    }

    return count;
  }

  // ── Private ──

  private createRequest(
    trigger: HumanInLoopTrigger | null,
    candidate: Candidate | undefined,
    evaluation: EvaluationResult | undefined,
    stageId: StageId
  ): HumanInLoopRequest {
    const suggestedAction = this.generateSuggestion(trigger, candidate, evaluation);
    const confirmationPrompt = this.generateConfirmationPrompt(trigger, candidate, evaluation);

    return {
      requestId: `hil_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      stageId,
      candidate,
      evaluation,
      ordinal: trigger?.ordinal ?? (this.config.defaultOrdinal ?? 0),
      description: trigger?.description ?? '未知原因需要人工介入',
      suggestedAction,
      confirmationPrompt,
      context: {
        triggerId: trigger?.triggerId,
        triggerType: trigger?.type,
      },
      requestedAt: new Date().toISOString(),
      status: 'pending',
      expiresAt: this.config.autoExpire
        ? new Date(Date.now() + (this.config.requestExpiryHours ?? 24) * 60 * 60 * 1000).toISOString()
        : undefined,
    };
  }

  private generateSuggestion(
    trigger: HumanInLoopTrigger | null,
    candidate: Candidate | undefined,
    evaluation: EvaluationResult | undefined
  ): string {
    if (!trigger) return '建议人工确认后执行';

    const name = candidate?.name ?? '候选人';

    switch (trigger.type) {
      case 'high_salary':
        return `建议为 ${name} 安排 1:1 沟通或由 HR 亲自跟进`;
      case 'high_score':
        return `建议优先触达 ${name}，该候选人为顶尖人才`;
      case 'executive':
        return `建议由招聘负责人或高管直接与 ${name} 沟通`;
      case 'bulk_action':
        return `建议分批次触达，每批不超过 10 人，避免触发平台限流`;
      case 'platform_limit':
        return `建议暂停触达 1-2 小时，等待平台配额恢复`;
      case 'high_rejection':
        return `建议暂停触达，分析拒绝原因后调整话术`;
      case 'threshold_exceeded':
        return `建议人工审核后继续`;
      default:
        return `建议人工确认后执行`;
    }
  }

  private generateConfirmationPrompt(
    trigger: HumanInLoopTrigger | null,
    candidate: Candidate | undefined,
    evaluation: EvaluationResult | undefined
  ): string {
    const name = candidate?.name ?? '该候选人';
    const score = evaluation?.score ?? 'N/A';

    return `是否确认对 ${name}（评分 ${score}）执行触达操作？\n\n原因：${trigger?.description ?? '未知原因'}\n\nordinal 级别：${ORDINAL_LABELS[trigger?.ordinal ?? (this.config.defaultOrdinal ?? 0)]}`;
  }

  private notifyListeners(req: HumanInLoopRequest): void {
    for (const listener of this.listeners) {
      try {
        listener(req);
      } catch (err) {
        console.error('[HumanInLoop] Listener error:', err);
      }
    }
  }

  /**
   * 注册默认触发器
   */
  private registerDefaultTriggers(): void {
    // 高分候选人 Ordinal 1（高分 = 高潜力 = 可能需要特殊对待）
    this.registerTrigger({
      triggerId: 'high_score',
      type: 'threshold_exceeded',
      ordinal: 1,
      description: '候选人评分 >= 95（顶尖），建议确认触达策略',
      condition: (ctx) => {
        return (ctx.evaluation?.score ?? 0) >= 95;
      },
    });

    // 批量操作 Ordinal 1
    this.registerTrigger({
      triggerId: 'bulk_action',
      type: 'bulk_action',
      ordinal: 1,
      description: '触达操作涉及 5+ 候选人',
      condition: (ctx) => (ctx.stats?.totalCandidates ?? 0) >= 5,
    });

    // 平台限流 Ordinal 1
    this.registerTrigger({
      triggerId: 'platform_limit',
      type: 'platform_limit',
      ordinal: 1,
      description: '平台触发限流，需要人工确认是否继续',
      condition: (ctx) => {
        // This would be set by the platform adapter
        return false; // Placeholder
      },
    });

    // 高管岗位 Ordinal 2
    this.registerTrigger({
      triggerId: 'executive',
      type: 'executive',
      ordinal: 2,
      description: '高管或关键岗位，仅通知不自动触达',
      condition: (ctx) => {
        if (!ctx.candidate?.profile?.experience) return false;
        // Check if any experience has "VP", "Director", "CTO", "CEO" etc
        return ctx.candidate.profile.experience.some(e =>
          /VP|vp|Director|CTO|CEO|副总裁|总监|首席/.test(e.title ?? '')
        );
      },
    });
  }
}
