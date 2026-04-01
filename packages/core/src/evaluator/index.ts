// @hireclaw/core/evaluator — 候选人评估引擎
//
// Unified entry point: LLM-driven evaluation with rule engine fallback.
// - With LLM config → calls LLM, falls back to rules on failure
// - Without LLM config → uses rule engine directly

// Re-export everything from the rule engine (backward compatible)
export {
  evaluate,
  evaluateBatch,
  EVALUATION_DIMENSIONS,
  DEFAULT_VETOES,
  DEFAULT_BONUSES,
} from './rules.js';
export type { EvaluateOptions, EvaluateResult } from './rules.js';

// LLM-powered evaluation
export {
  evaluateWithLLM,
  evaluateBatchWithLLM,
} from './llm.js';
export type { LLMEvaluatorOptions } from './llm.js';

// ── Evaluator (higher-level API) ──
export { Evaluator } from './Evaluator.js';
export type { EvaluatorConfig } from './Evaluator.js';
export {
  DIMENSION_DEFINITIONS,
  validateWeights,
  normalizeWeights,
  scoreToLevel,
  LEVEL_LABELS,
  LEVEL_COLORS,
} from './dimensions/Dimensions.js';
export type {
  DimensionDef,
  DimensionKey,
  ScoreLevel,
  ScoredDimension,
} from './dimensions/Dimensions.js';

// ── Report Generator ──
export { ReportGenerator } from './report/ReportGenerator.js';
export type {
  EvaluationReport,
  BatchReport,
  RankedCandidate,
  ScoreDistribution,
  PlatformStats,
} from './report/ReportGenerator.js';
