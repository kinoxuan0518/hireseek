// @hireclaw/core/tracking — 候选人触达状态追踪
//
// Track candidate status through the recruitment funnel:
// contacted → replied → screening → interviewed → offered → joined → rejected/dropped
//
// Simple file-based storage (JSON), no database required.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/**
 * Candidate status in the recruitment funnel.
 *
 * Positive flow: contacted → replied → screening → interviewed → offered → joined
 * Negative exits: rejected (by us), dropped (by candidate)
 */
export type CandidateStatus =
  | 'new'          // 已发现，未触达
  | 'contacted'    // 已发送触达消息
  | 'replied'      // 候选人已回复
  | 'screening'    // 简历筛选中/初试安排中
  | 'interviewed'  // 已面试
  | 'offered'      // 已发 offer
  | 'joined'       // 已入职
  | 'rejected'     // 我们拒绝
  | 'dropped';     // 候选人放弃/失联

/** Valid status transitions (from → set of allowed next statuses) */
export const STATUS_TRANSITIONS: Record<CandidateStatus, CandidateStatus[]> = {
  new: ['contacted', 'rejected', 'dropped'],
  contacted: ['replied', 'rejected', 'dropped'],
  replied: ['screening', 'rejected', 'dropped'],
  screening: ['interviewed', 'rejected', 'dropped'],
  interviewed: ['offered', 'rejected', 'dropped'],
  offered: ['joined', 'rejected', 'dropped'],
  joined: [],  // Terminal
  rejected: [], // Terminal
  dropped: [],  // Terminal
};

/** Status display info */
export const STATUS_LABELS: Record<CandidateStatus, string> = {
  new: '🆕 新发现',
  contacted: '📩 已触达',
  replied: '💬 已回复',
  screening: '🔍 筛选中',
  interviewed: '🎯 已面试',
  offered: '📋 已发 Offer',
  joined: '🎉 已入职',
  rejected: '❌ 已拒绝',
  dropped: '📴 已放弃',
};

export interface TrackingEntry {
  /** 候选人 ID */
  candidateId: string;
  /** 候选人姓名 */
  candidateName: string;
  /** 当前状态 */
  status: CandidateStatus;
  /** 来源平台 */
  platform?: string;
  /** 状态变更历史 */
  history: StatusChange[];
  /** 触达记录 */
  outreachRecords: OutreachEvent[];
  /** 备注 */
  notes?: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 创建时间 */
  createdAt: string;
}

export interface StatusChange {
  from: CandidateStatus;
  to: CandidateStatus;
  reason?: string;
  timestamp: string;
}

export interface OutreachEvent {
  type: 'sent' | 'received' | 'follow_up';
  platform: string;
  content?: string;
  timestamp: string;
  result?: 'sent' | 'failed' | 'replied' | 'ignored';
}

export interface FollowUpReminder {
  candidateId: string;
  candidateName: string;
  status: CandidateStatus;
  /** Days since last activity */
  daysSinceActivity: number;
  /** Suggested action */
  suggestedAction: string;
  /** Priority: higher = more urgent */
  priority: 'urgent' | 'normal' | 'low';
}

// ────────────────────────────────────────────────────────────
// Tracker (file-based storage)
// ────────────────────────────────────────────────────────────

export interface TrackerConfig {
  /** Storage file path (JSON) */
  storagePath?: string;
}

export class CandidateTracker {
  private storagePath: string;
  private cache: Map<string, TrackingEntry> = new Map();
  private dirty = false;

  constructor(config: TrackerConfig = {}) {
    this.storagePath = config.storagePath ?? join(process.cwd(), '.hireclaw', 'tracking.json');
  }

  // ── Core CRUD ──

  /** Initialize tracker (load from disk) */
  async init(): Promise<void> {
    try {
      const data = await readFile(this.storagePath, 'utf-8');
      const entries = JSON.parse(data) as TrackingEntry[];
      for (const entry of entries) {
        this.cache.set(entry.candidateId, entry);
      }
    } catch (err) {
      // File doesn't exist yet — that's fine
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /** Persist all data to disk */
  async save(): Promise<void> {
    const dir = dirname(this.storagePath);
    await mkdir(dir, { recursive: true });
    const entries = [...this.cache.values()];
    await writeFile(this.storagePath, JSON.stringify(entries, null, 2), 'utf-8');
    this.dirty = false;
  }

  /** Get tracking entry for a candidate */
  get(candidateId: string): TrackingEntry | undefined {
    return this.cache.get(candidateId);
  }

  /** Get all tracking entries */
  getAll(): TrackingEntry[] {
    return [...this.cache.values()];
  }

  /** Get entries by status */
  getByStatus(status: CandidateStatus): TrackingEntry[] {
    return [...this.cache.values()].filter(e => e.status === status);
  }

  // ── Status Management ──

  /**
   * Register a new candidate for tracking.
   */
  register(candidateId: string, candidateName: string, platform?: string): TrackingEntry {
    const now = new Date().toISOString();
    const entry: TrackingEntry = {
      candidateId,
      candidateName,
      status: 'new',
      platform,
      history: [],
      outreachRecords: [],
      updatedAt: now,
      createdAt: now,
    };
    this.cache.set(candidateId, entry);
    this.dirty = true;
    return entry;
  }

  /**
   * Transition a candidate to a new status.
   * Throws if the transition is invalid.
   */
  transition(candidateId: string, newStatus: CandidateStatus, reason?: string): TrackingEntry {
    const entry = this.cache.get(candidateId);
    if (!entry) {
      throw new Error(`Candidate ${candidateId} not found in tracker`);
    }

    const allowed = STATUS_TRANSITIONS[entry.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${entry.status} → ${newStatus}. Allowed: ${allowed.join(', ')}`
      );
    }

    const now = new Date().toISOString();
    entry.history.push({
      from: entry.status,
      to: newStatus,
      reason,
      timestamp: now,
    });

    entry.status = newStatus;
    entry.updatedAt = now;
    this.dirty = true;

    return entry;
  }

  /**
   * Record an outreach event (message sent/received/follow-up).
   */
  recordOutreach(candidateId: string, event: Omit<OutreachEvent, 'timestamp'>): TrackingEntry {
    let entry = this.cache.get(candidateId);

    if (!entry) {
      throw new Error(`Candidate ${candidateId} not found. Register first.`);
    }

    const fullEvent: OutreachEvent = { ...event, timestamp: new Date().toISOString() };
    entry.outreachRecords.push(fullEvent);

    // Auto-transition on outreach events
    if (event.type === 'sent' && entry.status === 'new') {
      this.transition(candidateId, 'contacted');
    } else if (event.type === 'received' && entry.status === 'contacted') {
      this.transition(candidateId, 'replied', '收到回复');
    }

    entry.updatedAt = new Date().toISOString();
    this.dirty = true;
    return entry;
  }

  // ── Follow-up Reminders ──

  /**
   * Get candidates that need follow-up.
   * Checks for candidates who haven't been contacted in a while or need next steps.
   */
  getFollowUpReminders(options?: {
    /** Max days since last activity before flagging (default: 3) */
    maxDaysSinceActivity?: number;
  }): FollowUpReminder[] {
    const maxDays = options?.maxDaysSinceActivity ?? 3;
    const now = Date.now();
    const reminders: FollowUpReminder[] = [];

    for (const entry of this.cache.values()) {
      // Skip terminal states
      if (['joined', 'rejected', 'dropped'].includes(entry.status)) continue;

      // Find last activity timestamp
      const lastActivity = this.getLastActivity(entry);
      const daysSince = Math.floor((now - lastActivity.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince >= maxDays) {
        reminders.push({
          candidateId: entry.candidateId,
          candidateName: entry.candidateName,
          status: entry.status,
          daysSinceActivity: daysSince,
          suggestedAction: getSuggestedAction(entry.status, daysSince),
          priority: getFollowUpPriority(entry.status, daysSince),
        });
      }
    }

    // Sort by priority (urgent first)
    const priorityOrder = { urgent: 0, normal: 1, low: 2 };
    reminders.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return reminders;
  }

  // ── Stats ──

  /**
   * Get funnel statistics for the tracker.
   */
  getFunnelStats(): Record<CandidateStatus, number> {
    const stats: Record<CandidateStatus, number> = {
      new: 0,
      contacted: 0,
      replied: 0,
      screening: 0,
      interviewed: 0,
      offered: 0,
      joined: 0,
      rejected: 0,
      dropped: 0,
    };

    for (const entry of this.cache.values()) {
      stats[entry.status]++;
    }

    return stats;
  }

  // ── Helpers ──

  private getLastActivity(entry: TrackingEntry): Date {
    // Check outreach records first
    if (entry.outreachRecords.length > 0) {
      const lastRecord = entry.outreachRecords[entry.outreachRecords.length - 1];
      return new Date(lastRecord.timestamp);
    }

    // Fall back to last status change
    if (entry.history.length > 0) {
      const lastChange = entry.history[entry.history.length - 1];
      return new Date(lastChange.timestamp);
    }

    // Fall back to creation time
    return new Date(entry.createdAt);
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function getSuggestedAction(status: CandidateStatus, daysSince: number): string {
  switch (status) {
    case 'new':
      return `候选人已发现 ${daysSince} 天未触达，建议发送第一条消息`;
    case 'contacted':
      if (daysSince >= 3) return `已触达 ${daysSince} 天未回复，建议换平台或换话术再次触达`;
      return `刚触达 ${daysSince} 天，再等一等`;
    case 'replied':
      return `候选人已回复 ${daysSince} 天未推进，建议推进到下一阶段`;
    case 'screening':
      return `筛选中 ${daysSince} 天，建议安排面试`;
    case 'interviewed':
      return `已面试 ${daysSince} 天，建议给出面试结果`;
    case 'offered':
      return `已发 offer ${daysSince} 天，建议跟进候选人意向`;
    default:
      return '无需跟进';
  }
}

function getFollowUpPriority(status: CandidateStatus, daysSince: number): FollowUpReminder['priority'] {
  // Replied candidates that stall are urgent
  if (status === 'replied' && daysSince >= 1) return 'urgent';
  if (status === 'screening' && daysSince >= 2) return 'urgent';
  if (status === 'contacted' && daysSince >= 5) return 'urgent';

  // Normal follow-ups
  if (status === 'contacted' && daysSince >= 3) return 'normal';
  if (status === 'interviewed' && daysSince >= 3) return 'normal';
  if (status === 'new' && daysSince >= 7) return 'normal';

  return 'low';
}
