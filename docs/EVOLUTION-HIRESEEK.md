# HireClaw → HireSeek 究极进化记录（2026-06-10）

## 为什么改名

- **HireSeek**：Hire 继承 HireClaw 血统；Seek 一语双关——猎头的本能是 seek talent，默认大脑是 DeepSeek
- 中文名：**深聘**
- GitHub 仓库由 `hireclaw` 改名 `hireseek`，旧链接自动重定向

## 进化点一：DeepSeek 一等公民

| 改动 | 文件 |
|------|------|
| `deepseek` 配置块 + 默认 provider | `src/config.ts` |
| core SDK LLM 抽象层加 deepseek 路由 | `packages/core/src/llm/index.ts`、`packages/core/src/types.ts` |
| chat 模式客户端 DeepSeek 优先 | `src/chat.ts` |
| setup 向导 DeepSeek 设为首选项（原生 provider，不再走 custom） | `src/setup.ts` |
| 入口 API Key 检查加 `DEEPSEEK_API_KEY` | `src/index.ts` |

环境变量：`DEEPSEEK_API_KEY`（必填）、`DEEPSEEK_BASE_URL`（默认 api.deepseek.com）、`LLM_MODEL`（默认 deepseek-v4-flash）、`DEEPSEEK_REASONER_MODEL`（默认 deepseek-v4-pro）。

> 注：deepseek-chat 与 deepseek-reasoner 旧模型名将于北京时间 2026-07-24 23:59 弃用（二者分别对应 deepseek-v4-flash 的非思考/思考模式），HireSeek 已于 2026-06-10 切换为 v4 系列模型名。

## 进化点二：纯文本 DOM Runner

`src/runners/dom-runner.ts` — DeepSeek 没有视觉能力，截图方案不可行。新方案：

1. 给页面所有可见可交互元素打 `data-hs-ref` 编号
2. 回传文本快照：URL + 标题 + 元素清单（`[ref=N] <button> 打招呼`）+ 正文摘要 + 滚动位置
3. 模型用 function calling 输出 `browser(action=click, ref=42)` 等动作
4. Playwright 按 ref 精确定位执行，循环往复
5. 历史快照自动裁剪（保留最近 2 份），控制 token

支持动作：snapshot / click / type / press / scroll / goto / back / wait。

## 进化点三：Claude Skills 桥接层

`src/skills/claude-skills.ts` — 自动接管用户全部招聘技能：

- 扫描 `~/.claude/skills/*/SKILL.md` 与 `~/.claude/plugins/marketplaces/**/skills/`
- 解析 YAML frontmatter 建立注册表（用户技能优先于同名插件技能）
- chat 中三种触发方式：
  1. `/rbt`、`/maimai-recruiter` 斜杠命令（skill-system 自动回退到 Claude 技能）
  2. `use_recruiting_skill` 工具——DeepSeek 根据任务描述自动路由
  3. system prompt 注入技能目录，模型主动匹配触发场景

## 其他修复

- monorepo 迁移时 root `package.json` 丢失了 legacy 运行时全部依赖（openai/playwright/better-sqlite3 等），已从 `package-lock.json` 恢复，并加回 `bin: hireseek`
- 数据库路径向后兼容：新路径 `~/.hireseek/hireseek.db`，但旧 `~/.hireclaw/hireclaw.db` 存在且新库未建时继续沿用，数据不丢
- 旧环境变量 `HIRECLAW_DB_PATH` 仍被识别

---

# HireSeek 第三次究极进化（2026-06-15）—— 常驻 · 在线 · 有记性

v2 让 HireSeek 能干活，v3 解决"它只在我开终端时才活着、关了就忘"的三个根本缺陷：
让它**常驻**、可在飞书里**在线对话指挥**、对接触过的人**有记忆**。

## 进化点一：飞书双向 Bot（对话即指挥）

`src/channels/feishu-bot.ts` — 用 `@larksuiteoapi/node-sdk` 的 `WSClient` 长连接
订阅 `im.message.receive_v1` 事件，无需公网回调地址、无需内网穿透：

```
飞书用户发消息 → 长连接推事件 → 复用 chat.ts 的 CHAT_TOOLS / executeTool
跑无头 agent 循环 → 回复经 IM 接口发回飞书
```

- 每个 chat_id 维护独立对话历史（含压缩），复用 chat 全套工具
- 用户白名单（`FEISHU_BOT_ALLOW_USERS`）、群聊仅 @ 响应、单聊全响应、`清空`/`/help` 快捷指令
- 事件去重（飞书可能重投）、忙时排队提示
- 配套：`src/chat.ts` 导出 `buildSystemPrompt`；`src/permissions.ts` 新增**无头模式**
  （`setHeadless`）——Bot/守护进程里没有 TTY，危险工具默认拒绝（fail-safe）
- `src/notifier.ts`：心跳/调度/后台任务通知优先经 Bot 推送（`pushToBot`），回退 webhook

## 进化点二：常驻守护进程（launchd 托管）

`src/daemon.ts` + `hireseek daemon [run|install|uninstall|status]`：

- 一个进程整合**定时调度器 + 心跳主动循环 + 飞书 Bot**
- `install` 生成 launchd plist（`~/Library/LaunchAgents/com.hireseek.daemon.plist`），
  `RunAtLoad` + `KeepAlive`：随登录自启、崩溃自拉起
- launchd 不读 shell profile，install 时把当前进程的 API key / 飞书配置 / PATH 注入 plist
- 日志落 `~/.hireseek/daemon.log`，`status` 显示安装/运行状态 + 最近日志尾

## 进化点三：人才记忆库（FTS5 全文检索）

`src/db.ts` — 接触过的人不再是死数据，而是越用越厚的人脉资产：

- 新表 `candidate_notes`（候选人沟通要点）+ FTS5 虚拟表 `candidate_fts`
- **CJK 字符级 unigram 分词**（`segmentCJK`）：unicode61 把连续中文当一个 token、
  前缀匹配只能从词首，导致"供应链"匹配不到"做供应链数字化"；给每个 CJK 字符两侧
  加空格变成字符 unigram + 短语匹配，等价子串检索，长短查询都覆盖
- FTS5 不可用时自动降级 LIKE；启动时全量回填（候选人写入路径分散在各适配器）
- note-only 档案（库里还没有的人也能先记笔记）用 `note:姓名` 指纹挂存，LEFT JOIN 仍可检索
- 两个新 chat 工具：`log_candidate_note`（沉淀）、`search_candidates`（自然语言召回），
  同步进 sub-agent 白名单；心跳信号接入人才库规模

## 验证

- `tsc --noEmit` 全过；packages/core 74 单测全过
- FTS 冒烟：供应链 / 宁德时代 / 李四 / 多词 / 子串 全部命中，笔记渲染干净
- `daemon run` 后台启动：调度器全部 cron 注册、Bot 优雅跳过（未启用）、主动检查触发，无崩溃
- `daemon status` 正常输出安装/运行状态

---

# 第四次进化（2026-06-16）：把 Loop Engineering 的"灵魂"装进来

触发：Kino 那篇 Loop Engineering 的思考。骨架（定时/隔离/知识/连接器/子Agent）HireSeek 已有，缺的是"灵魂"——**目标定义 + 做的和验的分开 + 反 Goodhart**。

## 一、网页指挥台 + 生命体征（先解决"看不见它"）

- `src/web-console.ts`（端口 7799）：打开浏览器就能看见它活着、直接打字指挥它（复用 `agent-session` 同一套大脑），随 daemon 自启
- `src/vitals.ts`：守护进程每分钟写 `alive.json`，`hireseek alive` 跨进程查岗——在不在/做了什么/下一步；上线/收工/重动作主动汇报
- `src/agent-session.ts`：抽出飞书 Bot 与网页共用的无头 agent 回合

## 二、双轴独立验证器（做的和验的分开）

- **结果轴** `src/verifier.ts`：换独立配置的验证器模型（默认 v4-pro，可经 `VERIFIER_MODEL` 指向异构厂商）反向重判人选质量，抓"为凑数注水"与"自评虚高"；候选人库空但今日有触达 → 报"落库断链"而非假绿灯
- **过程轴** `src/compliance.ts`：sourcing 浏览器动作落库为执行轨迹（`run_actions`），对照过程规则集审计"用没用筛选项/筛选对不对/乱开网页/高频打招呼"；解析失败判 skip 不下结论
- 轨迹捕获：`SkillResult.trace`（dom-runner 加性记录）+ orchestrator 两条 run 路径统一 `persistRunResult`（候选人 upsert + 轨迹落库）

## 三、目标锚在"面试通过"——信号回流 + 校准闭环

- `src/feedback.ts`：结果目标=找到能过面的人（反 Goodhart）；`hireseek feedback <名> pass|fail` 一句话回流 ground truth（无需 ATS）
- 预测（`fit_predictions`）× 真实结果（`interview_outcomes`）按 `(fingerprint, job_id)` 复合键对照 → 算出"判合适的人实际过面率 vs 判不合适的"，校准"合适"的定义在不在变准

## 验证 + 评审

- 自评审：用 Workflow 跑了一轮对抗性评审（4 维度 × 独立核实），确认 17 处问题并全部修复（最关键两条：并行 run 路径漏落轨迹、候选人从不入库致验证器空转）
- `tsc --noEmit` 全过；packages/core 74 单测全过
- 合规验证器合成轨迹端到端：9 步不合规轨迹（无筛选/乱开百度/高频打招呼）被准确判 fail 并逐条引证
- 修复合成测试 8/8 通过：清单解析、候选人落库、诚实-skip、复合键校准、去重
- 已知边界：执行轨迹尚未回填 ref 语义标签；结果轴随机抽样默认 8 人

---

# 第五次进化（2026-06-16 续）：合格供给驱动 + 学习闭环

承接「目标定义」的长聊，把目标真正接进 loop 的决策与学习。

## 心跳由"合格供给"驱动（计分板→方向盘）

- `feedback.ts` 加 `supplyBoard(jobId, qualityTarget)`：合格供给(验证器判 fit≥60，非触达数) / 已验证覆盖 / 管线在途 / 过面进度 / 校准状态，派生"池子见底""判断失效"信号
- 心跳 gatherSignals 首要信号换成它；决策原则按优先级重写（判断失效优先校准 ＞ 合格供给不足才寻源 ＞ 池子见底就降级不硬刷）；guard 从"触达≥30 停"改成"合格供给≥quality 停"+安全上限
- 实测 `beat dry`：以"合格供给严重不足(目标5/实际0达标)"决策，而非数触达

## 学习闭环：让"合适"的定义自己长

- `src/evolution/recalibrate.ts` `recalibrateFromOutcomes()`：拉"既被预测又有真实过面结果"的候选人，重点喂误判（判合适却挂面=假阳性、判不合适却过面=假阴性）给 v4-pro，反推过面者/挂面者共性、rubric 哪里欠校准，产出修订版 candidate-evaluation.md。复用 evolution 的 applyProposals（每文件独立 git commit、可回滚）
- 入口：`evolution/index.ts` 加 `learn(opts)`；CLI `hireseek learn [dry]`；chat 工具 `recalibrate_fit_definition`(默认 dry，apply=true 才落盘，刻意不进 sub-agent 白名单)；heartbeat evolve_dry 在 calibrationBroken 时自动转 learn-dry+notify
- 铁律：matched 样本 <6 不改写（连模型都不调）；自主路径只 dry+通知，落盘需人确认
- 实测真实 v4-pro：合成误判(4大厂判合适全挂 + 3小厂Agent判不合适全过)→准确诊断"高估大厂光环、忽略垂直深度"，区分明星AI创业 vs 大厂，产出新 rubric；dry 不动文件
- 自评审：Workflow 3 维（安全/正确/元Goodhart）对抗性核实

至此 Loop Engineering 灵魂全闭环：寻源→判合适→触达→真实过面回流→校准→**学习(定义自己改)**→判得更准。人是终极验证器，但它在把人的判断学进自己的标准。
