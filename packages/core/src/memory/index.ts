// @hireclaw/core/memory — 统一导出

// MemoryStore (interface + implementations)
export {
  type IMemoryStore,
  type MemoryQueryFilter,
  type MemoryStats,
  InMemoryStore,
  FileStore,
  createMemoryStore,
  type StoreFactoryOptions,
} from './MemoryStore.js';

// CandidateMemory
export {
  type CandidateMemoryEntry,
  type EvaluationSnapshot,
  type CandidateInteraction,
  type CandidateMemoryConfig,
  type RememberContext,
  CandidateMemory,
} from './CandidateMemory.js';

// DemandMemory
export {
  type DemandMemoryEntry,
  type RejectionFeedback,
  type DemandMemoryConfig,
  type DemandStats,
  DemandMemory,
} from './DemandMemory.js';

// AutoMemory
export {
  type AutoMemoryConfig,
  type MemoryPattern,
  type PatternType,
  type MemorySummary,
  type PendingWorkItem,
  type MemoryStats as AutoMemoryStats,
  type TimelineEvent,
  AutoMemory,
} from './AutoMemory.js';
