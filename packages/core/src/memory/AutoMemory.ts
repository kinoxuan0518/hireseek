// @hireclaw/core/memory — 自动记忆（模式发现）
//
// 参考 Claude Code 的 compact.rs 结构化压缩摘要设计
// - 自动发现招聘模式并记录
// - 生成结构化摘要（而非简单截断）
// - 从历史交互中推断待办

import type { Candidate, CandidateFetchResult } from '../types.js';
import type { IMemoryStore, MemoryQueryFilter } from './MemoryStore.js';
import type { MemoryEntry } from '../types.js';
import type { CandidateInteraction } from './CandidateMemory.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface AutoMemoryConfig {
  store: IMemoryStore;
  /** 压缩阈值（记忆条目数超过此值时触发压缩） */
  compactionThreshold?: number;
  /** 压缩后保留的最近条目数（参考 Claude Code 的 preserve_recent_messages） */
  preserveRecentCount?: number;
  /** 是否启用自动模式发现 */
  autoDiscover?: boolean;
}

export interface MemoryPattern {
  type: PatternType;
  description: string;
  confidence: number;
  discoveredAt: string;
  occurrenceCount: number;
  examples: string[];
}

export type PatternType =
  | 'response_pattern'
  | 'skill_trend'
  | 'salary_expectation'
  | 'rejection_pattern'
  | 'candidate_quality'
  | 'platform_efficiency'
  | 'outreach_timing'
  | 'company_preference';

export interface MemorySummary {
  generatedAt: string;
  totalEntries: number;
  totalCandidates: number;
  patternCount: number;
  patterns: MemoryPattern[];
  pendingWork: PendingWorkItem[];
  stats: MemoryStats;
  timeline: TimelineEvent[];
}

export interface PendingWorkItem {
  description: string;
  priority: 'high' | 'medium' | 'low';
  relatedCandidateIds: string[];
  inference: string;
}

export interface MemoryStats {
  totalContacts: number;
  totalReplies: number;
  totalScreenings: number;
  totalInterviews: number;
  overallReplyRate: number;
  overallScreenRate: number;
}

export interface TimelineEvent {
  timestamp: string;
  type: string;
  description: string;
  candidateId?: string;
}

// ────────────────────────────────────────────────────────────
// AutoMemory
// ────────────────────────────────────────────────────────────

/**
 * 自动记忆管理器
 *
 * 参考 Claude Code 的 Auto Memory 和 compact.rs 设计：
 * - 自动发现招聘模式
 * - 生成结构化压缩摘要（而非简单截断）
 * - 从历史交互中推断待办
 */
export class AutoMemory {
  private store: IMemoryStore;
  private compactionThreshold: number;
  private preserveRecentCount: number;
  private autoDiscover: boolean;

  constructor(config: AutoMemoryConfig) {
    this.store = config.store;
    this.compactionThreshold = config.compactionThreshold ?? 100;
    this.preserveRecentCount = config.preserveRecentCount ?? 10;
    this.autoDiscover = config.autoDiscover ?? true;
  }

  // ── Core API ──

  /**
   * 自动发现模式（每次流水线运行后调用）
   */
  async discover(
    candidates: Candidate[],
    interactions: CandidateInteraction[],
    options?: { fetchResult?: CandidateFetchResult }
  ): Promise<MemoryPattern[]> {
    const patterns: MemoryPattern[] = [];

    const skillPattern = await this.discoverSkillTrends(candidates);
    if (skillPattern) patterns.push(skillPattern);

    const replyPattern = await this.discoverReplyPatterns(interactions);
    if (replyPattern) patterns.push(replyPattern);

    const qualityPattern = await this.discoverQualityDistribution(candidates);
    if (qualityPattern) patterns.push(qualityPattern);

    const timingPattern = await this.discoverOutreachTiming(interactions);
    if (timingPattern) patterns.push(timingPattern);

    if (options?.fetchResult) {
      const platformPattern = await this.discoverPlatformEfficiency(options.fetchResult);
      if (platformPattern) patterns.push(platformPattern);
    }

    for (const pattern of patterns) {
      await this.store.save(this.patternToMemoryEntry(pattern));
    }

    return patterns;
  }

  /**
   * 生成结构化压缩摘要
   */
  async compact(_jobId?: string): Promise<MemorySummary> {
    const now = new Date().toISOString();
    const allEntries = await this.store.query({ limit: 1000 });
    const patternEntries = allEntries.filter(e => e.type === 'pattern');
    const interactionEntries = allEntries.filter(e => e.type === 'candidate_interaction');

    const patterns: MemoryPattern[] = patternEntries.map(e => JSON.parse(e.content));
    const timeline = this.generateTimeline(allEntries);
    const pendingWork = this.inferPendingWork(allEntries);
    const stats = this.calculateStats(interactionEntries);

    return {
      generatedAt: now,
      totalEntries: allEntries.length,
      totalCandidates: new Set(
        interactionEntries.map(e => (e.metadata as Record<string, string>)?.candidateId)
      ).size,
      patternCount: patterns.length,
      patterns: patterns.slice(0, 5),
      pendingWork,
      stats,
      timeline: timeline.slice(0, 20),
    };
  }

  /**
   * 从历史中推断待办
   */
  inferPendingWork(allEntries?: MemoryEntry[]): PendingWorkItem[] {
    const entries = allEntries ?? [];
    const pending: PendingWorkItem[] = [];

    const interactionEntries = entries.filter(e => e.type === 'candidate_interaction');
    const contacted = new Set(
      interactionEntries
        .filter(e => ((e.metadata as Record<string, number>)?.outreachCount ?? 0) > 0)
        .map(e => (e.metadata as Record<string, string>)?.candidateId)
    );

    const discovered = interactionEntries.filter(e =>
      ((e.metadata as Record<string, number>)?.outreachCount ?? 0) === 0
    );

    if (discovered.length > 0) {
      pending.push({
        description: `有 ${discovered.length} 位候选人发现后未触达`,
        priority: 'high',
        relatedCandidateIds: discovered
          .map(e => (e.metadata as Record<string, string>)?.candidateId)
          .filter((id): id is string => typeof id === 'string'),
        inference: '这些候选人评估通过但尚未触达，可能流失',
      });
    }

    const awaitingReply = interactionEntries.filter(e => {
      const meta = e.metadata as Record<string, unknown>;
      return (meta?.outreachCount as number) > 0 && meta?.lastInteractionType === 'contacted';
    });

    if (awaitingReply.length > 0) {
      pending.push({
        description: `有 ${awaitingReply.length} 位候选人触达后未收到回复`,
        priority: 'medium',
        relatedCandidateIds: awaitingReply
          .map(e => (e.metadata as Record<string, string>)?.candidateId)
          .filter((id): id is string => typeof id === 'string'),
        inference: '建议等待 2-3 天后跟进或换平台触达',
      });
    }

    const stuckInScreening = interactionEntries.filter(e => {
      const meta = e.metadata as Record<string, unknown>;
      return meta?.lastInteractionType === 'screening';
    });

    if (stuckInScreening.length > 0) {
      pending.push({
        description: `有 ${stuckInScreening.length} 位候选人停留在筛选阶段`,
        priority: 'medium',
        relatedCandidateIds: stuckInScreening
          .map(e => (e.metadata as Record<string, string>)?.candidateId)
          .filter((id): id is string => typeof id === 'string'),
        inference: '建议推进到面试阶段或更新候选人状态',
      });
    }

    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    pending.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return pending;
  }

  /**
   * 获取所有已发现的模式
   */
  async getPatterns(options?: {
    type?: PatternType;
    minConfidence?: number;
  }): Promise<MemoryPattern[]> {
    const allEntries = await this.store.query({ type: 'pattern', limit: 100 });
    let patterns = allEntries.map(e => JSON.parse(e.content) as MemoryPattern);

    if (options?.type) {
      patterns = patterns.filter(p => p.type === options.type);
    }
    if (options?.minConfidence !== undefined) {
      patterns = patterns.filter(p => p.confidence >= (options.minConfidence ?? 0));
    }

    return patterns;
  }

  // ── Pattern Discovery ──

  private async discoverSkillTrends(candidates: Candidate[]): Promise<MemoryPattern | null> {
    if (candidates.length < 5) return null;

    const skillCounts: Record<string, number> = {};
    for (const c of candidates) {
      for (const skill of c.profile.skills ?? []) {
        const s = skill.toLowerCase();
        skillCounts[s] = (skillCounts[s] ?? 0) + 1;
      }
    }

    const threshold = candidates.length * 0.5;
    const trending = Object.entries(skillCounts)
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill, count]) => `${skill}(${count})`);

    if (trending.length === 0) return null;

    return {
      type: 'skill_trend',
      description: `市场趋势技能: ${trending.join(', ')}`,
      confidence: Math.min(0.9, trending.length / 10),
      discoveredAt: new Date().toISOString(),
      occurrenceCount: candidates.length,
      examples: trending,
    };
  }

  private async discoverReplyPatterns(interactions: CandidateInteraction[]): Promise<MemoryPattern | null> {
    const contacted = interactions.filter(i => i.type === 'contacted');
    const replied = interactions.filter(i => i.type === 'replied');

    if (contacted.length === 0) return null;

    const replyRate = replied.length / contacted.length;
    const hourCounts: Record<number, { contacted: number; replied: number }> = {};

    for (const i of contacted) {
      const hour = new Date(i.timestamp).getHours();
      if (!hourCounts[hour]) hourCounts[hour] = { contacted: 0, replied: 0 };
      hourCounts[hour].contacted++;
    }
    for (const i of replied) {
      const hour = new Date(i.timestamp).getHours();
      if (!hourCounts[hour]) hourCounts[hour] = { contacted: 0, replied: 0 };
      hourCounts[hour].replied++;
    }

    let bestHour = 0;
    let bestRate = 0;
    for (const [hour, data] of Object.entries(hourCounts)) {
      if (data.contacted >= 3) {
        const rate = data.replied / data.contacted;
        if (rate > bestRate) {
          bestRate = rate;
          bestHour = parseInt(hour, 10);
        }
      }
    }

    return {
      type: 'outreach_timing',
      description: `触达回复率 ${(replyRate * 100).toFixed(1)}%，最佳触达时间 ${bestHour}:00`,
      confidence: Math.min(0.9, contacted.length / 20),
      discoveredAt: new Date().toISOString(),
      occurrenceCount: contacted.length,
      examples: [`最佳触达时段: ${bestHour}:00 (回复率 ${(bestRate * 100).toFixed(1)}%)`],
    };
  }

  private async discoverQualityDistribution(candidates: Candidate[]): Promise<MemoryPattern | null> {
    const evaluated = candidates.filter(c => c.evaluation);
    if (evaluated.length < 3) return null;

    const scores = evaluated.map(c => c.evaluation!.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const highCount = scores.filter(s => s >= 80).length;
    const passRate = highCount / evaluated.length;

    return {
      type: 'candidate_quality',
      description: `候选人平均评分 ${avg.toFixed(1)}，通过率 ${(passRate * 100).toFixed(1)}%`,
      confidence: Math.min(0.9, evaluated.length / 20),
      discoveredAt: new Date().toISOString(),
      occurrenceCount: evaluated.length,
      examples: [
        `平均分: ${avg.toFixed(1)}`,
        `高分(>=80): ${highCount}/${evaluated.length}`,
        `通过率: ${(passRate * 100).toFixed(1)}%`,
      ],
    };
  }

  private async discoverOutreachTiming(interactions: CandidateInteraction[]): Promise<MemoryPattern | null> {
    return this.discoverReplyPatterns(interactions);
  }

  private async discoverPlatformEfficiency(result: CandidateFetchResult): Promise<MemoryPattern | null> {
    if (!result.platformStatus) return null;
    const status = result.platformStatus;
    return {
      type: 'platform_efficiency',
      description: `平台剩余配额: ${status.remainingQuota ?? 'unknown'}`,
      confidence: 0.5,
      discoveredAt: new Date().toISOString(),
      occurrenceCount: 1,
      examples: [
        `平台: ${status.platform}`,
        `剩余配额: ${status.remainingQuota ?? 'N/A'}`,
        `频率限制: ${status.rateLimited ? '是' : '否'}`,
      ],
    };
  }

  // ── Helpers ──

  private generateTimeline(entries: MemoryEntry[]): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    for (const entry of entries) {
      const meta = entry.metadata as Record<string, string>;
      events.push({
        timestamp: entry.createdAt,
        type: entry.type,
        description: entry.content.slice(0, 100),
        candidateId: meta?.candidateId,
      });
    }
    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  private calculateStats(interactionEntries: MemoryEntry[]): MemoryStats {
    let totalContacts = 0;
    for (const entry of interactionEntries) {
      const meta = entry.metadata as Record<string, number>;
      totalContacts += meta?.outreachCount ?? 0;
    }
    return {
      totalContacts,
      totalReplies: 0,
      totalScreenings: 0,
      totalInterviews: 0,
      overallReplyRate: 0,
      overallScreenRate: 0,
    };
  }

  private patternToMemoryEntry(pattern: MemoryPattern): MemoryEntry {
    return {
      id: `pattern_${pattern.type}_${Date.now()}`,
      type: 'pattern',
      content: JSON.stringify(pattern),
      metadata: {
        patternType: pattern.type,
        confidence: pattern.confidence,
        discoveredAt: pattern.discoveredAt,
      },
      createdAt: pattern.discoveredAt,
      updatedAt: pattern.discoveredAt,
    };
  }
}
