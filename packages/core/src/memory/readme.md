# @hireclaw/core/memory — 记忆系统

> 参考 Claude Code 的双轨记忆（CLAUDE.md + Auto Memory）设计

## 设计理念

Claude Code 的记忆系统采用双轨架构：
1. **CLAUDE.md** — 显式记忆，由用户手动维护项目上下文
2. **Auto Memory** — 自动记忆，系统发现模式后自动记录

hireclaw 的记忆系统借鉴这一理念，但面向招聘场景：

| Claude Code | hireclaw |
|-------------|----------|
| CLAUDE.md | DemandMemory（招聘需求记忆） |
| Auto Memory | CandidateMemory + AutoMemory |
| 项目上下文 | 候选人信息 + 对话交互 |

## 核心模块

```
memory/
├── README.md           # 本文件
├── index.ts            # 统一导出
├── MemoryStore.ts      # 记忆存储接口（Store trait）
├── CandidateMemory.ts  # 候选人记忆管理
├── DemandMemory.ts     # 招聘需求记忆
└── AutoMemory.ts      # 自动记忆（发现模式后自动记录）
```

## MemoryStore 接口设计

参考 Claude Code 的 trait 模式（`ApiClient` + `ToolExecutor` trait），`MemoryStore` 也是个 trait/interface：

```typescript
interface IMemoryStore {
  save(entry: MemoryEntry): Promise<void>
  query(filter: MemoryQueryFilter): Promise<MemoryEntry[]>
  get(id: string): Promise<MemoryEntry | null>
  delete(id: string): Promise<void>
}
```

实现类：
- **InMemoryStore** — 纯内存存储（测试/开发用）
- **FileStore** — JSON 文件持久化（简单部署）

## CandidateMemory 设计

跨会话记住候选人信息：
- 基本信息（姓名、平台、来源）
- 评估历史（每次触达的评估快照）
- 交互历史（对话摘要、关键决策）
- 标签和备注

```typescript
class CandidateMemory {
  async remember(candidate: Candidate, context: RememberContext): Promise<CandidateMemoryEntry>
  async recall(candidateId: string): Promise<CandidateMemoryEntry | null>
  async recordOutreach(candidateId, record, evaluation): Promise<void>
  async generateSummary(candidateId): Promise<string>
}
```

## DemandMemory 设计

记住招聘需求（职位要求、公司偏好）：
- 职位详情（技能要求、薪资范围）
- 公司偏好（哪些公司偏好/回避）
- 沟通风格（professional/casual/warm）
- 拒绝理由记录（了解市场反馈）

```typescript
class DemandMemory {
  async memorize(job: JobConfig): Promise<DemandMemoryEntry>
  async recallDemand(jobId: string): Promise<DemandMemoryEntry | null>
  async addRejectionReason(candidateId, candidateName, jobId, reason): Promise<void>
  async getMarketInsights(jobId): Promise<string[]>
}
```

## AutoMemory 设计

参考 Claude Code 的 `compact.rs` 结构化压缩摘要：

```typescript
class AutoMemory {
  // 自动发现模式并记录
  async discover(candidates, interactions): Promise<MemoryPattern[]>
  
  // 生成结构化摘要（而不是简单截断）
  async compact(): Promise<MemorySummary>
  
  // 从历史中推断待办（类似 infer_pending_work）
  inferPendingWork(): PendingWorkItem[]
}
```

### 发现的模式类型

- `skill_trend` — 技能趋势（市场上什么技能最常见）
- `outreach_timing` — 触达时机（什么时间更易回复）
- `candidate_quality` — 候选人质量分布
- `platform_efficiency` — 平台效率对比
- `rejection_pattern` — 拒绝模式
- `salary_expectation` — 薪资预期模式

## 与 Claude Code 的关键借鉴点

1. **结构化摘要而非截断** — Claude Code 的 `compact.rs` 不是简单截断消息，而是提取：消息统计、工具调用列表、待办推断、关键文件引用
2. **关键词推断待办** — `infer_pending_work()` 用关键词（todo/next/pending）推断未完成工作
3. **Ordinal 权限模式** — 记忆访问也有权限层级（只读 vs 读写）

## 使用示例

```typescript
import { InMemoryStore, CandidateMemory, DemandMemory, AutoMemory } from '@hireclaw/core/memory';

// 创建存储
const store = new InMemoryStore();

// 候选人记忆
const candidateMemory = new CandidateMemory({ store });
await candidateMemory.remember(candidate, { type: 'discovered', platform: 'boss' });

// 需求记忆
const demandMemory = new DemandMemory({ store });
await demandMemory.memorize(jobConfig);

// 自动记忆
const autoMemory = new AutoMemory({ store });
const patterns = await autoMemory.discover(candidates, interactions);
const summary = await autoMemory.compact();
```
