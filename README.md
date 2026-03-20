# 🦞 HireClaw SDK

**自主招聘智能体框架** — 平台无关的招聘 AI "大脑"。

## 架构

```
hireclaw/
├── packages/
│   ├── core/              # @hireclaw/core — 招聘智能体引擎
│   │   ├── evaluator/     # 候选人评估引擎
│   │   ├── outreach/      # 触达策略引擎
│   │   ├── memory/        # 跨会话记忆系统
│   │   ├── pipeline/      # 招聘流水线编排
│   │   └── knowledge/     # 招聘知识库（可扩展）
│   │
│   ├── boss-adapter/      # @hireclaw/boss-adapter — BOSS直聘适配器
│   ├── maimai-adapter/    # @hireclaw/maimai-adapter — 脉脉适配器
│   └── cli/               # @hireclaw/cli — 命令行入口
│
├── src/                   # [legacy] 原始单体代码（逐步迁移）
└── workspace/             # [legacy] 原始工作区（逐步迁移）
```

## 快速开始

```bash
pnpm install
pnpm build
```

## 设计原则

- **"大脑"与"手脚"分离** — SDK 提供招聘智能，Adapter 提供平台接入
- **知识不硬编码** — 评估维度、话术策略、风控规则全部可配置
- **不绑定特定 LLM** — Claude / DeepSeek / OpenAI / 任意兼容 API
- **不绑定特定平台** — 实现一个 interface 即可接入新平台

## 开发路线

| Sprint | 状态 | 内容 |
|--------|------|------|
| 0 | ✅ 完成 | Monorepo 搭建，类型定义 |
| 1 | 🔲 待开始 | @hireclaw/core/evaluator — 评估引擎 |
| 2 | 🔲 | @hireclaw/core/outreach — 触达策略引擎 |
| 3 | 🔲 | @hireclaw/core/pipeline — 流水线编排 |
| 4 | 🔲 | @hireclaw/boss-adapter — BOSS直适配器 |
| 5 | 🔲 | @hireclaw/core/memory — 记忆系统 |
| 6 | 🔲 | 文档 + npm 发布 + 使用示例 |
