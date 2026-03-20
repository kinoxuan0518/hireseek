// ============================================================
// @hireclaw/core — Types & Interfaces
// 招聘智能体 SDK 的公共类型定义
// ============================================================

// ────────────────────────────────────────────────────────────
// Platform Adapter Interface
// ────────────────────────────────────────────────────────────

/**
 * 任何招聘平台只需实现此接口即可接入 HireClaw SDK
 * "手脚"与"大脑"的连接点
 */
export interface PlatformAdapter {
  /** 平台标识，如 'boss', 'maimai', 'linkedin' */
  readonly name: string;

  /** 获取候选人列表（平台无关的标准格式） */
  getCandidates(request: CandidateFetchRequest): Promise<CandidateFetchResult>;

  /** 发送触达消息 */
  reachOut(request: ReachOutRequest): Promise<ReachOutResult>;

  /** 获取对话状态 */
  getConversationStatus(candidateId: string): Promise<ConversationStatus>;

  /** 获取平台运行状态（剩余额度、频率限制等） */
  getStatus(): Promise<PlatformStatus>;

  /** 初始化（登录检查、环境准备等） */
  init?(): Promise<void>;

  /** 清理资源 */
  destroy?(): Promise<void>;
}

// ────────────────────────────────────────────────────────────
// Candidate Types
// ────────────────────────────────────────────────────────────

/** 平台无关的标准候选人格式 */
export interface Candidate {
  /** 平台内唯一 ID */
  id: string;
  /** 姓名 */
  name: string;
  /** 来源平台 */
  platform: string;
  /** 标准化的 Profile */
  profile: CandidateProfile;
  /** 原始数据来源 */
  source: CandidateSource;
  /** SDK 评估结果（由 Evaluator 填充） */
  evaluation?: EvaluationResult;
  /** 触达记录 */
  outreach?: OutreachRecord[];
}

export interface CandidateProfile {
  /** 教育经历 */
  education: Education[];
  /** 工作经历 */
  experience: Experience[];
  /** 技能标签 */
  skills: string[];
  /** 平台特有字段 */
  ext: Record<string, unknown>;
}

export interface Education {
  school: string;
  degree?: string;
  major?: string;
  gpa?: number | string;
  startYear?: number;
  endYear?: number;
  isTopSchool?: boolean; // 985/211/海外名校
}

export interface Experience {
  company: string;
  title: string;
  startDate?: string;
  endDate?: string;
  duration?: string; // 如 "2年3个月"
  description?: string;
  highlights?: string[];
  isTopCompany?: boolean; // 大厂/明星公司
}

export interface CandidateSource {
  /** 原始页面 URL */
  url?: string;
  /** 截图路径 */
  screenshots?: string[];
  /** 原始文本 */
  rawText?: string;
  /** 平台特有原始数据 */
  rawData?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Job Configuration
// ────────────────────────────────────────────────────────────

export interface JobConfig {
  id: string;
  title: string;
  department?: string;
  location?: string;
  description?: string;
  /** 薪资范围 */
  salary?: SalaryRange;
  /** 目标平台 */
  platforms: string[];
  /** 评估配置 */
  evaluation?: EvaluationConfig;
  /** 触达策略 */
  outreach?: OutreachConfig;
  /** 每日触达上限 */
  dailyLimit?: number;
  /** 自定义筛选条件（传给 adapter） */
  filters?: Record<string, unknown>;
}

export interface SalaryRange {
  min: number;
  max: number;
  currency?: string;
  period?: 'month' | 'year';
}

// ────────────────────────────────────────────────────────────
// Evaluation Types
// ────────────────────────────────────────────────────────────

export interface EvaluationConfig {
  /** 严格度：strict | standard | relaxed */
  strictness?: 'strict' | 'standard' | 'relaxed';
  /** 各维度权重 */
  weights?: Partial<EvaluationWeights>;
  /** 一票否决规则 */
  vetoes?: VetoRule[];
  /** 加分项 */
  bonuses?: BonusRule[];
  /** 目标岗位特有要求 */
  requirements?: string[];
}

export interface EvaluationWeights {
  education: number;     // 学历权重 (0-1)
  experience: number;    // 经验权重 (0-1)
  skills: number;        // 技能权重 (0-1)
  company: number;       // 公司背景权重 (0-1)
  growth: number;        // 成长轨迹权重 (0-1)
  personality: number;   // 个人特质权重 (0-1)
}

export const DEFAULT_WEIGHTS: EvaluationWeights = {
  education: 0.15,
  experience: 0.25,
  skills: 0.25,
  company: 0.15,
  growth: 0.10,
  personality: 0.10,
};

export interface VetoRule {
  description: string;
  /** 返回 true 则一票否决 */
  check: (candidate: Candidate, job: JobConfig) => boolean | Promise<boolean>;
}

export interface BonusRule {
  description: string;
  points: number;
  /** 返回 true 则加分 */
  check: (candidate: Candidate, job: JobConfig) => boolean | Promise<boolean>;
}

export interface EvaluationResult {
  /** 总分 0-100 */
  score: number;
  /** 是否达到通过阈值（默认 80%） */
  passed: boolean;
  /** 通过阈值 */
  threshold: number;
  /** 各维度评分 */
  dimensions: EvaluationDimension[];
  /** 命中的否决规则 */
  vetoed: string[];
  /** 命中的加分项 */
  bonuses: BonusHit[];
  /** 推荐的触达优先级 */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** AI 生成的综合评价 */
  summary?: string;
}

export interface EvaluationDimension {
  name: string;
  score: number;      // 0-100
  weight: number;     // 0-1
  weightedScore: number;
  notes: string;
}

export interface BonusHit {
  rule: string;
  points: number;
}

// ────────────────────────────────────────────────────────────
// Outreach Types
// ────────────────────────────────────────────────────────────

export interface OutreachConfig {
  /** 话术风格：professional | casual | warm */
  style?: 'professional' | 'casual' | 'warm';
  /** 品牌调性注入 */
  brandTone?: string;
  /** 公司亮点（用于生成个性化话术） */
  companyHighlights?: string[];
  /** 是否启用多平台多次触达 */
  multiPlatform?: boolean;
  /** 跟进策略 */
  followUp?: FollowUpConfig;
}

export interface FollowUpConfig {
  enabled: boolean;
  /** 未回复多久后再次触达（天） */
  retryAfterDays: number;
  /** 最大触达次数 */
  maxAttempts: number;
  /** 是否换平台 */
  switchPlatform: boolean;
}

export interface OutreachMessage {
  /** 生成的消息内容 */
  content: string;
  /** 话术层次（1-4，参考 outreach-guide.md） */
  level: 1 | 2 | 3 | 4;
  /** 个性化理由（为什么这么写） */
  reasoning: string;
  /** 建议触达渠道 */
  suggestedChannel?: string;
  /** 建议触达时间 */
  suggestedTime?: string;
}

export interface OutreachRecord {
  candidateId: string;
  platform: string;
  message: string;
  sentAt: string;
  result: 'sent' | 'failed' | 'rate_limited' | 'banned';
  response?: string;
  repliedAt?: string;
}

// ────────────────────────────────────────────────────────────
// Pipeline Types
// ────────────────────────────────────────────────────────────

export interface PipelineRunRequest {
  job: JobConfig;
  platforms: string[];
  strategy?: {
    evaluationStrictness?: 'strict' | 'standard' | 'relaxed';
    outreachStyle?: 'professional' | 'casual' | 'warm';
    followUpEnabled?: boolean;
    dailyLimit?: number;
    dryRun?: boolean; // 只评估不触达
  };
}

export interface PipelineRunResult {
  runId: string;
  job: JobConfig;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  platformResults: PlatformRunResult[];
  totalCandidates: number;
  totalEvaluated: number;
  totalPassed: number;
  totalReached: number;
  totalSkipped: number;
  errors: PipelineError[];
}

export interface PlatformRunResult {
  platform: string;
  fetched: number;
  evaluated: number;
  passed: number;
  reached: number;
  skipped: number;
  errors: string[];
}

export interface PipelineError {
  platform: string;
  stage: 'fetch' | 'evaluate' | 'outreach';
  candidateId?: string;
  error: string;
  recoverable: boolean;
}

// ────────────────────────────────────────────────────────────
// Memory Types
// ────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  type: 'candidate_interaction' | 'preference' | 'pattern' | 'lesson';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateInteractionMemory {
  candidateId: string;
  candidateName: string;
  platform: string;
  interactions: {
    date: string;
    action: string;
    outcome: string;
    notes?: string;
  }[];
  assessment: string;
  tags: string[];
}

// ────────────────────────────────────────────────────────────
// Knowledge Types
// ────────────────────────────────────────────────────────────

export interface KnowledgeBase {
  /** 评估维度定义 */
  evaluationDimensions: EvaluationDimensionDef[];
  /** 话术模板 */
  outreachTemplates: OutreachTemplate[];
  /** 风控规则 */
  riskControlRules: RiskControlRule[];
}

export interface EvaluationDimensionDef {
  name: string;
  description: string;
  scoringGuide: string;
  defaultWeight: number;
}

export interface OutreachTemplate {
  name: string;
  style: 'professional' | 'casual' | 'warm';
  template: string;
  variables: string[];
 适用场景: string;
}

export interface RiskControlRule {
  name: string;
  description: string;
  /** 触发条件 */
  condition: string;
  /** 触发后的动作 */
  action: 'stop' | 'slow_down' | 'alert' | 'skip';
  /** 退避时间（秒） */
  backoffSeconds?: number;
}

// ────────────────────────────────────────────────────────────
// Request / Result Types
// ────────────────────────────────────────────────────────────

export interface CandidateFetchRequest {
  job: JobConfig;
  /** 最多获取多少候选人 */
  limit?: number;
  /** 是否仅获取新候选人（增量） */
  incremental?: boolean;
  /** 上次获取的游标 */
  cursor?: string;
}

export interface CandidateFetchResult {
  candidates: Candidate[];
  /** 是否还有更多 */
  hasMore: boolean;
  /** 下次请求的游标 */
  nextCursor?: string;
  /** 平台状态快照 */
  platformStatus?: PlatformStatus;
}

export interface ReachOutRequest {
  candidate: Candidate;
  message: string;
}

export interface ReachOutResult {
  success: boolean;
  /** 失败原因 */
  error?: string;
  /** 是否触发频率限制 */
  rateLimited?: boolean;
  /** 平台剩余可触达数 */
  remainingQuota?: number;
}

export type ConversationStatus =
  | 'uncontacted'
  | 'contacted'
  | 'replied'
  | 'resume_requested'
  | 'resume_received'
  | 'interviewed'
  | 'offered'
  | 'joined'
  | 'rejected'
  | 'dropped';

export interface PlatformStatus {
  platform: string;
  /** 是否已登录 */
  loggedIn: boolean;
  /** 今日剩余可触达数 */
  remainingQuota?: number;
  /** 是否被频率限制 */
  rateLimited: boolean;
  /** 频率限制解除时间 */
  rateLimitResetsAt?: string;
  /** 账号状态 */
  accountStatus: 'active' | 'restricted' | 'banned';
}

// ────────────────────────────────────────────────────────────
// SDK Configuration
// ────────────────────────────────────────────────────────────

export interface HireClawSDKConfig {
  /** LLM 配置 */
  llm: LLMConfig;
  /** 知识库配置 */
  knowledge?: KnowledgeConfig;
  /** 记忆存储配置 */
  memory?: MemoryConfig;
}

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string; // 自定义 endpoint
}

export interface KnowledgeConfig {
  /** 自定义知识库文件路径 */
  customPaths?: string[];
  /** 覆盖默认评估权重 */
  evaluationWeights?: Partial<EvaluationWeights>;
  /** 额外的一票否决规则 */
  additionalVetoes?: VetoRule[];
  /** 额外的加分项 */
  additionalBonuses?: BonusRule[];
}

export interface MemoryConfig {
  /** 存储类型 */
  type: 'memory' | 'sqlite' | 'custom';
  /** SQLite 路径（type=sqlite 时） */
  sqlitePath?: string;
  /** 自定义存储实现（type=custom 时） */
  customStore?: MemoryStore;
}

/** 自定义记忆存储接口 */
export interface MemoryStore {
  save(entry: MemoryEntry): Promise<void>;
  query(filter: Partial<MemoryEntry>): Promise<MemoryEntry[]>;
  get(id: string): Promise<MemoryEntry | null>;
  delete(id: string): Promise<void>;
}
