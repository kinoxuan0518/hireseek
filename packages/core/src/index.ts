// @hireclaw/core — Main Entry Point

// ── Types ──
export type {
  // Platform
  PlatformAdapter,
  // Candidate
  Candidate,
  CandidateProfile,
  Education,
  Experience,
  CandidateSource,
  // Job
  JobConfig,
  SalaryRange,
  // Evaluation
  EvaluationConfig,
  EvaluationWeights,
  EvaluationResult,
  EvaluationDimension,
  EvaluationDimensionDef,
  VetoRule,
  BonusRule,
  BonusHit,
  DEFAULT_WEIGHTS,
  // Outreach
  OutreachConfig,
  FollowUpConfig,
  OutreachMessage,
  OutreachRecord,
  OutreachTemplate,
  // Pipeline
  PipelineRunRequest,
  PipelineRunResult,
  PlatformRunResult,
  PipelineError,
  // Memory
  MemoryEntry,
  CandidateInteractionMemory,
  MemoryConfig,
  MemoryStore,
  // Knowledge
  KnowledgeBase,
  RiskControlRule,
  // Request/Result
  CandidateFetchRequest,
  CandidateFetchResult,
  ReachOutRequest,
  ReachOutResult,
  ConversationStatus,
  PlatformStatus,
  // SDK
  HireClawSDKConfig,
  LLMConfig,
  KnowledgeConfig,
} from './types.js';

// ── Evaluator (rule engine — backward compatible) ──
export {
  evaluate,
  evaluateBatch,
  EVALUATION_DIMENSIONS,
  DEFAULT_VETOES,
  DEFAULT_BONUSES,
} from './evaluator/index.js';
export type { EvaluateOptions, EvaluateResult } from './evaluator/index.js';

// ── Evaluator (LLM-powered) ──
export {
  evaluateWithLLM,
  evaluateBatchWithLLM,
} from './evaluator/index.js';
export type { LLMEvaluatorOptions } from './evaluator/index.js';

// ── Outreach (template — backward compatible) ──
export {
  classifyTier,
  TIER_STRATEGY,
  generateMessage,
  planOutreach,
  planOutreachBatch,
  calculateFunnel,
} from './outreach/index.js';
export type {
  Tier,
  MessageContext,
  OutreachPlan,
  PlannedAttempt,
  FunnelStats,
} from './outreach/index.js';

// ── Outreach (LLM-powered) ──
export { generateMessageWithLLM } from './outreach/index.js';
export type { LLMOutreachOptions } from './outreach/index.js';

// ── Tracking ──
export {
  CandidateTracker,
  STATUS_TRANSITIONS,
  STATUS_LABELS,
} from './tracking/index.js';
export type {
  CandidateStatus,
  TrackingEntry,
  StatusChange,
  OutreachEvent,
  FollowUpReminder,
  TrackerConfig,
} from './tracking/index.js';

// ── LLM Provider ──
export { callLLM } from './llm/index.js';
export type { LLMMessage, LLMCallOptions, LLMResponse } from './llm/index.js';
