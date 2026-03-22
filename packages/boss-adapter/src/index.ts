// @hireclaw/boss-adapter — BOSS直聘平台适配器
//
// 实现 PlatformAdapter 接口，核心逻辑：
// 1. 候选人搜索与筛选（硬性筛选 + 评分排序）
// 2. 防封控（频率控制、上限检测、退避策略）
// 3. 打招呼（幂等保护、留痕）
// 4. 消息处理（状态机、简历请求、评估判定）
//
// 浏览器自动化部分标记为 TODO，由 Playwright 实现

import type {
  PlatformAdapter,
  CandidateFetchRequest,
  CandidateFetchResult,
  ReachOutRequest,
  ReachOutResult,
  ConversationStatus,
  PlatformStatus,
  Candidate,
  CandidateProfile,
  Education,
  Experience,
  EvaluationResult,
  EvaluationDimension,
  JobConfig,
} from '@hireclaw/core';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface BossAdapterConfig {
  /** 是否无头模式 */
  headless?: boolean;
  /** Chromium 可执行路径 */
  executablePath?: string;
  /** 登录状态文件路径 */
  accountStatePath?: string;
  /** 浏览器用户数据目录 */
  userDataDir?: string;
}

/** 候选人原始数据（从 BOSS 页面解析） */
export interface BossCandidateRaw {
  /** 平台内 ID */
  id: string;
  /** 姓名 */
  name: string;
  /** 学校 */
  school?: string;
  /** 学历 */
  degree?: string;
  /** 当前/最近公司 */
  company?: string;
  /** 当前/最近职位 */
  title?: string;
  /** 工作年限 */
  experienceYears?: number;
  /** 是否 985/211/海外名校 */
  isTopSchool?: boolean;
  /** 是否大厂/明星公司 */
  isTopCompany?: boolean;
  /** 技能标签 */
  skills?: string[];
  /** 在线状态 */
  onlineStatus?: 'online' | 'recently' | 'today' | 'this_week' | 'inactive';
  /** 求职状态 */
  jobIntention?: 'active' | 'considering' | 'soon' | 'not_interested';
  /** 期望城市 */
  expectedCity?: string;
  /** 按钮：打招呼 or 继续沟通 */
  buttonState?: 'greet' | 'continue';
  /** 专业 */
  major?: string;
}

/** 筛选配置 */
export interface BossFilterConfig {
  /** 是否要求 AI 技能 */
  aiSkillRequired?: boolean;
  /** AI 技能关键词 */
  aiSkillKeywords?: string[];
  /** 学历要求 */
  degreeRequired?: string[];
  /** 是否要求 985/211/QS100 */
  schoolTiers?: string[];
  /** 经验范围 [min, max] */
  experienceRange?: [number, number];
  /** 是否允许应届例外 */
  campusExceptionEnabled?: boolean;
  /** 目标公司列表 */
  targetCompanies?: string[];
  /** 相关专业 */
  relevantMajors?: string[];
  /** 期望城市 */
  expectedCity?: string;
  /** 评分通过阈值 */
  scoreThreshold?: number;
}

/** 打招呼留痕记录 */
export interface GreetingRecord {
  /** 候选人指纹：name|school|company */
  fingerprint: string;
  /** 时间 */
  timestamp: string;
  /** 命中规则标签 */
  matchedRules: string[];
  /** 筛选详情 */
  screening: {
    school: 'pass' | 'fail' | 'skip';
    skill: 'pass' | 'fail' | 'skip';
    company: 'pass' | 'fail' | 'skip';
    experience: 'pass' | 'fail' | 'skip';
  };
}

/** BOSS 操作会话结果（用于 syncFromBossSession） */
export interface BossSessionResult {
  /** 会话 ID */
  sessionId: string;
  /** 处理的职位 */
  jobId: string;
  /** 开始时间 */
  startedAt: string;
  /** 结束时间 */
  finishedAt: string;
  /** 触达的候选人 */
  contacted: GreetingRecord[];
  /** 跳过的候选人 */
  skipped: {
    name: string;
    reason: string;
  }[];
  /** 总浏览数 */
  totalViewed: number;
  /** 终止原因 */
  terminationReason: 'quota_exhausted' | 'no_more_candidates' | 'user_stop' | 'completed';
  /** 风控事件 */
  rateLimitEvents: number;
  /** 解析质量告警 */
  parseQualityWarning?: boolean;
}

// ────────────────────────────────────────────────────────────
// Rate Limiter
// ────────────────────────────────────────────────────────────

export class BossRateLimiter {
  private consecutiveHits = 0;
  private lastActionTime = 0;
  private backoffUntil = 0;

  /** 当前退避等待时间（毫秒） */
  private baseDelay = 1500; // 1.5s 基础间隔
  private maxBackoff = 30000; // 30s 最大退避

  /** 记录一次操作 */
  async waitAndRecord(): Promise<void> {
    const now = Date.now();

    // 如果在退避期，等待
    if (now < this.backoffUntil) {
      await this.sleep(this.backoffUntil - now);
    }

    // 基础间隔
    const jitter = Math.random() * 1000; // 0-1s 随机抖动
    await this.sleep(this.baseDelay + jitter);

    this.lastActionTime = Date.now();
  }

  /** 收到频率告警，触发软退避 */
  async handleRateLimit(): Promise<{ waitedMs: number }> {
    this.consecutiveHits++;
    const backoffMs = Math.min(
      10000 + this.consecutiveHits * 5000 + Math.random() * 5000,
      this.maxBackoff
    );
    this.backoffUntil = Date.now() + backoffMs;
    await this.sleep(backoffMs);
    return { waitedMs: backoffMs };
  }

  /** 频率告警解除，重置退避 */
  resetBackoff(): void {
    this.consecutiveHits = 0;
    this.backoffUntil = 0;
  }

  /** 获取退避统计 */
  getStats() {
    return {
      consecutiveHits: this.consecutiveHits,
      backoffUntil: this.backoffUntil ? new Date(this.backoffUntil).toISOString() : null,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve as () => void, ms));
  }
}

// ────────────────────────────────────────────────────────────
// Candidate Filter & Scorer
// ────────────────────────────────────────────────────────────

export class BossCandidateFilter {
  private config: Required<BossFilterConfig>;
  /** 当日已触达指纹集合（幂等保护） */
  private contactedFingerprints = new Set<string>();

  constructor(config: BossFilterConfig = {}) {
    this.config = {
      aiSkillRequired: true,
      aiSkillKeywords: [],
      degreeRequired: ['本科', '硕士', '博士'],
      schoolTiers: ['985', 'QS100'],
      experienceRange: [1, 5],
      campusExceptionEnabled: true,
      targetCompanies: [],
      relevantMajors: [],
      expectedCity: '',
      scoreThreshold: 60,
      ...config,
    } as Required<BossFilterConfig>;
  }

  /**
   * 硬性筛选：按优先级依次淘汰
   * @returns 'pass' 表示通过，string 表示拒绝原因
   */
  screen(raw: BossCandidateRaw): { pass: boolean; reason?: string; screening: GreetingRecord['screening'] } {
    // 1. 已联系检查
    if (raw.buttonState === 'continue') {
      return { pass: false, reason: 'already_contacted', screening: { school: 'skip', skill: 'skip', company: 'skip', experience: 'skip' } };
    }

    const screening: GreetingRecord['screening'] = {
      school: 'skip',
      skill: 'skip',
      company: 'skip',
      experience: 'skip',
    };

    // 2. 技能要求
    if (this.config.aiSkillRequired && this.config.aiSkillKeywords.length > 0) {
      const skillMatch = this.checkSkills(raw);
      screening.skill = skillMatch ? 'pass' : 'fail';
      if (!skillMatch) return { pass: false, reason: 'skill_mismatch', screening };
    }

    // 3. 学校/学历
    const schoolResult = this.checkSchool(raw);
    screening.school = schoolResult ? 'pass' : 'fail';
    if (!schoolResult) return { pass: false, reason: 'school_mismatch', screening };

    // 4. 经验
    const expResult = this.checkExperience(raw);
    screening.experience = expResult ? 'pass' : 'fail';
    if (!expResult) return { pass: false, reason: 'experience_mismatch', screening };

    // 5. 地点
    if (this.config.expectedCity && raw.expectedCity) {
      if (!raw.expectedCity.includes(this.config.expectedCity)) {
        return { pass: false, reason: 'location_mismatch', screening };
      }
    }

    // 6. 公司背景
    if (this.config.targetCompanies.length > 0) {
      screening.company = this.checkCompany(raw) ? 'pass' : 'fail';
    }

    return { pass: true, screening };
  }

  /**
   * 评分排序（总分 100）
   * - 学校层级 25 分
   * - 公司匹配 30 分
   * - 活跃度 25 分
   * - 求职意愿 20 分
   */
  score(raw: BossCandidateRaw): number {
    let total = 0;

    // 学校层级 (25)
    if (raw.isTopSchool) total += 25;
    else if (raw.degree === '硕士') total += 18;
    else if (raw.degree === '本科') total += 15;
    else total += 5;

    // 公司匹配 (30)
    if (raw.isTopCompany) total += 30;
    else if (this.config.targetCompanies.some(c => raw.company?.includes(c))) total += 22;
    else total += 10;

    // 活跃度 (25)
    const activityScore: Record<string, number> = {
      online: 25,
      recently: 21,
      today: 17,
      this_week: 12,
      inactive: 7,
    };
    total += activityScore[raw.onlineStatus ?? 'inactive'] ?? 7;

    // 求职意愿 (20)
    const intentionScore: Record<string, number> = {
      active: 20,
      considering: 16,
      soon: 12,
      not_interested: 6,
    };
    total += intentionScore[raw.jobIntention ?? 'not_interested'] ?? 6;

    return total;
  }

  /**
   * 批量筛选 + 评分，返回排序后的通过列表
   */
  filterAndRank(candidates: BossCandidateRaw[]): {
    passed: Array<{ raw: BossCandidateRaw; score: number }>;
    rejected: Array<{ raw: BossCandidateRaw; reason: string }>;
  } {
    const passed: Array<{ raw: BossCandidateRaw; score: number }> = [];
    const rejected: Array<{ raw: BossCandidateRaw; reason: string }> = [];

    for (const raw of candidates) {
      const { pass, reason } = this.screen(raw);
      if (pass) {
        const score = this.score(raw);
        if (score >= (this.config.scoreThreshold ?? 60)) {
          passed.push({ raw, score });
        } else {
          rejected.push({ raw, reason: `score_below_threshold(${score})` });
        }
      } else {
        rejected.push({ raw, reason: reason! });
      }
    }

    // 按分数降序排列
    passed.sort((a, b) => b.score - a.score);

    return { passed, rejected };
  }

  /** 生成候选人指纹（幂等 key） */
  static fingerprint(raw: BossCandidateRaw): string {
    return `${raw.name}|${raw.school ?? ''}|${raw.company ?? ''}`;
  }

  /** 检查是否已触达 */
  isContacted(raw: BossCandidateRaw): boolean {
    return this.contactedFingerprints.has(BossCandidateFilter.fingerprint(raw));
  }

  /** 标记已触达 */
  markContacted(raw: BossCandidateRaw): void {
    this.contactedFingerprints.add(BossCandidateFilter.fingerprint(raw));
  }

  /** 获取当日触达数 */
  get contactCount(): number {
    return this.contactedFingerprints.size;
  }

  // ── Private checks ──

  private checkSkills(raw: BossCandidateRaw): boolean {
    if (!this.config.aiSkillKeywords || this.config.aiSkillKeywords.length === 0) return true;
    const candidateText = [raw.skills?.join(' '), raw.title, raw.major].filter(Boolean).join(' ').toLowerCase();
    return this.config.aiSkillKeywords.some(kw => candidateText.includes(kw.toLowerCase()));
  }

  private checkSchool(raw: BossCandidateRaw): boolean {
    // 应届例外：如果启用了 campus exception，且学校好+技能匹配，可以放行
    if (raw.experienceYears === 0 && this.config.campusExceptionEnabled) {
      if (raw.isTopSchool) return true;
    }
    return raw.isTopSchool ?? false;
  }

  private checkExperience(raw: BossCandidateRaw): boolean {
    const [min, max] = this.config.experienceRange ?? [0, 99];
    const years = raw.experienceYears ?? 0;
    if (years === 0 && this.config.campusExceptionEnabled) return true;
    return years >= min && years <= max;
  }

  private checkCompany(raw: BossCandidateRaw): boolean {
    if (this.config.targetCompanies.length === 0) return true;
    return this.config.targetCompanies.some(c => raw.company?.includes(c));
  }

  /** Check if a fingerprint string has been contacted (for non-BossCandidateRaw usage) */
  isContactedByFingerprint(fingerprint: string): boolean {
    return this.contactedFingerprints.has(fingerprint);
  }

  /** Mark a fingerprint as contacted (for non-BossCandidateRaw usage) */
  markContactedByFingerprint(fingerprint: string): void {
    this.contactedFingerprints.add(fingerprint);
  }
}

// ────────────────────────────────────────────────────────────
// Message Handler (状态机)
// ────────────────────────────────────────────────────────────

export type MessageAction = 'request_resume' | 'provide_info' | 'schedule_interview' | 'reject' | 'pass_to_human';

export interface MessageAnalysis {
  /** 分析出的动作 */
  action: MessageAction;
  /** 候选人意向 */
  intention: 'interested' | 'neutral' | 'not_interested';
  /** 是否需要索要简历 */
  needsResume: boolean;
  /** 回复建议 */
  suggestedReply?: string;
  /** 置信度 0-1 */
  confidence: number;
}

/**
 * 分析候选人消息，决定下一步动作
 * 这是一个规则引擎，简单场景可以直接判定，复杂场景标记为 pass_to_human
 */
export function analyzeCandidateMessage(
  message: string,
  currentStatus: ConversationStatus
): MessageAnalysis {
  const lower = message.toLowerCase();

  // 已入职/已拒绝 — 不处理
  if (['joined', 'rejected', 'dropped'].includes(currentStatus)) {
    return { action: 'pass_to_human', intention: 'neutral', needsResume: false, confidence: 1 };
  }

  // 检测拒绝信号
  const rejectionPatterns = ['不考虑', '不感兴趣', '暂时不考虑', '已有offer', '已接其他', '不考虑机会', '不找了'];
  if (rejectionPatterns.some(p => lower.includes(p))) {
    return { action: 'reject', intention: 'not_interested', needsResume: false, confidence: 0.9 };
  }

  // 检测已发简历
  const resumeSentPatterns = ['简历', '附件', '这是我的', 'cv', 'resume', 'pdf', 'word'];
  const hasResume = resumeSentPatterns.some(p => lower.includes(p));

  // 检测积极信号
  const interestPatterns = ['感兴趣', '了解', '聊聊', '方便', '可以', '好的', '什么时候', '具体做什么', '薪资', '待遇'];
  const isInterested = interestPatterns.some(p => lower.includes(p));

  // 检测中性/询问信号
  const neutralPatterns = ['什么', '哪里', '怎么样', '多少', '远程', '加班', '技术栈'];
  const isAsking = neutralPatterns.some(p => lower.includes(p));

  if (currentStatus === 'contacted' || currentStatus === 'uncontacted') {
    if (hasResume) {
      return {
        action: 'provide_info',
        intention: 'interested',
        needsResume: false, // 已经发了
        suggestedReply: '收到简历，我看完后尽快给您反馈。',
        confidence: 0.85,
      };
    }
    if (isInterested) {
      return {
        action: 'request_resume',
        intention: 'interested',
        needsResume: true,
        suggestedReply: '方便发一份最新简历吗？我看完后给您详细介绍一下岗位。',
        confidence: 0.8,
      };
    }
    if (isAsking) {
      return {
        action: 'provide_info',
        intention: 'neutral',
        needsResume: false,
        confidence: 0.7,
      };
    }
  }

  if (currentStatus === 'replied') {
    if (hasResume) {
      return {
        action: 'schedule_interview',
        intention: 'interested',
        needsResume: false,
        confidence: 0.8,
      };
    }
    if (isInterested) {
      return {
        action: 'request_resume',
        intention: 'interested',
        needsResume: true,
        confidence: 0.8,
      };
    }
  }

  // 无法判断 — 交给人工
  return {
    action: 'pass_to_human',
    intention: 'neutral',
    needsResume: false,
    confidence: 0.5,
  };
}

// ────────────────────────────────────────────────────────────
// BossAdapter (PlatformAdapter 实现)
// ────────────────────────────────────────────────────────────

export class BossAdapter implements PlatformAdapter {
  readonly name = 'boss';

  private config: Required<BossAdapterConfig>;
  private initialized = false;
  private rateLimiter = new BossRateLimiter();
  private filter: BossCandidateFilter;
  private sessionRecords: GreetingRecord[] = [];
  private sessionSkipped: Array<{ name: string; reason: string }> = [];
  private sessionContactedCount = 0;
  private quotaExhausted = false;
  private browserSession: import('./browser.js').BrowserSession | null = null;

  constructor(config: BossAdapterConfig = {}, filterConfig?: BossFilterConfig) {
    this.config = {
      headless: config.headless ?? false,
      executablePath: config.executablePath ?? '',
      accountStatePath: config.accountStatePath ?? '',
      userDataDir: config.userDataDir ?? '',
    };
    this.filter = new BossCandidateFilter(filterConfig);
  }

  async init(): Promise<void> {
    const { BrowserSession } = await import('./browser.js');
    this.browserSession = new BrowserSession(
      {
        headless: this.config.headless,
        executablePath: this.config.executablePath,
        userDataDir: this.config.userDataDir,
      },
      (msg) => console.log(msg)
    );
    await this.browserSession.init();
    this.initialized = true;
  }

  async destroy(): Promise<void> {
    if (this.browserSession) {
      await this.browserSession.destroy();
      this.browserSession = null;
    }
    this.initialized = false;
  }

  async getCandidates(request: CandidateFetchRequest): Promise<CandidateFetchResult> {
    this.ensureInitialized();
    if (!this.browserSession) throw new Error('Browser session not available');

    const { rawToCandidate } = await import('./browser.js');
    const page = this.browserSession.getPage();

    // 1. 导航到推荐牛人页
    await page.goto('https://www.zhipin.com/web/employer/talent/recommend', { waitUntil: 'domcontentloaded' });
    await this.sleep(2000, 4000);

    // 2. 应用页面筛选条件
    const filters = request.job.filters ?? {};
    await this.browserSession.applyFilters({
      keywords: filters.keywords as string[] | undefined,
      degree: filters.degree as string[] | undefined,
      experience: filters.experience as string[] | undefined,
      schoolTags: filters.schoolTags as string[] | undefined,
    });

    // 3. 切换到推荐 tab（默认）
    await this.browserSession.switchTab('推荐');

    // 4. 滚动收集 + 实时过滤
    const allPassed: Candidate[] = [];
    const limit = request.limit ?? 50;
    const signal = { stop: false };

    const result = await this.browserSession.scrollAndCollectCandidates({
      rateLimiter: this.rateLimiter,
      signal,
      onBatch: (raws) => {
        // 实时过滤和评分
        const { passed, rejected } = this.filter.filterAndRank(raws);
        for (const { raw } of rejected) {
          this.sessionSkipped.push({ name: raw.name, reason: 'filtered_out' });
        }
        for (const { raw, score } of passed) {
          const candidate = rawToCandidate(raw);
          candidate.evaluation = {
            score,
            passed: true,
            threshold: this.filter['config'].scoreThreshold ?? 60,
            dimensions: [],
            vetoed: [],
            bonuses: [],
            priority: score >= 90 ? 'critical' : score >= 80 ? 'high' : score >= 70 ? 'medium' : 'low',
          };
          allPassed.push(candidate);
        }
        // 如果收集够了，发停止信号
        if (allPassed.length >= limit) {
          signal.stop = true;
        }
      },
    });

    // 处理终止原因
    if (result.terminatedBy === 'quota_exhausted') {
      this.quotaExhausted = true;
    }

    const candidates = allPassed.slice(0, limit);
    return {
      candidates,
      hasMore: result.terminatedBy === 'scroll_stable' && allPassed.length > limit,
      platformStatus: {
        platform: 'boss',
        loggedIn: true,
        rateLimited: result.terminatedBy === 'quota_exhausted',
        accountStatus: 'active',
      },
    };
  }

  async reachOut(request: ReachOutRequest): Promise<ReachOutResult> {
    this.ensureInitialized();

    // 防封控检查
    if (this.quotaExhausted) {
      return {
        success: false,
        error: 'DAILY_QUOTA_EXHAUSTED',
        rateLimited: true,
        remainingQuota: 0,
      };
    }

    // 幂等检查
    const fingerprint = this.getFingerprint(request);
    if (this.filter.isContactedByFingerprint(fingerprint)) {
      return {
        success: false,
        error: 'ALREADY_CONTACTED_TODAY',
      };
    }

    if (!this.browserSession) throw new Error('Browser session not available');

    // 生成消息
    const { generateDefaultMessage } = await import('./browser.js');
    const message = request.message || generateDefaultMessage(
      request.candidate.profile.experience[0]?.title ?? '我们的岗位'
    );

    // 频率控制
    await this.rateLimiter.waitAndRecord();

    // 发送打招呼
    const result = await this.browserSession.reachOut(request.candidate, message);

    if (result.alreadyContacted) {
      return { success: false, error: 'ALREADY_CONTACTED_TODAY' };
    }

    if (result.rateLimited) {
      if (result.error === 'DAILY_QUOTA_EXHAUSTED') {
        this.quotaExhausted = true;
        return {
          success: false,
          error: 'DAILY_QUOTA_EXHAUSTED',
          rateLimited: true,
          remainingQuota: 0,
        };
      }
      // 软退避
      await this.rateLimiter.handleRateLimit();
      return {
        success: false,
        error: 'RATE_LIMITED',
        rateLimited: true,
      };
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // 记录留痕
    this.filter.markContactedByFingerprint(fingerprint);
    this.sessionContactedCount++;

    this.sessionRecords.push({
      fingerprint,
      timestamp: new Date().toISOString(),
      matchedRules: [],
      screening: { school: 'skip', skill: 'skip', company: 'skip', experience: 'skip' },
    });

    return { success: true };
  }

  async getConversationStatus(candidateId: string): Promise<ConversationStatus> {
    this.ensureInitialized();
    if (!this.browserSession) throw new Error('Browser session not available');

    // 我们需要用 candidateId 查找对应的 Candidate 对象
    // candidateId 在我们的系统里就是 BossCandidateRaw.id
    // 这里构造一个最小 Candidate 对象用于定位
    const dummyCandidate: import('@hireclaw/core').Candidate = {
      id: candidateId,
      name: '', // 将在 findCandidateCard 中通过其他方式查找
      platform: 'boss',
      profile: { education: [], experience: [], skills: [], ext: {} },
      source: { rawData: { id: candidateId } },
    };

    const result = await this.browserSession.getConversationStatus(dummyCandidate);
    return result.status;
  }

  async getStatus(): Promise<PlatformStatus> {
    return {
      platform: 'boss',
      loggedIn: this.initialized,
      remainingQuota: this.quotaExhausted ? 0 : undefined,
      rateLimited: false,
      accountStatus: 'active',
    };
  }

  // ── Session management ──

  /**
   * 标记每日上限已触发（从浏览器检测到弹窗时调用）
   */
  markQuotaExhausted(): void {
    this.quotaExhausted = true;
  }

  /**
   * 处理频率告警
   */
  async handleRateLimit(): Promise<{ waitedMs: number }> {
    return this.rateLimiter.handleRateLimit();
  }

  /**
   * 获取当前会话结果（用于 syncFromBossSession）
   */
  getSessionResult(jobId: string, terminationReason: BossSessionResult['terminationReason']): BossSessionResult {
    return {
      sessionId: `boss_${Date.now()}`,
      jobId,
      startedAt: new Date(Date.now() - 3600000).toISOString(), // approx
      finishedAt: new Date().toISOString(),
      contacted: this.sessionRecords,
      skipped: this.sessionSkipped,
      totalViewed: this.sessionRecords.length + this.sessionSkipped.length,
      terminationReason,
      rateLimitEvents: this.rateLimiter.getStats().consecutiveHits,
    };
  }

  /** Reset session state */
  resetSession(): void {
    this.sessionRecords = [];
    this.sessionSkipped = [];
    this.sessionContactedCount = 0;
    this.quotaExhausted = false;
    this.rateLimiter.resetBackoff();
  }

  // ── Helpers ──

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('BossAdapter not initialized. Call await adapter.init() first.');
    }
  }

  private getFingerprint(request: ReachOutRequest): string {
    const { candidate } = request;
    return `${candidate.name}|${candidate.profile.education[0]?.school ?? ''}|${candidate.profile.experience[0]?.company ?? ''}`;
  }

  private sleep(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise<void>(resolve => setTimeout(resolve as () => void, ms));
  }
}

// ── Export helpers ──

export { type ConversationStatus, type EvaluationResult, type EvaluationDimension, type Candidate, type CandidateProfile, type Education, type Experience, type JobConfig };

// ── Re-export browser module ──

export { BrowserSession, rawToCandidate, generateDefaultMessage } from './browser.js';
export type { BrowserConfig } from './browser.js';
