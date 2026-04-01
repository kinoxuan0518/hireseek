// @hireclaw/core/memory — 候选人记忆管理
//
// 跨会话记住候选人信息，参考 Claude Code 的 Auto Memory 理念
// - 每次触达后自动记录评估快照
// - 记录关键交互和决策
// - 支持通过候选人 ID 召回历史

import type { Candidate, EvaluationResult, OutreachRecord } from '../types.js';
import type { IMemoryStore, MemoryQueryFilter } from './MemoryStore.js';
import type { MemoryEntry } from '../types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface CandidateMemoryEntry {
  candidateId: string;
  candidateName: string;
  platform: string;
  /** 首次发现时间 */
  firstSeenAt: string;
  /** 最后一次交互时间 */
  lastInteractionAt: string;
  /** 总触达次数 */
  outreachCount: number;
  /** 评估历史快照（每次触达记录一次） */
  evaluationHistory: EvaluationSnapshot[];
  /** 交互历史 */
  interactions: CandidateInteraction[];
  /** 标签（手动 + 自动） */
  tags: string[];
  /** 备注 */
  notes: string[];
  /** 评估汇总 */
  assessmentSummary?: string;
}

export interface EvaluationSnapshot {
  evaluatedAt: string;
  score: number;
  passed: boolean;
  priority: EvaluationResult['priority'];
  dimensions: EvaluationResult['dimensions'];
  summary?: string;
}

export interface CandidateInteraction {
  /** 交互时间 */
  timestamp: string;
  /** 交互类型 */
  type: 'discovered' | 'contacted' | 'replied' | 'screened' | 'interviewed' | 'offered' | 'joined' | 'rejected' | 'dropped' | 'note_added';
  /** 触达渠道 */
  platform?: string;
  /** 交互内容摘要 */
  content: string;
  /** 消息内容（触达/回复时） */
  message?: string;
  /** 交互结果 */
  outcome?: 'success' | 'ignored' | 'failed' | 'pending';
}

// ────────────────────────────────────────────────────────────
// CandidateMemory
// ────────────────────────────────────────────────────────────

export interface CandidateMemoryConfig {
  /** 记忆存储 */
  store: IMemoryStore;
  /** 自动添加的标签策略 */
  autoTag?: boolean;
}

/**
 * 候选人记忆管理器
 *
 * 跨会话记住候选人信息，不丢失任何交互历史
 *
 * @example
 * ```typescript
 * const memory = new CandidateMemory({ store: myStore });
 *
 * // 发现新候选人
 * await memory.remember(candidate, { type: 'discovered' });
 *
 * // 触达后记录评估
 * await memory.recordEvaluation(candidate.id, evaluation);
 *
 * // 召回历史
 * const history = await memory.recall('candidate_123');
 * ```
 */
export class CandidateMemory {
  private store: IMemoryStore;
  private autoTag: boolean;

  constructor(config: CandidateMemoryConfig) {
    this.store = config.store;
    this.autoTag = config.autoTag ?? true;
  }

  // ── Core API ──

  /**
   * 记住一个候选人（首次发现时调用）
   */
  async remember(candidate: Candidate, context: RememberContext): Promise<CandidateMemoryEntry> {
    const now = new Date().toISOString();
    const candidateId = candidate.id;

    // Check if already exists
    const existing = await this.getEntry(candidateId);
    if (existing) {
      // Update last interaction time
      await this.appendInteraction(candidateId, {
        timestamp: now,
        type: context.type,
        platform: context.platform,
        content: context.content ?? `Candidate ${context.type}`,
        outcome: context.outcome,
      });
      return existing;
    }

    // Create new entry
    const entry: CandidateMemoryEntry = {
      candidateId,
      candidateName: candidate.name,
      platform: candidate.platform,
      firstSeenAt: now,
      lastInteractionAt: now,
      outreachCount: 0,
      evaluationHistory: [],
      interactions: [{
        timestamp: now,
        type: context.type,
        platform: context.platform,
        content: context.content ?? `Candidate ${context.type}`,
        outcome: context.outcome,
        message: context.message,
      }],
      tags: [],
      notes: [],
    };

    // Auto-tag
    if (this.autoTag) {
      entry.tags = this.generateAutoTags(candidate);
    }

    // Persist to store
    await this.store.save(this.toMemoryEntry(entry));

    return entry;
  }

  /**
   * 召回候选人的完整记忆
   */
  async recall(candidateId: string): Promise<CandidateMemoryEntry | null> {
    return this.getEntry(candidateId);
  }

  /**
   * 召回候选人的交互历史
   */
  async recallInteractions(candidateId: string, options?: {
    limit?: number;
    type?: CandidateInteraction['type'];
  }): Promise<CandidateInteraction[]> {
    const entry = await this.recall(candidateId);
    if (!entry) return [];

    let interactions = entry.interactions;
    if (options?.type) {
      interactions = interactions.filter(i => i.type === options.type);
    }
    if (options?.limit) {
      interactions = interactions.slice(-options.limit);
    }

    return interactions;
  }

  /**
   * 记录一次评估快照
   */
  async recordEvaluation(candidateId: string, evaluation: EvaluationResult): Promise<void> {
    const entry = await this.recall(candidateId);
    if (!entry) return;

    entry.evaluationHistory.push({
      evaluatedAt: new Date().toISOString(),
      score: evaluation.score,
      passed: evaluation.passed,
      priority: evaluation.priority,
      dimensions: evaluation.dimensions,
      summary: evaluation.summary,
    });

    entry.lastInteractionAt = new Date().toISOString();

    if (evaluation.summary) {
      entry.assessmentSummary = evaluation.summary;
    }

    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 记录一次触达
   */
  async recordOutreach(
    candidateId: string,
    record: OutreachRecord,
    evaluation: EvaluationResult
  ): Promise<void> {
    const entry = await this.recall(candidateId);
    if (!entry) return;

    entry.outreachCount += 1;
    entry.lastInteractionAt = new Date().toISOString();

    await this.appendInteraction(candidateId, {
      timestamp: record.sentAt,
      type: 'contacted',
      platform: record.platform,
      content: `触达消息已发送 (${record.result})`,
      outcome: record.result === 'sent' ? 'success' : 'failed',
      message: record.message,
    });

    if (evaluation) {
      entry.evaluationHistory.push({
        evaluatedAt: record.sentAt,
        score: evaluation.score,
        passed: evaluation.passed,
        priority: evaluation.priority,
        dimensions: evaluation.dimensions,
        summary: evaluation.summary,
      });
    }

    if (evaluation.summary) {
      entry.assessmentSummary = evaluation.summary;
    }

    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 追加交互记录
   */
  async appendInteraction(candidateId: string, interaction: CandidateInteraction): Promise<void> {
    const entry = await this.recall(candidateId);
    if (!entry) return;

    entry.interactions.push(interaction);
    entry.lastInteractionAt = interaction.timestamp;

    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 添加标签
   */
  async addTag(candidateId: string, tag: string): Promise<void> {
    const entry = await this.recall(candidateId);
    if (!entry) return;

    if (!entry.tags.includes(tag)) {
      entry.tags.push(tag);
      await this.store.save(this.toMemoryEntry(entry));
    }
  }

  /**
   * 添加备注
   */
  async addNote(candidateId: string, note: string, timestamp?: string): Promise<void> {
    const entry = await this.recall(candidateId);
    if (!entry) return;

    entry.notes.push(note);

    const interaction: CandidateInteraction = {
      timestamp: timestamp ?? new Date().toISOString(),
      type: 'note_added',
      content: note,
      outcome: 'success',
    };
    entry.interactions.push(interaction);
    entry.lastInteractionAt = interaction.timestamp;

    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 获取所有候选人记忆（分页）
   */
  async listAll(options?: {
    limit?: number;
    after?: string;
    platform?: string;
  }): Promise<CandidateMemoryEntry[]> {
    const filter: MemoryQueryFilter = {
      type: 'candidate_interaction',
      after: options?.after,
      limit: options?.limit ?? 50,
    };

    const entries = await this.store.query(filter);
    let results = entries.map(e => this.fromMemoryEntry(e));

    if (options?.platform) {
      results = results.filter(e => e.platform === options.platform);
    }

    return results;
  }

  /**
   * 获取触达次数最多的候选人
   */
  async getMostContacted(limit = 10): Promise<CandidateMemoryEntry[]> {
    const all = await this.listAll({ limit: 100 });
    return all
      .filter(e => e.outreachCount > 0)
      .sort((a, b) => b.outreachCount - a.outreachCount)
      .slice(0, limit);
  }

  /**
   * 获取长期未交互的候选人
   */
  async getStaleCandidates(maxDaysSinceInteraction = 7): Promise<CandidateMemoryEntry[]> {
    const cutoff = new Date(Date.now() - maxDaysSinceInteraction * 24 * 60 * 60 * 1000).toISOString();
    const all = await this.listAll({ limit: 100 });

    return all.filter(e => e.lastInteractionAt < cutoff && e.outreachCount > 0);
  }

  /**
   * 生成结构化摘要（参考 Claude Code compact.rs）
   * 用于上下文压缩时保留关键信息
   */
  async generateSummary(candidateId: string): Promise<string> {
    const entry = await this.recall(candidateId);
    if (!entry) return '';

    const lines: string[] = [];
    lines.push(`## 候选人: ${entry.candidateName} (${entry.platform})`);
    lines.push(`首次发现: ${entry.firstSeenAt.slice(0, 10)}`);
    lines.push(`最近交互: ${entry.lastInteractionAt.slice(0, 10)}`);
    lines.push(`触达次数: ${entry.outreachCount}`);

    if (entry.evaluationHistory.length > 0) {
      const latest = entry.evaluationHistory[entry.evaluationHistory.length - 1];
      lines.push(`最新评分: ${latest.score}/100 (${latest.passed ? '通过' : '未通过'})`);
    }

    if (entry.tags.length > 0) {
      lines.push(`标签: ${entry.tags.join(', ')}`);
    }

    if (entry.interactions.length > 0) {
      lines.push('## 关键交互:');
      const recent = entry.interactions.slice(-5);
      for (const i of recent) {
        lines.push(`- [${i.timestamp.slice(0, 10)}] ${i.type}: ${i.content}`);
      }
    }

    return lines.join('\n');
  }

  // ── Private Helpers ──

  private async getEntry(candidateId: string): Promise<CandidateMemoryEntry | null> {
    const entries = await this.store.query({
      metadata: { candidateId },
      limit: 1,
    });
    return entries.length > 0 ? this.fromMemoryEntry(entries[0]) : null;
  }

  /** 生成自动标签 */
  private generateAutoTags(candidate: Candidate): string[] {
    const tags: string[] = [];

    tags.push(`platform:${candidate.platform}`);

    const topSchools = ['清华', '北大', '复旦', '上交', '浙大', '中科大', 'MIT', 'Stanford', 'CMU'];
    if (candidate.profile.education?.some(e =>
      topSchools.some(s => e.school?.includes(s))
    )) {
      tags.push('top-school');
    }

    const topCompanies = ['字节', '腾讯', '阿里', '华为', '百度', '美团', 'Google', 'Meta', 'Microsoft'];
    if (candidate.profile.experience?.some(e =>
      topCompanies.some(c => e.company?.includes(c))
    )) {
      tags.push('top-company');
    }

    if (candidate.evaluation && candidate.evaluation.score >= 85) {
      tags.push('high-score');
    }

    return tags;
  }

  /** CandidateMemoryEntry → MemoryEntry */
  private toMemoryEntry(entry: CandidateMemoryEntry): MemoryEntry {
    return {
      id: `candidate_${entry.candidateId}`,
      type: 'candidate_interaction',
      content: JSON.stringify(entry),
      metadata: {
        candidateId: entry.candidateId,
        candidateName: entry.candidateName,
        platform: entry.platform,
        firstSeenAt: entry.firstSeenAt,
        lastInteractionAt: entry.lastInteractionAt,
        outreachCount: entry.outreachCount,
        tags: entry.tags,
      },
      createdAt: entry.firstSeenAt,
      updatedAt: entry.lastInteractionAt,
    };
  }

  /** MemoryEntry → CandidateMemoryEntry */
  private fromMemoryEntry(entry: MemoryEntry): CandidateMemoryEntry {
    return JSON.parse(entry.content);
  }
}

// ────────────────────────────────────────────────────────────
// Context Types
// ────────────────────────────────────────────────────────────

export interface RememberContext {
  type: CandidateInteraction['type'];
  platform?: string;
  content?: string;
  message?: string;
  outcome?: CandidateInteraction['outcome'];
}
