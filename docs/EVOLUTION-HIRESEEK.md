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

环境变量：`DEEPSEEK_API_KEY`（必填）、`DEEPSEEK_BASE_URL`（默认 api.deepseek.com）、`LLM_MODEL`（默认 deepseek-chat）、`DEEPSEEK_REASONER_MODEL`（默认 deepseek-reasoner）。

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
