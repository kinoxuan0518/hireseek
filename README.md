# 🔱 HireSeek（深聘）

**DeepSeek 驱动的自主招聘智能体** — 接管你的全部招聘任务与招聘技能。

> 前身为 HireClaw 🦞。究极进化后改名 HireSeek：Hire 是使命，Seek 既是猎寻人才的本能，也致敬默认大脑 DeepSeek。

## 它能做什么

- **全渠道自主寻源**：BOSS直聘、脉脉、LinkedIn，自动搜索、筛选、打招呼、跟进
- **接管你的 Claude 技能库**：自动扫描 `~/.claude/skills` 与插件目录，rbt、maimai-recruiter、talent-sourcing、candidate-intelligence、blacklake-targeted-talent-hunting、bosszhibin-auto-recruiter 等招聘技能全部可被 DeepSeek 调用
- **对话即工作**：chat 模式下自然语言下达任务，agent 自动路由到对应技能或渠道
- **候选人评估 / 触达策略 / 跨会话记忆 / 招聘漏斗**：core SDK 内置
- **定时调度**：工作日自动执行 BOSS / 脉脉 / 跟进任务

## 三大进化点（v2 "HireSeek"）

### 1. DeepSeek 一等公民（默认大脑）

```bash
export DEEPSEEK_API_KEY="sk-..."   # 唯一必需配置
```

- 默认 provider 为 `deepseek`，默认模型 `deepseek-v4-flash`，复杂推理可切 `deepseek-v4-pro`（旧名 deepseek-chat/reasoner 将于 2026-07-24 弃用）
- 仍兼容 Claude / OpenAI / MiniMax / 任意 OpenAI 兼容 API（`LLM_PROVIDER` 切换）

### 2. 纯文本 DOM Runner（无视觉浏览器驱动）

DeepSeek 没有视觉能力，传统截图方案走不通。HireSeek 的解法：

```
页面 → 可交互元素打 ref 标记 → 文本快照（元素清单+正文）→ DeepSeek
DeepSeek → browser(click, ref=42) → Playwright 精确定位执行 → 新快照
```

相比视觉方案：**token 更省、定位零坐标偏差、任何文本模型都能开车**。

### 3. Claude Skills 桥接层

```
~/.claude/skills/*/SKILL.md  ──┐
~/.claude/plugins/.../skills ──┴→ 技能注册表 → DeepSeek 智能路由
```

- chat 中直接 `/rbt`、`/maimai-recruiter` 触发
- 或自然语言："帮我处理一下BOSS的消息" → agent 自动匹配技能并执行
- 技能的 references/ scripts/ 路径自动解析

## 三大究极进化（v3 "常驻 · 在线 · 有记性"）

v2 让 HireSeek 能干活，v3 让它**住下来、在线、记得住人**——不开终端也活着。

### 1. 飞书双向 Bot（对话即指挥）

```
飞书里发一句话 → 长连接推事件 → 复用 chat 全套工具跑无头 agent → 回复发回飞书
```

- 用**长连接（WebSocket）事件订阅**，无需公网回调、无需内网穿透，本机直连即可
- 手机飞书上一句"今天 BOSS 进展怎么样""把做供应链的人列出来""派个后台任务调研张三"，HireSeek 就在守护进程里执行并回话
- 每个会话独立上下文，支持用户白名单、群聊 @ 响应、`清空` 重置
- 心跳/调度/后台任务的主动通知优先经此 Bot 推送（可在飞书里直接追问跟进）
- 开启：自建应用订阅 `im.message.receive_v1`（长连接模式）+ 授 `im:message`/`im:message:send_as_bot`，设 `FEISHU_BOT_ENABLED=true`

### 2. 常驻守护进程（launchd 托管）

```bash
hireseek daemon install    # 装成开机自启服务，崩溃自拉起
hireseek daemon status     # 看运行状态 + 最近日志
hireseek daemon run        # 前台跑（调度 + 飞书 Bot 一个进程）
hireseek daemon uninstall  # 卸载
```

一个进程整合**定时调度 + 心跳主动循环 + 飞书 Bot**，用 macOS launchd 托管：随登录自启、崩溃自拉起、日志落 `~/.hireseek/daemon.log`。HireSeek 从"开终端才活着"变成"一直在"。

### 3. 人才记忆库（FTS5 全文检索）

```
每次沟通沉淀笔记 → 字符级分词索引 → "之前聊过的做供应链的人" 秒级召回
```

- 新工具 `log_candidate_note`：把对候选人的沟通要点、印象、跟进结论沉淀进库
- 新工具 `search_candidates`：用**自然语言/关键词**在全部候选人（姓名/公司/学校/笔记）里找人
- SQLite **FTS5** 索引 + **CJK 字符级 unigram 分词**，中文子串也能命中（不止前缀）；FTS5 不可用时自动降级 LIKE
- 接触过的人不再是死数据，而是越用越厚的**人脉资产**；心跳信号也接入人才库规模

## 快速开始

```bash
pnpm install && pnpm build

export DEEPSEEK_API_KEY="sk-..."

# 对话模式（终端入口）
npx tsx src/index.ts chat

# 网页指挥台（推荐：打开浏览器就能看见它、打字指挥它）
npx tsx src/index.ts console        # → http://localhost:7799

# 直接执行渠道 sourcing
npx tsx src/index.ts run boss

# 常驻守护进程：装一次，它就一直活着（调度 + 网页指挥台 + 飞书 Bot）
npx tsx src/index.ts daemon install   # 开机自启、崩溃自拉起；装完自动打开指挥台
npx tsx src/index.ts daemon status    # 看它是否在跑
```

## 它"住在哪里"——三种看得见的形态

守护进程本身是隐形的后台进程。让它对你"可见、可指挥"的有三处脸面，按门槛从低到高：

1. **网页指挥台**（零配置）：浏览器打开 `localhost:7799`，左边状态卡（今天触达多少 / 招聘漏斗 / 心跳最近在想什么），右边聊天框直接打字指挥它，过程里实时显示"它正在做什么"。手机连同一 WiFi 也能访问本机 IP。
2. **飞书双向 Bot**（配飞书应用）：把它加进飞书通讯录，手机上发一句"今天进展怎么样"就能指挥，它跑完主动回你。设 `FEISHU_BOT_ENABLED=true`。
3. **macOS 通知**：它主动找你时弹一下（跟进提醒、任务完成）。

网页指挥台与飞书 Bot 共用同一套 agent 大脑（`src/agent-session.ts`），终端 chat 也是同源——三个入口、一个 HireSeek。

## 架构

```
hireseek/
├── packages/
│   ├── core/              # @hireseek/core — 招聘智能体引擎
│   │   ├── evaluator/     # 候选人评估引擎
│   │   ├── outreach/      # 触达策略引擎
│   │   ├── memory/        # 跨会话记忆系统
│   │   ├── pipeline/      # 招聘流水线编排
│   │   └── llm/           # 多模型抽象（deepseek/claude/openai/custom）
│   │
│   ├── boss-adapter/      # @hireseek/boss-adapter — BOSS直聘适配器
│   ├── maimai-adapter/    # @hireseek/maimai-adapter — 脉脉适配器
│   └── cli/               # @hireseek/cli — 命令行入口
│
├── src/                   # agent 运行时（chat / orchestrator / scheduler）
│   ├── runners/
│   │   ├── dom-runner.ts  # ★ 纯文本 DOM 浏览器驱动（DeepSeek 默认）
│   │   ├── claude.ts      # Claude 原生 computer-use
│   │   └── generic-vision.ts # 视觉模型通用驱动（MiniMax/Qwen-VL等）
│   └── skills/
│       └── claude-skills.ts  # ★ Claude Skills 桥接层
└── workspace/             # 职位配置、渠道技能、记忆
```

## 配置参考

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key（默认大脑，必填） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `LLM_MODEL` | `deepseek-v4-flash` | 模型名 |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | 评估/策略等深推理场景 |
| `LLM_PROVIDER` | `deepseek` | 可选 deepseek / claude / openai / minimax / custom |
| `HIRESEEK_DB_PATH` | `~/.hireseek/hireseek.db` | 数据库路径（自动兼容旧 ~/.hireclaw） |
| `FEISHU_WEBHOOK_URL` | — | 飞书执行报告推送 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | — | 飞书自建应用（多维表格读取 + 双向 Bot） |
| `FEISHU_BITABLE_APP_TOKEN` / `FEISHU_BITABLE_TABLE_ID` | — | 招聘结果多维表格 |
| `FEISHU_BOT_ENABLED` | `false` | 设 `true` 开启飞书双向 Bot（长连接，对话即指挥） |
| `FEISHU_BOT_ALLOW_USERS` | — | 限定可使用 Bot 的用户 open_id（逗号分隔，留空=不限） |
| `FEISHU_BOT_NOTIFY_CHAT_ID` | — | 心跳/调度/后台任务通知主动推送到的 chat_id |
| `SCHEDULE_BOSS` 等 | 工作日 9/10/14 点 | cron 调度表达式 |

## 代码层风控（不依赖模型自觉）

DOM Runner 内置三条硬约束，即使模型忘了 prompt 里的协议也会被强制执行：

1. **打招呼节流**：识别"打招呼/立即沟通"类按钮，点击间隔强制 ≥5 秒
2. **每日上限硬终止**：快照中检测到"今日沟通已达上限/需付费"立即锁死所有操作，只允许输出总结
3. **频率告警软退避**：检测到"开聊太频繁"自动等待 10-30 秒再继续

## 进化闭环（自动复盘 + 技能自改写）

```bash
hireseek evo        # 复盘并自动改写话术/筛选规则（git 留版本）
hireseek evo dry    # 只出复盘报告，不落盘
hireseek evo back   # 回滚最近一次进化
hireseek evo log    # 进化历史 + 前后推进率对比
```

数据流：飞书多维表格（真实招聘结果）+ 本地漏斗 → deepseek-v4-pro 深推理诊断 →
自动改写 `outreach-guide.md` / `candidate-evaluation.md`（每次进化独立 git commit，可回滚）。

四条铁律：每条诊断必须有数据支撑；数据不足就不改；演进不重写；不碰风控规则。
调度器每周五 18:00 自动跑一轮（`SCHEDULE_EVOLVE` 可调），报告推飞书。
chat 里说"复盘一下"、"为什么回复率低"也会触发。

## 角色分层

- **HireSeek 是总控 Agent**：承载上下文、理解招聘任务、与用户共创画像，决定调用什么能力
- **Claude Skills 是能力库**：寻源策略、竞调、定向挖猎、渠道操作手册，全部即插即用
- **Adapter / DOM Runner 是手脚**：在具体渠道执行搜索、筛选、触达与跟进

## 设计原则

- **"大脑"与"手脚"分离** — SDK 提供招聘智能，Adapter 提供平台接入
- **知识不硬编码** — 评估维度、话术策略、风控规则全部可配置
- **不绑定特定 LLM** — DeepSeek 默认，Claude / OpenAI / 任意兼容 API 可切换
- **不绑定特定平台** — 实现一个 interface 即可接入新平台
