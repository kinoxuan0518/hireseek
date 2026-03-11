# 🦞 HireClaw

**给招聘人用的自主 AI Agent——会 sourcing、会对话、会学习。**

HireClaw 不是一个脚本，是一个有招聘经验的伙伴。它能自主操作 BOSS直聘、脉脉等平台，和你对话讨论候选人，并在每次对话后记住发生了什么。

---

## 快速开始

```bash
# 1. 安装依赖
npm install
npx playwright install chromium

# 2. 初始化（一步步引导配置 API key、职位、渠道）
npm link
hireclaw setup

# 3. 开始用
hireclaw
```

---

## 全部命令

| 命令 | 做什么 |
|------|--------|
| `hireclaw` | 对话模式（默认）——聊候选人、改策略、触发任务 |
| `hireclaw setup` | 初始化向导，3 分钟配好一切 |
| `hireclaw dashboard` | 启动本地控制台（实时截图 + 日志 + 任务控制 + 介入指令） |
| `hireclaw run` | 自主 sourcing，按职位配置决定渠道 |
| `hireclaw run boss` | 只跑 BOSS直聘 |
| `hireclaw scan` | 扫描收件箱，更新已回复候选人 |
| `hireclaw update 张三 replied` | 手动更新候选人状态 |
| `hireclaw funnel` | 查看招聘漏斗数据 |
| `hireclaw start` | 启动定时守护进程（自动 sourcing + 主动提醒） |

---

## 支持的 LLM

| Provider | 配置方式 |
|----------|---------|
| Anthropic Claude | `LLM_PROVIDER=claude` + `ANTHROPIC_API_KEY` |
| DeepSeek | `LLM_PROVIDER=custom` + `CUSTOM_BASE_URL=https://api.deepseek.com/v1` |
| OpenRouter | `LLM_PROVIDER=custom` + `CUSTOM_BASE_URL=https://openrouter.ai/api/v1` |
| 任意 OpenAI 兼容 API | `LLM_PROVIDER=custom` + `CUSTOM_BASE_URL` |

推荐 Claude Sonnet 或 DeepSeek-V3，两者招聘判断质量最好。

---

## 核心能力

- **自主 Sourcing**：用 Playwright 控制浏览器，截图 → LLM 决策 → 执行动作，循环直到完成
- **多账号并行**：支持多个账号同时执行，独立登录状态管理，2 个账号 = 2 倍速度
- **实时控制台**：Web dashboard 看实时截图、LLM 推理日志，跑着跑着能发介入指令调整策略
- **对话模式**：直接和 HireClaw 聊，12 种工具（触发任务、查候选人、搜背景、改策略、分析图片、执行 shell）
- **跨会话记忆**：结构化摘要 + 最后几轮原文，下次启动重新注入——它认识你
- **主动提醒**：候选人 7 天没回、今天没跑 sourcing、漏斗快空了 → macOS 系统通知
- **自我进化**：能读写自己的源代码（`src/`），TypeScript 校验，写错自动回滚
- **招聘知识内置**：候选人评估框架、触达策略、话术指南，基于真实招聘经验
- **网络搜索 + 图片分析**：搜公司动态、分析简历截图（需 vision 模型）
- **结果追踪**：候选人状态管理、回复率统计、漏斗视图

---

## 项目结构

```
hireclaw/
├── bin/
│   └── hireclaw          # 全局命令入口
├── src/
│   ├── index.ts          # CLI 路由
│   ├── chat.ts           # 对话模式 + 12种工具（含图片分析、shell执行、代码修改）
│   ├── dashboard.ts      # 本地控制台（实时截图 + 日志流 + 介入）
│   ├── orchestrator.ts   # 渠道协调器
│   ├── memory.ts         # 记忆注入（历史对话 + DB 数据）
│   ├── search.ts         # 网络搜索模块
│   ├── setup.ts          # 初始化向导
│   ├── notifier.ts       # 主动通知（macOS 系统通知 + 飞书）
│   ├── events.ts         # 全局事件总线（runner → dashboard 通信）
│   ├── db.ts             # SQLite 数据库
│   ├── config.ts         # 环境配置
│   ├── scheduler.ts      # 定时守护进程 + 主动检查
│   ├── browser-runner.ts # Playwright 控制
│   ├── runners/          # LLM provider 实现
│   └── skills/
│       └── loader.ts     # Skill 文件加载器
└── workspace/
    ├── SOUL.md           # Agent 灵魂与招聘哲学
    ├── PLAYBOOK.md       # 每日工作流手册
    ├── jobs/
    │   └── active.yaml   # 当前招聘职位配置
    ├── skills/           # 各渠道执行脚本
    │   ├── boss.md
    │   ├── maimai.md
    │   ├── linkedin.md
    │   └── followup.md
    └── references/       # 招聘知识库
        ├── candidate-evaluation.md
        ├── outreach-guide.md
        └── founders-wisdom.md
```

---

## 多账号并行配置

HireClaw 支持同时使用多个账号并行执行 sourcing 任务，极大提升效率。

### 配置方式

在 `workspace/jobs/active.yaml` 中设置每个渠道的账号数量：

```yaml
channels:
  boss:
    enabled: true
    accounts: 2      # 使用 2 个 BOSS 账号并行
  maimai:
    enabled: true
    accounts: 1      # 使用 1 个脉脉账号
  linkedin:
    enabled: false
    accounts: 0
```

### 首次登录引导

首次运行 `hireclaw run` 时，系统会依次引导你登录每个账号：

```
🔐 检测到 2 个账号需要登录，开始引导...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
正在配置账号：BOSS直聘[1] (boss_1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ 请在浏览器中完成 BOSS直聘[1] 的登录
   登录完成后，按 Enter 继续...
```

### 登录状态管理

- **自动保存**：登录成功后，系统自动保存登录状态到 `workspace/accounts/`
- **持久化**：后续运行自动加载已保存的登录状态，无需重复登录
- **独立隔离**：每个账号使用独立的 BrowserContext，Cookie 互不干扰
- **重新登录**：如果登录过期，删除对应的 `.json` 文件即可重新引导登录

```bash
# 示例：重新登录 BOSS 第 1 个账号
rm workspace/accounts/boss_1.json
```

### 并行执行效果

- **1 个账号**：顺序执行，约 10 分钟完成 30 人触达
- **2 个账号**：并行执行，约 5 分钟完成 30 人触达（速度翻倍）
- **3 个账号**：并行执行，约 3-4 分钟完成 30 人触达

---

## 候选人状态

| 状态 | 含义 |
|------|------|
| `contacted` | 已触达 |
| `replied` | 已回复 |
| `interviewed` | 已面试 |
| `offered` | 已发 Offer |
| `joined` | 已入职 |
| `rejected` | 已淘汰 |
| `dropped` | 放弃跟进 |

---

## 环境变量

```env
# LLM 配置
LLM_PROVIDER=claude          # claude | custom
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...

# 自定义 OpenAI 兼容 provider
CUSTOM_API_KEY=
CUSTOM_BASE_URL=

# 网络搜索（可选）
SEARCH_PROVIDER=tavily       # tavily | brave | duckduckgo
SEARCH_API_KEY=

# 浏览器
BROWSER_HEADLESS=false

# 定时任务（cron 表达式）
SCHEDULE_BOSS=0 9 * * 1-5
SCHEDULE_MAIMAI=0 10 * * 1-5
SCHEDULE_FOLLOWUP=0 14 * * 1-5
```

---

## 要求

- Node.js 22+
- macOS / Linux
- 至少一个 LLM API Key
- 目标招聘平台已登录账号

---

## License

MIT
