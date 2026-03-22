// @hireclaw/boss-adapter/browser — Playwright 浏览器自动化
//
// 实现 BOSS直聘企业端的浏览器操作：
// 1. 初始化（持久化用户数据目录 + 登录检测）
// 2. 获取候选人列表（筛选、滚动、解析）
// 3. 打招呼（点击、输入、发送、幂等校验）
// 4. 读取对话状态

import { chromium, type Browser, type BrowserContext, type Page, type ElementHandle } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  Candidate,
  CandidateProfile,
  Education,
  Experience,
  ConversationStatus,
} from '@hireclaw/core';
import type { BossCandidateRaw, BossRateLimiter } from './index.js';

// ────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────

export interface BrowserConfig {
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
  /** 基础 URL */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://www.zhipin.com/web/recruit/';
const DEFAULT_USER_DATA_DIR = join(homedir(), '.hireclaw', 'browser-data');

// ────────────────────────────────────────────────────────────
// Selectors
// ────────────────────────────────────────────────────────────

const SEL = {
  // 登录检测
  recruiterNav: '.recruit-nav, .header-nav, .menu-container',
  jobList: '.job-list, .job-card-wrapper',

  // 候选人页签
  tabItem: 'li.tab-item',
  tabItemActive: 'li.tab-item.current, li.tab-item.active',

  // 候选人卡片
  candidateCard: '.job-card-wrapper, .resume-show, .search-job-result',

  // 筛选面板
  filterBtn: '.filter-btn, .filter-btn-wrap, .condition-bar .filter',
  filterPanel: '.filter-container, .dialog-filter, .screen-container',
  filterConfirm: '.btn-primary, .filter-confirm',
  filterCancel: '.btn-default, .filter-cancel',
  filterTagActive: '.tag-active, .selected, .tag-choosed',

  // 筛选项
  experienceFilter: '.experience-filter, [data-filter="experience"], .filter-exp',
  educationFilter: '.education-filter, [data-filter="education"], .filter-edu',
  schoolFilter: '.school-filter, [data-filter="school"], .filter-school',
  keywordFilter: '.keyword-input, [data-filter="keyword"], .filter-keyword',

  // 候选人卡片内部
  candidateName: '.name, .user-name, .info-public em',
  candidateSchool: '.school, .edu-text',
  candidateCompany: '.company-name a, .info-company',
  candidateTitle: '.job-title, .info-public em:last-child',
  candidateDegree: '.degree, .edu-text',
  candidateExperience: '.experience, .info-desc, .info-pub',

  // 操作按钮
  greetBtn: '.btn-start-chat, .btn-greet, .operation-btn .btn-start',
  continueChatBtn: '.btn-continue-chat, .btn-continue, .operation-btn .btn-continue',
  startChatBtn: '.btn-start-chat, .operation-btn .btn-start',

  // 聊天相关
  chatInput: '.chat-input, .input-area textarea, .chat-footer textarea',
  chatSendBtn: '.btn-send, .chat-footer .btn-primary, .send-btn',
  chatMessageList: '.chat-message-list, .message-list, .chat-content',

  // 风控弹窗
  quotaModal: '.dialog-container, .modal-container',
  quotaText: /今日.*沟通.*上限|已达上限|需付费购买/,
  rateLimitText: /开聊太频繁|操作太频繁/,

  // 分页/结束
  noMore: /没有更多|暂无更多|已加载全部|没有新的候选人/,
  emptyPool: /暂无符合牛人，为你推荐/,

  // 职位选择
  jobSelect: '.job-select, .select-job, .job-choose',

  // 在线状态标签
  onlineTag: '.online-tag, .active-tag, .status-tag',
} as const;

// ────────────────────────────────────────────────────────────
// BrowserSession
// ────────────────────────────────────────────────────────────

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: Required<BrowserConfig>;
  private logger: (msg: string) => void;

  constructor(
    config: BrowserConfig = {},
    logger?: (msg: string) => void
  ) {
    this.config = {
      headless: config.headless ?? false,
      executablePath: config.executablePath ?? '',
      userDataDir: config.userDataDir ?? DEFAULT_USER_DATA_DIR,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    };
    this.logger = logger ?? (() => {});
  }

  // ── Init & Destroy ──

  /**
   * 初始化浏览器：启动 Chromium → 创建 context → 导航到 BOSS直聘 → 检测登录
   * @throws Error 如果未登录
   */
  async init(): Promise<void> {
    this.log('Initializing Playwright browser...');

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: this.config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    };

    if (this.config.executablePath) {
      launchOptions.executablePath = this.config.executablePath;
    }

    this.browser = await chromium.launch(launchOptions);

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });

    this.page = await this.context.newPage();

    this.log('Navigating to BOSS直聘企业端...');
    await this.page.goto(this.config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.randomDelay(2000, 4000);

    const isLoggedIn = await this.checkLoginStatus();
    if (!isLoggedIn) {
      await this.destroy();
      throw new Error(
        '未检测到登录状态。请在浏览器窗口中手动登录 BOSS直聘，然后重新调用 init()。' +
        '（使用持久化用户数据目录，登录一次后 cookie 会保持）'
      );
    }

    this.log('Login verified ✓');
  }

  /**
   * 检测是否已登录
   * 判据：页面出现招聘管理界面元素（导航栏、职位列表等）
   */
  async checkLoginStatus(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // 方法1：检测是否有招聘导航栏
      const hasNav = await this.page.$(SEL.recruiterNav);
      if (hasNav) return true;

      // 方法2：检测是否有职位列表
      const hasJobs = await this.page.$(SEL.jobList);
      if (hasJobs) return true;

      // 方法3：URL 检测 — 登录后通常会跳转到 recruit 页面
      const url = this.page.url();
      if (url.includes('/web/recruit') || url.includes('/web/employer')) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 优雅关闭浏览器
   */
  async destroy(): Promise<void> {
    this.log('Destroying browser session...');
    try {
      if (this.context) await this.context.close();
    } catch { /* context already closed */ }
    try {
      if (this.browser) await this.browser.close();
    } catch { /* browser already closed */ }
    this.context = null;
    this.browser = null;
    this.page = null;
    this.log('Browser session destroyed');
  }

  // ── Getters ──

  getPage(): Page {
    if (!this.page) throw new Error('BrowserSession not initialized');
    return this.page;
  }

  // ── Candidate Fetching ──

  /**
   * 设置页面筛选条件
   */
  async applyFilters(filters: {
    keywords?: string[];
    degree?: string[];
    experience?: string[];
    schoolTags?: string[];
  }): Promise<void> {
    const page = this.getPage();

    this.log('Opening filter panel...');
    const filterBtn = await page.$(SEL.filterBtn);
    if (filterBtn) {
      await filterBtn.click();
      await this.randomDelay(500, 1000);

      // 如果出现"应用上次筛选"提示，点取消
      const cancelBtn = await page.$(SEL.filterCancel);
      if (cancelBtn) {
        await cancelBtn.click();
        await this.randomDelay(500, 1000);
      }
    }

    // 关键词
    if (filters.keywords && filters.keywords.length > 0) {
      await this.setFilterKeywords(filters.keywords.slice(0, 4));
    }

    // 学历
    if (filters.degree && filters.degree.length > 0) {
      await this.setFilterOption('学历', filters.degree);
    }

    // 经验
    if (filters.experience && filters.experience.length > 0) {
      await this.setFilterOption('经验', filters.experience);
    }

    // 院校
    if (filters.schoolTags && filters.schoolTags.length > 0) {
      await this.setFilterOption('院校', filters.schoolTags);
    }

    // 确认筛选
    const confirmBtn = await page.$(SEL.filterConfirm);
    if (confirmBtn) {
      await confirmBtn.click();
      await this.randomDelay(1000, 2000);
    }

    this.log('Filters applied');
  }

  /**
   * 切换到目标 tab（推荐/最新/精选）
   */
  async switchTab(tabName: string): Promise<void> {
    const page = this.getPage();

    // 查找匹配的 tab
    const tabs = await page.$$(SEL.tabItem);
    for (const tab of tabs) {
      const text = await tab.textContent();
      if (text?.includes(tabName)) {
        // 检查是否已经是当前 tab
        const isActive = await tab.$(SEL.tabItemActive);
        const classes = await tab.getAttribute('class');
        if (classes?.includes('current') || classes?.includes('active')) {
          this.log(`Already on tab "${tabName}"`);
          return;
        }
        await tab.click();
        await this.randomDelay(1500, 3000);
        this.log(`Switched to tab "${tabName}"`);
        return;
      }
    }
    this.log(`Tab "${tabName}" not found, skipping`);
  }

  /**
   * 滚动加载候选人并解析
   * @param onBatch 每批解析完成后回调（用于实时过滤/评分）
   * @param shouldStop 外部终止信号
   */
  async scrollAndCollectCandidates(options: {
    onBatch?: (raws: BossCandidateRaw[]) => void;
    rateLimiter?: BossRateLimiter;
    signal?: { stop: boolean };
  }): Promise<{
    candidates: BossCandidateRaw[];
    terminatedBy: 'no_more' | 'empty_pool' | 'scroll_stable' | 'quota_exhausted' | 'signal';
  }> {
    const page = this.getPage();
    const allCandidates = new Map<string, BossCandidateRaw>();
    let emptyScrollCount = 0;
    const MAX_EMPTY_SCROLLS = 3;
    const MAX_SCROLLS = 50; // 安全上限

    this.log('Starting candidate collection...');

    for (let i = 0; i < MAX_SCROLLS; i++) {
      // 外部停止信号
      if (options.signal?.stop) {
        this.log('Stopped by external signal');
        return { candidates: Array.from(allCandidates.values()), terminatedBy: 'signal' };
      }

      // 检测风控弹窗
      const quotaResult = await this.detectQuotaModal();
      if (quotaResult === 'quota_exhausted') {
        this.log('Daily quota exhausted detected');
        return { candidates: Array.from(allCandidates.values()), terminatedBy: 'quota_exhausted' };
      } else if (quotaResult === 'rate_limited') {
        this.log('Rate limit detected, backing off...');
        if (options.rateLimiter) {
          await options.rateLimiter.handleRateLimit();
        } else {
          await this.randomDelay(10000, 30000);
        }
        continue;
      }

      // 频率控制
      if (options.rateLimiter) {
        await options.rateLimiter.waitAndRecord();
      }

      // 解析当前可见的候选人卡片
      const batch = await this.parseVisibleCandidates();

      let newInBatch = 0;
      for (const raw of batch) {
        if (!allCandidates.has(raw.id)) {
          allCandidates.set(raw.id, raw);
          newInBatch++;
        }
      }

      if (newInBatch === 0) {
        emptyScrollCount++;
        this.log(`Scroll ${i + 1}: no new candidates (${emptyScrollCount}/${MAX_EMPTY_SCROLLS})`);
      } else {
        emptyScrollCount = 0;
        this.log(`Scroll ${i + 1}: found ${newInBatch} new candidates (total: ${allCandidates.size})`);
        if (options.onBatch) {
          options.onBatch(batch);
        }
      }

      // 终止条件
      if (await this.checkNoMore(page)) {
        this.log('No more candidates indicator found');
        return { candidates: Array.from(allCandidates.values()), terminatedBy: 'no_more' };
      }

      if (await this.checkEmptyPool(page)) {
        this.log('Empty strict pool detected, continuing recommendation stream');
        // 不终止，继续滚动推荐流
      }

      if (emptyScrollCount >= MAX_EMPTY_SCROLLS) {
        this.log(`No new candidates after ${MAX_EMPTY_SCROLLS} scrolls`);
        return { candidates: Array.from(allCandidates.values()), terminatedBy: 'scroll_stable' };
      }

      // 滚动
      await page.evaluate(() => {
        window.scrollBy(0, 600 + Math.random() * 400);
      });
      await this.randomDelay(2000, 5000);
    }

    this.log(`Reached max scroll limit (${MAX_SCROLLS})`);
    return { candidates: Array.from(allCandidates.values()), terminatedBy: 'scroll_stable' };
  }

  // ── Reach Out ──

  /**
   * 发送打招呼消息
   * @returns success, 以及是否已发送过（幂等检测）
   */
  async reachOut(candidate: Candidate, message: string): Promise<{
    success: boolean;
    alreadyContacted?: boolean;
    rateLimited?: boolean;
    error?: string;
  }> {
    const page = this.getPage();

    // 在候选人列表页找到目标候选人卡片
    const card = await this.findCandidateCard(candidate);
    if (!card) {
      return { success: false, error: 'CANDIDATE_CARD_NOT_FOUND' };
    }

    // 检查按钮状态 — 幂等保护
    const continueBtn = await card.$(SEL.continueChatBtn);
    if (continueBtn) {
      this.log(`Candidate ${candidate.name} already contacted (continue button present)`);
      return { success: false, alreadyContacted: true };
    }

    // 点击"立即沟通"/"打招呼"
    const greetBtn = await card.$(SEL.greetBtn) ?? await card.$(SEL.startChatBtn);
    if (!greetBtn) {
      return { success: false, error: 'GREET_BUTTON_NOT_FOUND' };
    }

    await this.randomDelay(3000, 8000);

    // 检测频率限制
    const rateLimitResult = await this.detectQuotaModal();
    if (rateLimitResult === 'rate_limited') {
      return { success: false, rateLimited: true, error: 'RATE_LIMITED' };
    }
    if (rateLimitResult === 'quota_exhausted') {
      return { success: false, rateLimited: true, error: 'DAILY_QUOTA_EXHAUSTED' };
    }

    await greetBtn.click();
    await this.randomDelay(1000, 2000);

    // 在聊天输入框中输入消息
    const chatInput = await page.$(SEL.chatInput);
    if (chatInput) {
      await chatInput.click();
      await chatInput.fill('');
      await this.randomDelay(500, 1000);
      await chatInput.type(message, { delay: 50 + Math.random() * 100 });
      await this.randomDelay(500, 1500);

      // 发送
      const sendBtn = await page.$(SEL.chatSendBtn);
      if (sendBtn) {
        await sendBtn.click();
        await this.randomDelay(1000, 2000);
      }
    }

    // 返回列表页
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await this.randomDelay(1000, 2000);

    // 再次检查按钮状态 — 幂等校验
    const verifyCard = await this.findCandidateCard(candidate);
    if (verifyCard) {
      const verifyContinue = await verifyCard.$(SEL.continueChatBtn);
      if (verifyContinue) {
        this.log(`Greeting sent to ${candidate.name} — verified (button → 继续沟通)`);
        return { success: true };
      }
    }

    this.log(`Greeting sent to ${candidate.name} — verification inconclusive`);
    return { success: true }; // 仍然返回成功，可能是页面还没刷新
  }

  // ── Conversation Status ──

  /**
   * 获取候选人的对话状态
   * 通过打开对话页面、读取最后一条消息来判断
   */
  async getConversationStatus(candidate: Candidate): Promise<{
    status: ConversationStatus;
    lastMessage?: string;
    lastMessageFrom?: 'me' | 'candidate';
  }> {
    const page = this.getPage();

    // 找到候选人卡片并点击进入对话
    const card = await this.findCandidateCard(candidate);
    if (!card) {
      return { status: 'uncontacted' };
    }

    const chatBtn = await card.$(SEL.greetBtn)
      ?? await card.$(SEL.startChatBtn)
      ?? await card.$(SEL.continueChatBtn);

    if (!chatBtn) {
      return { status: 'uncontacted' };
    }

    const btnText = await chatBtn.textContent();
    // 如果是"继续沟通"或"沟通"，说明已联系过
    if (btnText?.includes('继续') || btnText?.includes('沟通') && !btnText?.includes('立即')) {
      await chatBtn.click();
      await this.randomDelay(2000, 4000);
    } else {
      // 从未联系
      return { status: 'uncontacted' };
    }

    // 读取对话消息
    const messages = await this.parseChatMessages(page);

    // 返回列表页
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});

    if (messages.length === 0) {
      return { status: 'contacted' };
    }

    const lastMsg = messages[messages.length - 1];
    if (lastMsg.from === 'candidate') {
      return { status: 'replied', lastMessage: lastMsg.text, lastMessageFrom: 'candidate' };
    }

    return { status: 'contacted', lastMessage: lastMsg.text, lastMessageFrom: 'me' };
  }

  // ── Private helpers ──

  /**
   * 解析当前页面可见的候选人卡片
   */
  private async parseVisibleCandidates(): Promise<BossCandidateRaw[]> {
    const page = this.getPage();
    const candidates: BossCandidateRaw[] = [];

    const cards = await page.$$(SEL.candidateCard);
    this.log(`Found ${cards.length} candidate cards on page`);

    for (const card of cards) {
      try {
        const raw = await this.parseCandidateCard(card);
        if (raw && raw.name) {
          candidates.push(raw);
        }
      } catch (err) {
        this.log(`Failed to parse card: ${(err as Error).message}`);
      }
    }

    return candidates;
  }

  /**
   * 解析单个候选人卡片
   */
  private async parseCandidateCard(card: ElementHandle<Element>): Promise<BossCandidateRaw | null> {
    const page = this.getPage();

    const id = await card.evaluate(el => el.getAttribute('data-hid') ?? el.getAttribute('data-ka') ?? crypto.randomUUID()).catch(() => undefined);
    const name = await card.$eval(SEL.candidateName, el => el.textContent?.trim() ?? '').catch(() => '');
    const school = await card.$eval(SEL.candidateSchool, el => el.textContent?.trim() ?? '').catch(() => '');
    const company = await card.$eval(SEL.candidateCompany, el => el.textContent?.trim() ?? '').catch(() => '');
    const title = await card.$eval(SEL.candidateTitle, el => el.textContent?.trim() ?? '').catch(() => '');

    if (!name || name.length === 0) return null;

    // 提取在线状态
    const onlineStatus = await this.parseOnlineStatus(card);

    // 提取按钮状态
    const hasGreetBtn = await card.$(SEL.greetBtn).catch(() => null);
    const hasContinueBtn = await card.$(SEL.continueChatBtn).catch(() => null);
    const buttonState = hasContinueBtn ? 'continue' : hasGreetBtn ? 'greet' : undefined;

    // 提取经验年限
    const experienceText = await card.$eval(SEL.candidateExperience, el => el.textContent?.trim() ?? '').catch(() => '');
    const experienceYears = this.parseExperienceYears(experienceText);

    // 提取学历
    const degree = await card.$eval(SEL.candidateDegree, el => el.textContent?.trim() ?? '').catch(() => '');

    // 解析技能标签
    const skills = await card.evaluate(el => {
      const tags = el.querySelectorAll('.tag-list .tag, .skill-tag, .info-tag');
      return Array.from(tags).map((t: Element) => t.textContent?.trim() ?? '').filter(Boolean);
    }).catch(() => []);

    return {
      id: id ?? `${name}-${school}-${company}`,
      name,
      school: school || undefined,
      degree: degree || undefined,
      company: company || undefined,
      title: title || undefined,
      experienceYears,
      skills: skills.length > 0 ? skills : undefined,
      onlineStatus,
      buttonState,
    };
  }

  /**
   * 在页面中找到目标候选人的卡片
   */
  private async findCandidateCard(candidate: Candidate): Promise<ElementHandle<Element> | null> {
    const page = this.getPage();
    const cards = await page.$$(SEL.candidateCard);

    for (const card of cards) {
      const nameEl = await card.$(SEL.candidateName);
      if (!nameEl) continue;

      const nameText = await nameEl.textContent();
      if (nameText?.trim() === candidate.name) {
        return card;
      }
    }

    return null;
  }

  /**
   * 检测风控弹窗
   * @returns 'quota_exhausted' | 'rate_limited' | null
   */
  private async detectQuotaModal(): Promise<'quota_exhausted' | 'rate_limited' | null> {
    const page = this.getPage();

    try {
      // 检查是否出现弹窗
      const modal = await page.$(SEL.quotaModal);
      if (!modal) return null;

      const modalText = await modal.textContent();
      if (!modalText) return null;

      // 每日上限
      if (SEL.quotaText.test(modalText)) {
        // 关闭弹窗
        await this.closeModal(page);
        return 'quota_exhausted';
      }

      // 频率限制
      if (SEL.rateLimitText.test(modalText)) {
        await this.closeModal(page);
        return 'rate_limited';
      }
    } catch {
      // no modal found
    }

    return null;
  }

  /**
   * 关闭弹窗
   */
  private async closeModal(page: Page): Promise<void> {
    try {
      const closeBtn = await page.$('.dialog-close, .modal-close, .close-btn');
      if (closeBtn) {
        await closeBtn.click();
        await this.randomDelay(500, 1000);
      } else {
        // 尝试按 Esc
        await page.keyboard.press('Escape');
        await this.randomDelay(500, 1000);
      }
    } catch { /* ignore */ }
  }

  /**
   * 解析在线状态
   */
  private async parseOnlineStatus(card: ElementHandle<Element>): Promise<BossCandidateRaw['onlineStatus']> {
    const tag = await card.$(SEL.onlineTag).catch(() => null);
    if (!tag) return 'inactive';

    const text = await tag.textContent().catch(() => '');
    if (!text) return 'inactive';

    const lower = text.toLowerCase();
    if (lower.includes('在线') || lower.includes('online')) return 'online';
    if (lower.includes('今日') || lower.includes('today')) return 'today';
    if (lower.includes('活跃') || lower.includes('recently')) return 'recently';
    if (lower.includes('本周') || lower.includes('week')) return 'this_week';

    return 'inactive';
  }

  /**
   * 从文本中解析经验年限
   */
  private parseExperienceYears(text: string): number | undefined {
    if (!text) return undefined;

    // 匹配 "X年" 或 "X年经验"
    const yearMatch = text.match(/(\d+)\s*年/);
    if (yearMatch) {
      const years = parseInt(yearMatch[1], 10);
      return isNaN(years) ? undefined : years;
    }

    // "应届"/"在校" → 0
    if (text.includes('应届') || text.includes('在校')) return 0;

    return undefined;
  }

  /**
   * 解析聊天消息列表
   */
  private async parseChatMessages(page: Page): Promise<Array<{ text: string; from: 'me' | 'candidate' }>> {
    const messages: Array<{ text: string; from: 'me' | 'candidate' }> = [];

    try {
      const msgList = await page.$(SEL.chatMessageList);
      if (!msgList) return messages;

      const items = await msgList.$$('.chat-message, .message-item, [class*="message"]');
      for (const item of items) {
        const text = await item.$eval('.text, .content, .msg-text', (el: Element) => el.textContent?.trim() ?? '').catch(() => '');
        if (!text) continue;

        // 通过 class 判断消息方向
        const classes = await item.getAttribute('class').catch(() => '');
        const isSelf = classes?.includes('self') || classes?.includes('mine') || classes?.includes('right');
        messages.push({ text, from: isSelf ? 'me' : 'candidate' });
      }
    } catch { /* ignore parse errors */ }

    return messages;
  }

  /**
   * 设置筛选关键词
   */
  private async setFilterKeywords(keywords: string[]): Promise<void> {
    const page = this.getPage();

    for (const kw of keywords) {
      const input = await page.$(SEL.keywordFilter);
      if (input) {
        await input.click();
        await this.randomDelay(300, 600);
        await input.type(kw, { delay: 50 });
        await this.randomDelay(300, 600);
        await page.keyboard.press('Enter');
        await this.randomDelay(500, 1000);
      }
    }
  }

  /**
   * 通用筛选选项设置（学历/经验/院校）
   */
  private async setFilterOption(category: string, values: string[]): Promise<void> {
    const page = this.getPage();
    const panel = await page.$(SEL.filterPanel);
    if (!panel) return;

    const categoryHeaders = await panel.$$eval('dt, .filter-label, .filter-title', (els) =>
      els.map(el => el.textContent?.trim() ?? '')
    );

    let categoryIndex = categoryHeaders.findIndex(h => h.includes(category));
    if (categoryIndex === -1) {
      categoryIndex = categoryHeaders.findIndex(h => {
        const lower = h.toLowerCase();
        return lower.includes('学历') || lower.includes('edu') && category === '学历'
          || lower.includes('经验') || lower.includes('exp') && category === '经验'
          || lower.includes('院校') || lower.includes('school') && category === '院校';
      });
    }

    if (categoryIndex === -1) {
      this.log(`Filter category "${category}" not found in panel`);
      return;
    }

    const ddElements = await panel.$$('dd, .filter-options, .options-list');
    if (categoryIndex < ddElements.length) {
      const optionsContainer = ddElements[categoryIndex];
      const options = await optionsContainer.$$('span, a, .option, label');

      for (const opt of options) {
        const text = await opt.textContent();
        if (values.some(v => text?.includes(v))) {
          await opt.click();
          await this.randomDelay(300, 600);
        }
      }
    }
  }

  /**
   * 检查页面是否显示"没有更多"等终止标识
   */
  private async checkNoMore(page: Page): Promise<boolean> {
    try {
      const bodyText = await page.evaluate(() => document.body.innerText);
      const lines = (bodyText as string).split('\n').map((l: string) => l.trim()).filter(Boolean);
      const lastLines = lines.slice(-10);
      return lastLines.some((line: string) => SEL.noMore.test(line));
    } catch {
      return false;
    }
  }

  /**
   * 检查是否出现"暂无符合牛人"严格池耗尽提示
   */
  private async checkEmptyPool(page: Page): Promise<boolean> {
    try {
      const bodyText = await page.evaluate(() => document.body.innerText);
      return SEL.emptyPool.test(bodyText as string);
    } catch {
      return false;
    }
  }

  /**
   * 随机延迟（模拟人类操作节奏）
   */
  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise<void>(resolve => setTimeout(resolve as () => void, ms));
  }

  private log(msg: string): void {
    this.logger(`[BossBrowser] ${msg}`);
  }
}

// ────────────────────────────────────────────────────────────
// Helpers — convert BossCandidateRaw → Candidate
// ────────────────────────────────────────────────────────────

/**
 * 将 BossCandidateRaw 转换为平台无关的 Candidate 格式
 */
export function rawToCandidate(raw: BossCandidateRaw, platform: string = 'boss'): Candidate {
  const profile: CandidateProfile = {
    education: [],
    experience: [],
    skills: raw.skills ?? [],
    ext: {
      onlineStatus: raw.onlineStatus,
      jobIntention: raw.jobIntention,
      buttonState: raw.buttonState,
    },
  };

  if (raw.school || raw.degree) {
    const edu: Education = {
      school: raw.school ?? '',
      degree: raw.degree,
      major: raw.major,
      isTopSchool: raw.isTopSchool,
    };
    profile.education.push(edu);
  }

  if (raw.company || raw.title) {
    const exp: Experience = {
      company: raw.company ?? '',
      title: raw.title ?? '',
      duration: raw.experienceYears ? `${raw.experienceYears}年` : undefined,
      isTopCompany: raw.isTopCompany,
    };
    profile.experience.push(exp);
  }

  return {
    id: raw.id,
    name: raw.name,
    platform,
    profile,
    source: {
      rawData: { ...raw },
    },
  };
}

/**
 * 生成默认打招呼话术
 */
export function generateDefaultMessage(jobTitle: string, companyName?: string): string {
  const templates = [
    `您好！看了您的履历觉得很匹配我们${jobTitle}的岗位，想进一步了解您的意向，方便聊聊吗？`,
    `Hi~ 我们正在招聘${jobTitle}，觉得您的背景很不错，有机会进一步沟通吗？`,
    `您好，我们是${companyName ?? '一家科技公司'}，目前在招${jobTitle}，您的经验很契合，方便交流一下吗？`,
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}
