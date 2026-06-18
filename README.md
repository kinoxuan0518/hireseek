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

## 做的和验的分开——双轴独立验证器（反 Goodhart）

HireSeek 是一个招聘领域的 loop，它的目标曾经只有一句话：「今日触达 ≥ 30 就达标」。这是教科书级的 Goodhart 地雷——一旦"触达数"变成目标本身，一个一根筋优化它的 agent 可以为了凑满 30 去触达一批根本不匹配的人，数字是绿的，但你真正要的"对的人"一个没有。更糟的是，做触达的 agent 同时也是给自己记成功的那个（"学生自己批自己的考卷"），它一定对自己太宽容。

所以加了一双独立的、对抗性的眼睛——而且分两条轴：

```bash
hireseek verify            # 双轴质检：人选质量(反凑数) + 流程合规(用没用筛选项/乱开网页)
hireseek verify --push     # 顺手把结论推给你
```

**① 结果轴——人选质量（`src/verifier.ts`）**：找的人对不对。
- **换一个更强、且可异构的脑子**：执行用 `v4-flash`，质检用独立配置的验证器模型（默认 `v4-pro`，可经 `VERIFIER_MODEL`/`VERIFIER_BASE_URL`/`VERIFIER_API_KEY` 指向**异构厂商**，让验证器与执行器失败模式去相关——这才是真正"换了个脑子"而非只换档）
- **不被自评锚定**：只拿岗位画像 + 候选人事实，先独立重判，再回头跟 do-er 的自评分对比，专抓"自评虚高"；按姓名对齐结论，避免 A 的理由记到 B 头上
- **代码层叠 Goodhart 启发式**：凑满目标却低匹配集中、自评显著虚高 → 判"疑似注水"
- **诚实而非假绿灯**：今天 task_runs 记录触达了人、候选人库却查不到 → 报"落库断链"异常，而不是静默放行

**② 过程轴——流程合规（`src/compliance.ts`）**：它干活的方法对不对。
- 每轮 sourcing 的浏览器动作落库成可审计的**执行轨迹**（`run_actions`）；验证器对照"过程规则集"（默认规则 + 可选 `workspace/references/process-rules.md` 覆盖）逐条审计
- 抓的是硬门卡不住的**软规则**：没先用筛选项就瞎翻、筛选条件跟岗位硬性要求对不上、跳去无关网页、连续高频打招呼、触达前没真正看过人
- 每条违规必须引用"第几步做了什么"作为证据；解析失败/被截断 → 判 skip 不下结论（绝不把"读不懂模型回答"当成"无违规"）

两轴都在每轮自主寻源（心跳 `run_channel`）跑完后**自动触发**，不通过/有隐患就主动报给你；生命体征里触达数旁边永远跟着质检与合规两行结论——数字好看 ≠ 做得对。

> 已知边界：执行轨迹目前记录动作类型 + ref/url，尚未回填 ref 的语义标签（如"工作经验筛选下拉"），合规验证器据动作序列与模式判断；结果轴抽样为随机抽样（默认 8 人），样本小时结论看方向。两者均为后续可加强项。

这一层不改寻源 agent 任何判断，只在旁边挑刺。它是 Loop Engineering 的"灵魂"在 HireSeek 里的落地：Harness（守护栏，约束"不能怎么做"）+ 双轴独立验证器（既盯"找的人对不对"，也盯"干活的方法对不对"）。

## 把目标锚在"面试通过"——信号回流 + 校准闭环

HireSeek 只管 sourcing 一环，够不到入职、更够不到价值，所以目标不能定在它控制不了的下游结果上。锚点定在**最靠下游、但仍能归因到 sourcing 的节点：面试通过**（`src/feedback.ts`）。

```bash
hireseek feedback 张三 pass 一面表现好   # 回流面试结果（最重要的反馈信号）
hireseek goal                            # 结果计分板：过面数/过面率 + 判断校准
```

- **结果目标是"找到能过面的人"**——这没法靠凑触达数刷出来，反 Goodhart
- **你一句话就是 ground truth 回流**：不需要 ATS，飞书 Bot / 指挥台 / CLI 都是回流通道
- 有了真实结果，验证器的预测分（`fit_predictions`）与真实过面结果（`interview_outcomes`）一对照，就能算出：**它判"合适"的人实际过面率多少，判"不合适"的又多少**——它的判断在不在变准，一目了然，而不是又一句好听的话
- 预测与结果均按 `(fingerprint, job_id)` 复合键对齐，跨岗位不串；同名多人回流会明确提示挂到了哪一位

### 让结果自动回流——飞书招聘 / 多维表格直连（`src/channels/feishu-hire.ts`）

手动一句句回流是兜底；如果你们的面试结果记在飞书里，HireSeek 可以**直接把它拉回来**，并顺带补上"面试官维度"。

```bash
hireseek hire-sync            # dry-run 预览：会写哪些过面/挂面（不落库）
hireseek hire-sync --apply    # 确认无误后落库回流 → 喂校准
```

- **两个来源**（和飞书 Bot 同一个 SDK，零新依赖）：
  - **飞书招聘 ATS**：`client.hire.interview.list` 拉面试 + 每位面试官的结论，`hire.talent` 把人对回本地候选人——结论自带面试官身份（恰好补掉"无面试官维度"的边界）。需给自建应用开 `hire:interview:readonly`、`hire:talent:readonly` 后发布。
  - **飞书多维表格**：复用 `fetchRecruitingRecords` 读招聘表的"面试结果"列，零新权限。列名/取值可经 `FEISHU_BITABLE_NAME_FIELD`/`FEISHU_BITABLE_RESULT_FIELD`/`*_PASS_VALUES`/`*_FAIL_VALUES` 适配你们的表。
- **安全铁律（外部数据不可控）**：默认 **dry-run 先列给你看会写什么**，结论 enum / 列取值都可配，确认无误才 `--apply`；权限缺失会直接告诉你缺哪个 scope（连授权链接都返回）。
- **自动化**：`SCHEDULE_HIRESYNC`（默认工作日 20:00）每天自动同步——默认 dry-run + 通知，`FEISHU_HIRE_AUTO_APPLY=true` 才自动落库；Bot/指挥台也能说"同步一下飞书面试结果"触发。

### 把目标变成方向盘——心跳由"合格供给"驱动，不再由触达 quota 驱动

这是最后一环：计分板（看）变方向盘（开）。心跳决策（`heartbeat.ts`）的首要信号不再是"今日触达 X/30"，而是 `feedback.ts` 的 `supplyBoard`——**离过面目标还差多少合格供给**（合格 = 验证器判 fit≥60 的人，而非 do-er 自评、更非触达数）。决策原则按优先级重写：

1. **判断失效优先校准**：校准显示"判合适/判不合适"没区分度（lift≤0）→ 最该做的是搞清过面者共性、重校"合适"的定义，**而不是找更多**（判断都错了，提高产量只会更快地错）
2. **合格供给不足才寻源**：今日合格供给没到 `daily_goal.quality` → 寻源（验证器挡注水，所以任务是"找够合格的人"）
3. **池子见底就降级**：刷了很多触达却凑不出合格供给 → notify_user 让用户放宽画像/加渠道，**宁缺毋滥，不硬刷**
4. 管线断流补跟进；别重复；越权不做

守护栏也跟着换：从"触达 ≥30 就停"改成"**合格供给 ≥ quality 就停**"，外加一道安全上限（触达远超目标却凑不出合格 → 判池子见底、拦截硬刷）。实测心跳 dry-run 已用"合格供给严重不足（目标5/实际0达标）"的语言决策，而不是数触达。

### 让"合适"的定义自己长——学习闭环

校准告诉你"判断准不准"；学习闭环更进一层：**把真实过面结果回喂，自动重写"合适"的定义本身**（`references/candidate-evaluation.md`）。

```bash
hireseek learn dry     # 预览：用真实过面结果反推 rubric 哪里欠校准（不落盘）
hireseek learn         # 落盘改写 + git 提交（可 hireseek evo back 回滚）
```

`src/evolution/recalibrate.ts` 拉取"既被验证器预测过、又有真实面试结果"的候选人，**重点盯误判**——判合适却挂面（假阳性：定义把不该要的当合适了）、判不合适却过面（假阴性：定义漏了真能过的人）——交给 v4-pro 反推：过面者共性是什么、挂面者共性是什么、现行 rubric 哪里权重失衡，产出修订版 rubric。

实测（合成误判数据）：4 个大厂背景判合适却全挂面、3 个 Agent 方向小厂/独立开发判不合适却全过面 → 它准确诊断出"原 rubric 严重高估大厂光环、忽略垂直领域深度实践"，甚至把明星 AI 创业（过面）与大厂（挂面）区分开，产出把"实际做的事与岗位匹配度"提为首要维度的新 rubric。

安全机制（与既有进化系统一致，且经一轮对抗性自评审加固）：
- **铁律：无数据不改写**，且加了三道统计门槛，任一不过都只诊断不改、连模型都不调：
  - **样本量**：既预测又有结果的人 < 8 → 拒
  - **误判量**：假阳+假阴 < 3 → 拒（验证器没判错就没可学的"错"，不无错强改）
  - **时间跨度**：样本跨度 < 3 天 → 拒（太集中可能只是某阵子/某面试官口味，不足以提炼普适规律）
- **反"自证"**：刻意警惕治疗效应——判合适的人本就拿到更走心的触达、更可能过面，所以**总体过面率不作为改写依据**，只从几乎不受推进力度干扰的**误判**里学；重校官模型可经 `RECALIBRATOR_*` 配成**异构于验证器**，避免"同一个脑子分析自己的预测、再改自己依据的标准"
- **每次改写独立 git commit、可回滚**（`hireseek evo back`）
- **自主路径只 dry-run + 通知**：心跳发现"判断失效"（校准 lift≤0 且样本够）时，`evolve_dry` 会自动转去跑 `learn`（dry）并把提案推给你，落盘永远需要你确认；rubric 重写工具刻意**不进**后台 sub-agent 白名单

至此整条路是闭的：寻源 → 验证器判合适 → 触达 → 真实过面结果回流 → 校准（判断准不准）→ **学习（"合适"的定义自己改）** → 下一轮判得更准。**人是终极验证器，但它在不断把你的判断学进自己的标准里。**

## 它在不在线？在做什么？——让你有安全感

守护进程是隐形的后台进程。它不该让你惦记、要你去查岗——它会**主动报平安**，你也能**随时一句话查岗**。

**随时查岗**（拉取式）：

```bash
hireseek alive            # 一句话：它在不在、今天做了什么、下一步
hireseek alive --push     # 顺手推一条到你的飞书/系统通知
```

```
✅ 在线守护中 · 已守护 3 小时 12 分钟（最后报平安：刚刚）
📋 在岗：Agent 工程师
📊 今天触达 18/30 人
🔧 最近动作：跑 BOSS 寻源 — 触达 18 人
⏭ 下一步：跟进未回复 · 工作日 14:00（约 14:00）
```

守护进程每分钟写一次"我还活着"的时间戳，所以哪怕你从另一个窗口查，也能看到"它 30 秒前还活着"——这才是"在线"的实感，而不是一句空泛的"已安装"。状态分三档：`✅ 在线守护中` / `🟡 我在但未常驻`（只开了指挥台）/ `⏸ 未在守护`。

**主动报平安**（推送式，自动到达你的飞书/系统通知）：上线了、今日收工、上班签到、每完成一件重要的事——它都会主动告诉你一声。

## 它"住在哪里"——三种看得见的脸

让它对你"可见、可指挥"的有三处脸面，按门槛从低到高：

1. **网页指挥台**（零配置）：浏览器打开 `localhost:7799`，左边状态卡（在线状态 / 今天触达 / 招聘漏斗 / 心跳最近在想什么 / 下一步），右边聊天框直接打字指挥它，过程里实时显示"它正在做什么"。手机连同一 WiFi 也能访问本机 IP。
2. **飞书双向 Bot**（配飞书应用）：把它加进飞书通讯录，手机上发一句"今天进展怎么样"就能指挥，它跑完主动回你。设 `FEISHU_BOT_ENABLED=true`。
3. **macOS 通知 / 飞书群机器人**：它主动报平安和提醒时弹给你（只需 `FEISHU_WEBHOOK_URL`，比双向 Bot 门槛低）。

网页指挥台与飞书 Bot 共用同一套 agent 大脑（`src/agent-session.ts`），生命体征是单一事实来源（`src/vitals.ts`），终端 chat 也同源——多个入口、一个 HireSeek。

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
| `AGENT_KNOWLEDGE_HOME` | — | 独立 canonical 知识/契约 sandbox 路径；不填则用内置兜底契约 |
| `HIRESEEK_BROWSER_CONTROL` | `chrome` | 默认接管真实 Chrome；设为 `hireseek` 才使用自有浏览器 |
| `HIRESEEK_BROWSER_PROFILE_DIR` | `~/.hireseek/browser-profile` | 自有浏览器模式下的资料夹 |
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
