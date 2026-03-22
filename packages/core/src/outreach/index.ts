// @hireclaw/core/outreach — 触达策略引擎
//
// Unified entry point: LLM-driven message generation with template fallback.
// - Tier classification & outreach planning always use rules (deterministic)
// - Message generation: LLM when available, template fallback

// Re-export everything from the template engine (backward compatible)
export {
  classifyTier,
  TIER_STRATEGY,
  generateMessage,
  planOutreach,
  planOutreachBatch,
  calculateFunnel,
} from './template.js';
export type {
  Tier,
  MessageContext,
  OutreachPlan,
  PlannedAttempt,
  FunnelStats,
} from './template.js';

// LLM-powered message generation
export { generateMessageWithLLM } from './llm.js';
export type { LLMOutreachOptions } from './llm.js';
