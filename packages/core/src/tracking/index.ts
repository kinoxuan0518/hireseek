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

  // ── BOSS Session Sync ──

  /**
   * 从 BOSS 操作会话结果同步候选人状态
   * 将 BossSessionResult 中的触达记录批量写入 tracker
   *
   * @param sessionData - BossAdapter.getSessionResult() 的输出
   * @returns 同步统计
   */
  syncFromBossSession(sessionData: {
    jobId: string;
    contacted: Array<{
      fingerprint: string;    // name|school|company
      timestamp: string;
      matchedRules: string[];
      screening: Record<string, string>;
    }>;
    skipped: Array<{ name: string; reason: string }>;
    totalViewed: number;
    terminationReason: string;
  }): {
    registered: number;
    transitioned: number;
    skipped: number;
    errors: string[];
  } {
    let registered = 0;
    let transitioned = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const record of sessionData.contacted) {
      // Parse fingerprint: name|school|company
      const parts = record.fingerprint.split('|');
      const name = parts[0] || 'unknown';
      const school = parts[1] || '';
      const company = parts[2] || '';
      const candidateId = `boss_${record.fingerprint.replace(/\|/g, '_')}`;

      try {
        let entry = this.cache.get(candidateId);

        if (!entry) {
          // Register new candidate
          entry = this.register(candidateId, name, 'boss');
          entry.notes = `school: ${school}, company: ${company}`;
          registered++;
        }

        // Transition to contacted if needed
        if (entry.status === 'new') {
          this.transition(candidateId, 'contacted', `BOSS session sync — rules: ${record.matchedRules.join(', ')}`);
          transitioned++;
        }

        // Record outreach event
        this.recordOutreach(candidateId, {
          type: 'sent',
          platform: 'boss',
          result: 'sent',
        });
      } catch (err) {
        errors.push(`Failed to sync ${record.fingerprint}: ${(err as Error).message}`);
      }
    }

    // Track skipped candidates (register but don't contact)
    for (const skip of sessionData.skipped) {
      const candidateId = `boss_${skip.name}_${sessionData.jobId}`;
      if (!this.cache.has(candidateId)) {
        this.register(candidateId, skip.name, 'boss');
        registered++;
      }
      skipped++;
    }

    this.dirty = true;
    return { registered, transitioned, skipped, errors };
  }

  // ── Daily Report ──

  /**
   * 生成每日招聘报告
   * 包含漏斗概览、状态分布、近期活动、跟进提醒
   */
  generateDailyReport(): {
    date: string;
    funnel: Record<CandidateStatus, number>;
    conversions: { [key: string]: number };
    recentActivity: Array<{
      candidateName: string;
      action: string;
      timestamp: string;
    }>;
    followUpReminders: FollowUpReminder[];
    summary: string;
  } {
    const funnel = this.getFunnelStats();
    const total = Object.values(funnel).reduce((a, b) => a + b, 0);
    const contacted = funnel.contacted;
    const replied = funnel.replied;
    const conversionRate = contacted > 0 ? ((replied / contacted) * 100).toFixed(1) : '0';

    // Conversions (stage-to-stage rates)
    const conversions: { [key: string]: number } = {};
    const stages: CandidateStatus[] = ['new', 'contacted', 'replied', 'screening', 'interviewed', 'offered', 'joined'];
    for (let i = 0; i < stages.length - 1; i++) {
      const from = funnel[stages[i]];
      const to = funnel[stages[i + 1]];
      const key = `${stages[i]}→${stages[i + 1]}`;
      conversions[key] = from > 0 ? Math.round((to / from) * 100) : 0;
    }

    // Recent activity (last 24h)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentActivity: Array<{ candidateName: string; action: string; timestamp: string }> = [];
    for (const entry of this.cache.values()) {
      for (const event of entry.outreachRecords) {
        if (new Date(event.timestamp).getTime() >= oneDayAgo) {
          recentActivity.push({
            candidateName: entry.candidateName,
            action: `${event.type} (${event.platform})`,
            timestamp: event.timestamp,
          });
        }
      }
    }
    recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const followUpReminders = this.getFollowUpReminders({ maxDaysSinceActivity: 3 });

    const summary = [
      `📋 招聘日报 ${new Date().toISOString().slice(0, 10)}`,
      `漏斗总量: ${total} 人`,
      `今日触达: ${recentActivity.filter(a => a.action.includes('sent')).length} 人`,
      `触达→回复转化: ${conversionRate}%`,
      `待跟进: ${followUpReminders.length} 人`,
    ].join('\n');

    return {
      date: new Date().toISOString().slice(0, 10),
      funnel,
      conversions,
      recentActivity: recentActivity.slice(0, 20), // Cap at 20
      followUpReminders,
      summary,
    };
  }

  // ── Markdown Export ──

  /**
   * 导出漏斗数据为 Markdown（方便发飞书）
   */
  exportToMarkdown(): string {
    const report = this.generateDailyReport();
    const { funnel, conversions, recentActivity, followUpReminders } = report;

    const lines: string[] = [];

    // Header
    lines.push(`# 🦞 HireClaw 招聘日报`);
    lines.push(`> ${report.date}`);
    lines.push('');

    // Funnel overview
    lines.push(`## 漏斗概览`);
    lines.push('');
    lines.push('| 阶段 | 数量 |');
    lines.push('|------|------|');
    for (const [status, count] of Object.entries(funnel)) {
      if (count > 0) {
        const label = STATUS_LABELS[status as CandidateStatus];
        lines.push(`| ${label} ${status} | ${count} |`);
      }
    }
    lines.push('');

    // Conversion rates
    lines.push(`## 阶段转化率`);
    lines.push('');
    lines.push('| 转化 | 率 |');
    lines.push('|------|-----|');
    for (const [key, rate] of Object.entries(conversions)) {
      if (rate > 0) {
        lines.push(`| ${key} | ${rate}% |`);
      }
    }
    lines.push('');

    // Recent activity
    if (recentActivity.length > 0) {
      lines.push(`## 近 24h 活动`);
      lines.push('');
      for (const activity of recentActivity) {
        const time = new Date(activity.timestamp).toLocaleString('zh-CN', { hour12: false });
        lines.push(`- **${activity.candidateName}** — ${activity.action} (${time})`);
      }
      lines.push('');
    }

    // Follow-up reminders
    if (followUpReminders.length > 0) {
      lines.push(`## ⚠️ 待跟进`);
      lines.push('');
      for (const reminder of followUpReminders) {
        const priorityEmoji = reminder.priority === 'urgent' ? '🔴' : reminder.priority === 'normal' ? '🟡' : '🟢';
        lines.push(`- ${priorityEmoji} **${reminder.candidateName}** (${reminder.status}) — ${reminder.daysSinceActivity}天未活动 — ${reminder.suggestedAction}`);
      }
      lines.push('');
    }

    return lines.join('\n');
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
