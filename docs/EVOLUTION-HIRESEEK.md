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
