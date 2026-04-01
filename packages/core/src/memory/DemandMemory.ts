// @hireclaw/core/memory — 招聘需求记忆
//
// 记住招聘需求（职位要求、公司偏好），参考 Claude Code 的 CLAUDE.md 理念
// - 职位详情（技能要求、薪资范围）
// - 公司偏好（哪些公司偏好/回避）
// - 沟通风格
// - 拒绝理由记录（了解市场反馈）

import type { JobConfig, SalaryRange } from '../types.js';
import type { IMemoryStore, MemoryQueryFilter } from './MemoryStore.js';
import type { MemoryEntry } from '../types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface DemandMemoryEntry {
  jobId: string;
  jobTitle: string;
  department?: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  salary?: SalaryRange;
  targetSkills: string[];
  preferredCompanies: string[];
  avoidedCompanies: string[];
  communicationStyle: 'professional' | 'casual' | 'warm';
  brandTone?: string;
  rejectionFeedback: RejectionFeedback[];
  marketInsights: string[];
  stats: DemandStats;
}

export interface RejectionFeedback {
  timestamp: string;
  candidateId: string;
  candidateName: string;
  reason: string;
  salaryExpectation?: string;
  isSalaryReason: boolean;
  isSkillMismatch: boolean;
  isLocationReason: boolean;
  isInterestReason: boolean;
  isOther: boolean;
}

export interface DemandStats {
  contacted: number;
  replied: number;
  screened: number;
  interviewed: number;
  contactToReplyRate: number;
  replyToScreenRate: number;
}

// ────────────────────────────────────────────────────────────
// DemandMemory
// ────────────────────────────────────────────────────────────

export interface DemandMemoryConfig {
  store: IMemoryStore;
}

/**
 * 招聘需求记忆管理器
 *
 * 记住职位要求、公司偏好，学习市场反馈
 */
export class DemandMemory {
  private store: IMemoryStore;

  constructor(config: DemandMemoryConfig) {
    this.store = config.store;
  }

  /**
   * 记住一个招聘需求
   */
  async memorize(job: JobConfig): Promise<DemandMemoryEntry> {
    const now = new Date().toISOString();
    const existing = await this.recallDemand(job.id);

    const entry: DemandMemoryEntry = {
      jobId: job.id,
      jobTitle: job.title,
      department: job.department,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      description: job.description,
      salary: job.salary,
      targetSkills: this.extractSkills(job),
      preferredCompanies: existing?.preferredCompanies ?? [],
      avoidedCompanies: existing?.avoidedCompanies ?? [],
      communicationStyle: existing?.communicationStyle ?? 'professional',
      brandTone: existing?.brandTone,
      rejectionFeedback: existing?.rejectionFeedback ?? [],
      marketInsights: existing?.marketInsights ?? [],
      stats: existing?.stats ?? {
        contacted: 0,
        replied: 0,
        screened: 0,
        interviewed: 0,
        contactToReplyRate: 0,
        replyToScreenRate: 0,
      },
    };

    await this.store.save(this.toMemoryEntry(entry));
    return entry;
  }

  /**
   * 召回招聘需求记忆
   */
  async recallDemand(jobId: string): Promise<DemandMemoryEntry | null> {
    const entries = await this.store.query({
      metadata: { jobId },
      limit: 1,
    });

    if (entries.length === 0) return null;
    return this.fromMemoryEntry(entries[0]);
  }

  /**
   * 召回所有招聘需求
   */
  async listDemands(): Promise<DemandMemoryEntry[]> {
    const allEntries = await this.store.query({ limit: 100 });
    const preferenceEntries = allEntries.filter(e => e.type === 'preference');
    return preferenceEntries.map(e => this.fromMemoryEntry(e));
  }

  /**
   * 添加拒绝反馈
   */
  async addRejectionReason(
    candidateId: string,
    candidateName: string,
    jobId: string,
    reason: string
  ): Promise<void> {
    const entry = await this.recallDemand(jobId);
    if (!entry) return;

    const feedback: RejectionFeedback = {
      timestamp: new Date().toISOString(),
      candidateId,
      candidateName,
      reason,
      isSalaryReason: this.isSalaryReason(reason),
      isSkillMismatch: this.isSkillMismatch(reason),
      isLocationReason: /地点|城市|location|远程|通勤/.test(reason),
      isInterestReason: /不感兴趣|考虑|再看看|已读不回|无回复/.test(reason),
      isOther: !this.isSalaryReason(reason) && !this.isSkillMismatch(reason) &&
               !/地点|城市|location|远程|通勤/.test(reason) &&
               !/不感兴趣|考虑|再看看|已读不回|无回复/.test(reason),
    };

    entry.rejectionFeedback.push(feedback);
    entry.updatedAt = new Date().toISOString();
    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 添加公司偏好
   */
  async addCompanyPreference(
    jobId: string,
    company: string,
    preference: 'prefer' | 'avoid'
  ): Promise<void> {
    const entry = await this.recallDemand(jobId);
    if (!entry) return;

    if (preference === 'prefer') {
      if (!entry.preferredCompanies.includes(company)) {
        entry.preferredCompanies.push(company);
      }
    } else {
      if (!entry.avoidedCompanies.includes(company)) {
        entry.avoidedCompanies.push(company);
      }
      entry.preferredCompanies = entry.preferredCompanies.filter(c => c !== company);
    }

    entry.updatedAt = new Date().toISOString();
    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 更新触达统计
   */
  async updateStats(jobId: string, event: 'contact' | 'reply' | 'screen' | 'interview'): Promise<void> {
    const entry = await this.recallDemand(jobId);
    if (!entry) return;

    switch (event) {
      case 'contact': entry.stats.contacted += 1; break;
      case 'reply': entry.stats.replied += 1; break;
      case 'screen': entry.stats.screened += 1; break;
      case 'interview': entry.stats.interviewed += 1; break;
    }

    if (entry.stats.contacted > 0) {
      entry.stats.contactToReplyRate = entry.stats.replied / entry.stats.contacted;
    }
    if (entry.stats.replied > 0) {
      entry.stats.replyToScreenRate = entry.stats.screened / entry.stats.replied;
    }

    entry.updatedAt = new Date().toISOString();
    await this.store.save(this.toMemoryEntry(entry));
  }

  /**
   * 获取市场洞察
   */
  async getMarketInsights(jobId: string): Promise<string[]> {
    const entry = await this.recallDemand(jobId);
    if (!entry || entry.rejectionFeedback.length === 0) return [];

    const insights: string[] = [];
    const feedback = entry.rejectionFeedback;

    const salaryIssues = feedback.filter(f => f.isSalaryReason);
    if (salaryIssues.length > 0) {
      const rates = salaryIssues
        .filter(f => f.salaryExpectation)
        .map(f => this.parseSalary(f.salaryExpectation!))
        .filter(s => s > 0);

      if (rates.length > 0) {
        const avg = (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(0);
        insights.push(`市场薪资预期约 ${avg}k，职位范围可能需要调整`);
      } else {
        insights.push(`薪资预期不匹配是主要拒绝原因 (${salaryIssues.length}次)`);
      }
    }

    const skillIssues = feedback.filter(f => f.isSkillMismatch);
    if (skillIssues.length > 0) {
      insights.push(`技能不匹配是主要问题 (${skillIssues.length}次)，考虑调整职位描述`);
    }

    const interestIssues = feedback.filter(f => f.isInterestReason);
    if (interestIssues.length > 0) {
      insights.push(`候选人对职位不感兴趣 (${interestIssues.length}次)，可能需要优化 JD 或触达话术`);
    }

    if (entry.stats.contacted > 0) {
      const replyRate = ((entry.stats.replied / entry.stats.contacted) * 100).toFixed(1);
      insights.push(`触达回复率: ${replyRate}%，行业平均 15-30%`);
      if (parseFloat(replyRate) < 10) {
        insights.push(`⚠️ 回复率偏低，建议优化触达话术或候选人筛选条件`);
      }
    }

    return insights;
  }

  /**
   * 获取公司偏好
   */
  async getCompanyPreferences(jobId: string): Promise<{ preferred: string[]; avoided: string[] }> {
    const entry = await this.recallDemand(jobId);
    if (!entry) return { preferred: [], avoided: [] };
    return { preferred: entry.preferredCompanies, avoided: entry.avoidedCompanies };
  }

  /**
   * 删除招聘需求记忆
   */
  async forget(jobId: string): Promise<void> {
    await this.store.deleteWhere({ metadata: { jobId } });
  }

  // ── Private Helpers ──

  private extractSkills(job: JobConfig): string[] {
    if (!job.description) return [];
    const text = (job.description ?? '') + ' ' + (job.title ?? '');
    const skills = text.match(
      /(?:python|java|typescript|javascript|golang|go|rust|c\+\+|react|vue|angular|node\.js|pytorch|tensorflow|kubernetes|docker|kafka|redis|postgres|mysql|mongodb|elasticsearch|nginx|git|linux|aws|azure|gcp|ml|ai|llm|nlp|cv|devops|agile|scrum|ci\/cd|api|rest|graphql|microservice|distributed|algorithm|data structure)/gi
    );
    return skills ? [...new Set(skills.map(s => s.toLowerCase()))] : [];
  }

  private isSalaryReason(reason: string): boolean {
    return /薪资|salary|薪酬|待遇|期望|工资|包|compensation|income|低于|高|低|涨|降/.test(reason);
  }

  private isSkillMismatch(reason: string): boolean {
    return /技能|技术|经验|经历|背景|不符合|不匹配|缺少|不足|skill|experience|technical/.test(reason);
  }

  private parseSalary(s: string): number {
    const match = s.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private toMemoryEntry(entry: DemandMemoryEntry): MemoryEntry {
    return {
      id: `demand_${entry.jobId}`,
      type: 'preference',
      content: JSON.stringify(entry),
      metadata: {
        jobId: entry.jobId,
        jobTitle: entry.jobTitle,
        department: entry.department ?? '',
        preferredCompanies: entry.preferredCompanies,
        avoidedCompanies: entry.avoidedCompanies,
        communicationStyle: entry.communicationStyle,
        contacted: entry.stats.contacted,
        replied: entry.stats.replied,
      },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private fromMemoryEntry(entry: MemoryEntry): DemandMemoryEntry {
    return JSON.parse(entry.content);
  }
}
