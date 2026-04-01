# @hireclaw/core/pipeline — 流水线编排

> 参考 Claude Code 的 Agentic Loop（收集上下文 → 采取行动 → 验证结果）设计

## 设计理念

Claude Code 的 Agentic Loop 模式：

```
while (task = get_pending_task()):
    context = collect_context(task)
    action = decide_action(context)
    result = execute(action)
    if (!verify(result)):
        rollback()
```

hireclaw 的招聘流水线对应：

```
Pipeline:
  discover → evaluate → filter → plan → outreach → followup → complete
```

## 核心模块

```
pipeline/
├── index.ts              # 流水线主引擎（已有）
├── stages/
│   └── Stage.ts         # 阶段定义 + 钩子系统
└── human/
    └── HumanInLoop.ts   # 人工介入机制（Ordinal 权限模式）
```

## Stage（阶段）

定义流水线各阶段的行为和产出：

| 阶段 | 说明 | 关键配置 |
|------|------|----------|
| discover | 从平台拉取候选人 | platforms[], limit |
| evaluate | 多维度评估打分 | threshold, weights |
| filter | 人工/规则过滤 | mode, humanThreshold |
| plan | 制定触达计划 | templates, timing |
| outreach | 执行触达 | dryRun, dailyLimit |
| followup | 跟进验证 | maxFollowups, waitDays |

### 阶段钩子（StageHooks）

```typescript
const hooks: PipelineHooks = {
  onStart: async (job) => { /* 流水线开始 */ },
  onComplete: async (result) => { /* 流水线结束 */ },
  stages: {
    evaluate: {
      before: (ctx) => { /* 评估前验证 */ },
      after: (ctx, result) => { /* 评估后记录 */ },
      onError: (ctx, err) => { /* 评估失败处理 */ },
    },
  },
};
```

## HumanInLoop（人工介入）

参考 Claude Code 的 Ordinal 权限模式，设计三层机制：

| Ordinal | 级别 | 行为 |
|---------|------|------|
| 0 | 🤖 完全自主 | AI 自己决策执行 |
| 1 | 👤 建议后执行 | AI 推荐，人工确认后执行 |
| 2 | 🚫 完全人工 | 仅通知，不自动执行 |

### 内置触发器

- `high_salary` (Ordinal 1) — 候选人有高薪预期
- `executive` (Ordinal 2) — 高管/VP/总监岗位
- `bulk_action` (Ordinal 1) — 批量触达 5+ 人
- `platform_limit` (Ordinal 1) — 平台限流
- `high_rejection` (Ordinal 1) — 大量拒绝反馈

### 使用示例

```typescript
const hil = new HumanInLoop({ defaultOrdinal: 1 });

// 注册自定义触发器
hil.registerTrigger({
  triggerId: 'sensitive_role',
  type: 'threshold_exceeded',
  ordinal: 2,
  description: '敏感岗位需要 HR 负责人确认',
  condition: (ctx) => ctx.candidate?.profile?.tags?.includes('sensitive'),
});

// 检查是否需要人工介入
const request = hil.checkTriggers(candidate, evaluation, 'outreach');
if (request) {
  // 发送飞书通知给 HR
  await sendFeishuNotification(request);
}

// HR 批准
hil.approve(request.requestId, 'Kino');
```

## 与 Claude Code 的关键借鉴点

1. **Agentic Loop** — 收集上下文 → 采取行动 → 验证结果 → 回滚（如需要）
2. **Ordinal 权限模式** — 三层权限控制，从完全自主到完全人工
3. **Checkpoint/rewind** — 每个阶段记录检查点，支持回滚（未来扩展）
4. **结构化事件** — PipelineEvent 类型完整记录所有阶段转换
