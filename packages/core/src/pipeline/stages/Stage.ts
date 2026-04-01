// @hireclaw/core/pipeline/stages — 流水线阶段定义
//
// 参考 Claude Code 的 Agentic Loop（收集上下文 → 采取行动 → 验证结果）
// 将招聘流水线拆解为明确的阶段，每个阶段可配置、可观察、可审计
//
// 阶段顺序：discover → evaluate → filter → plan → outreach → followup

import type { Candidate, JobConfig, EvaluationResult } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Stage Types
// ────────────────────────────────────────────────────────────

/**
 * 流水线阶段标识
 *
 * 参考 Claude Code Agentic Loop：
 * - 收集上下文 = discover（发现候选人）
 * - 采取行动 = evaluate + outreach（评估 + 触达）
 * - 验证结果 = followup（跟进验证）
 */
export type StageId =
  | 'discover'    // 发现候选人（从平台拉取）
  | 'evaluate'    // 评估候选人（打分 + 判断通过）
  | 'filter'      // 过滤候选人（人工/规则过滤）
  | 'plan'       // 制定触达计划（话术 + 渠道 + 时间）
  | 'outreach'   // 执行触达（发送消息）
  | 'followup'   // 跟进验证（等待回复 + 再次触达）
  | 'complete';   // 完成（流水线结束）

export interface StageMetadata {
  id: StageId;
  label: string;
  description: string;
  /** 预期产出 */
  outputs: string[];
  /** 可配置项 */
  configFields: string[];
}

/**
 * 阶段元数据注册表
 */
export const STAGE_METADATA: Record<StageId, StageMetadata> = {
  discover: {
    id: 'discover',
    label: '🔍 候选人发现',
    description: '从招聘平台拉取候选人列表',
    outputs: ['candidates[]', 'platformStatus'],
    configFields: ['platforms[]', 'filters', 'limit'],
  },
  evaluate: {
    id: 'evaluate',
    label: '📊 候选人评估',
    description: '对候选人进行多维度评估打分',
    outputs: ['evaluationResults[]', 'passedCandidates[]'],
    configFields: ['threshold', 'weights', 'strictness'],
  },
  filter: {
    id: 'filter',
    label: '🎯 候选人过滤',
    description: '人工或规则过滤不适合的候选人',
    outputs: ['filteredCandidates[]', 'rejectedReasons{}'],
    configFields: ['mode', 'rules[]', 'approvalsRequired'],
  },
  plan: {
    id: 'plan',
    label: '📝 触达计划',
    description: '为每个候选人制定触达计划（话术/渠道/时间）',
    outputs: ['outreachPlans[]', 'messageTemplates{}'],
    configFields: ['templates', 'maxAttempts', 'timingStrategy'],
  },
  outreach: {
    id: 'outreach',
    label: '📨 执行触达',
    description: '通过各平台向候选人发送消息',
    outputs: ['outreachRecords[]', 'sentCount', 'failedCount'],
    configFields: ['dryRun', 'dailyLimit', 'retryOnFailure'],
  },
  followup: {
    id: 'followup',
    label: '🔄 跟进验证',
    description: '等待回复、再次触达、状态更新',
    outputs: ['followupResults[]', 'repliedCount', 'statusChanges[]'],
    configFields: ['maxFollowups', 'waitDays', 'autoFollowup'],
  },
  complete: {
    id: 'complete',
    label: '✅ 流水线完成',
    description: '流水线执行完毕，生成最终报告',
    outputs: ['pipelineResult', 'summaryReport'],
    configFields: [],
  },
};

// ────────────────────────────────────────────────────────────
// Stage Result
// ────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';

export interface StageResult<T = unknown> {
  stageId: StageId;
  status: StageStatus;
  /** 阶段开始时间 */
  startedAt?: string;
  /** 阶段结束时间 */
  completedAt?: string;
  /** 阶段产出 */
  output?: T;
  /** 错误信息 */
  error?: string;
  /** 是否可恢复（失败后） */
  recoverable?: boolean;
  /** 阶段元数据（人工介入点等） */
  metadata?: StageMetadata;
  /** 子阶段（如果有） */
  children?: StageResult[];
}

export interface StageContext {
  /** 当前阶段 */
  currentStage: StageId;
  /** 阶段计数 */
  stageCount: number;
  /** 候选人数量 */
  candidateCount: number;
  /** 已触达数量 */
  outreachCount: number;
  /** 当前时间 */
  timestamp: string;
}

// ────────────────────────────────────────────────────────────
// Stage Config
// ────────────────────────────────────────────────────────────

export interface StageConfig {
  /** 发现阶段配置 */
  discover?: DiscoverConfig;
  /** 评估阶段配置 */
  evaluate?: EvaluateConfig;
  /** 过滤阶段配置 */
  filter?: FilterConfig;
  /** 触达计划阶段配置 */
  plan?: PlanConfig;
  /** 触达执行阶段配置 */
  outreach?: OutreachConfig;
  /** 跟进阶段配置 */
  followup?: FollowupConfig;
}

export interface DiscoverConfig {
  platforms?: string[];
  limit?: number;
  filters?: CandidateFilters;
}

export interface EvaluateConfig {
  threshold?: number;
  strictness?: 'strict' | 'standard' | 'relaxed';
}

export interface FilterConfig {
  /** 过滤模式 */
  mode: 'auto' | 'manual' | 'hybrid';
  /** 人工介入阈值（多少候选人以上需要人工确认） */
  humanThreshold?: number;
  /** 自动过滤规则 */
  autoRules?: string[];
}

export interface PlanConfig {
  templates?: Record<string, string>;
  maxAttempts?: number;
  timingStrategy?: 'immediate' | 'scheduled' | 'smart';
}

export interface OutreachConfig {
  dryRun?: boolean;
  dailyLimit?: number;
  retryOnFailure?: boolean;
}

export interface FollowupConfig {
  maxFollowups?: number;
  waitDays?: number;
  autoFollowup?: boolean;
}

export interface CandidateFilters {
  /** 最低评分 */
  minScore?: number;
  /** 最高薪资预期 */
  maxSalary?: number;
  /** 优先平台 */
  preferredPlatforms?: string[];
  /** 排除关键词 */
  excludeKeywords?: string[];
}

// ────────────────────────────────────────────────────────────
// Stage Hooks
// ────────────────────────────────────────────────────────────

/**
 * 阶段生命周期钩子
 *
 * 参考 Claude Code 的 check/verify 模式：
 * - before: 阶段执行前的验证
 * - after: 阶段执行后的处理
 * - onError: 阶段失败时的处理
 */
export interface StageHooks {
  /** 阶段开始前调用 */
  before?: (ctx: StageContext) => void | Promise<void>;
  /** 阶段成功后调用 */
  after?: (ctx: StageContext, result: StageResult) => void | Promise<void>;
  /** 阶段失败时调用 */
  onError?: (ctx: StageContext, error: Error) => void | Promise<void>;
}

/**
 * 全局流水线钩子
 */
export interface PipelineHooks {
  /** 整个流水线开始前 */
  onStart?: (job: JobConfig) => void | Promise<void>;
  /** 整个流水线结束后 */
  onComplete?: (result: PipelineRunResult) => void | Promise<void>;
  /** 流水线失败时 */
  onFailure?: (error: Error) => void | Promise<void>;
  /** 每个阶段的钩子 */
  stages?: Partial<Record<StageId, StageHooks>>;
}

// ────────────────────────────────────────────────────────────
// Pipeline Run Result (enriched)
// ────────────────────────────────────────────────────────────

export interface PipelineRunResult {
  /** 流水线ID */
  pipelineId: string;
  /** 任务ID */
  jobId: string;
  /** 流水线状态 */
  status: 'completed' | 'failed' | 'paused';
  /** 各阶段结果 */
  stages: StageResult[];
  /** 总耗时（秒） */
  durationSeconds?: number;
  /** 候选人统计 */
  stats: {
    discovered: number;
    evaluated: number;
    passed: number;
    outreachSent: number;
    failed: number;
  };
}

// Re-export for convenience
export type { Candidate, JobConfig, EvaluationResult };
