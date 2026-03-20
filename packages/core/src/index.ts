// @hireclaw/core — Main Entry Point

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
