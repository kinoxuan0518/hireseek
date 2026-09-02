# HireSeek × DeepSeek Harness

HireSeek 没有去 fork 整个 `deepseek-ai/deepseek-harness`（230+ package、developer-preview、接口仍会破）。它走的是 **同一条架构路线**：模型是灵魂，Harness 是让模型理解环境、用工具、持续干活的那一层。一切皆插件。

## 对照

| DSH | HireSeek |
|---|---|
| Cordis Context | `src/dsh/context.ts` |
| `ctx.sessions` 追加写入 SessionEvent | `src/dsh/session.ts` |
| `ctx.systemPrompt` 分段装配 | `src/dsh/prompt.ts` + `src/plugins/prompt-hireseek.ts` |
| `ctx.tools` 带守卫的执行管线 | `src/dsh/tools.ts` + permission / offload / trace 插件 |
| `ctx.llm` 适配器缝 | `src/dsh/llm.ts` + `src/plugins/llm-openai.ts` |
| `ctx.agentLoop` turn/step 驱动 | `src/dsh/loop.ts` |
| profile / bundle | `src/runtime.ts` 的 `chat` / `headless` / `subagent` |

## Turn 流程

```
turn/start
  hydrate or append user/message
  assemble prompt sections
  -> agent/pre-step          可改写 / 拒绝
     step/start
     agent/request -> llm/stream -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     工具还欠一次请求，或 inbox 里有插话 -> 下一 step
  -> agent/turn-stopping
turn/end
```

原则：**模型看见的必须能从 Session Log 重建。** `deriveMessages()` 是投影，不是另一份真相。

## 入口怎么挂上去

| 入口 | profile | 宿主 |
|---|---|---|
| 终端 chat | `chat` | `src/chat.ts` 的 TUI 驱动 `loop.runTurn`（流式 + 插话 + 暂停） |
| 飞书 Bot / 网页指挥台 | `headless` | `src/agent-session.ts` |
| 后台 sub-agent | `subagent` | `src/sub-agent.ts`（白名单工具 + 独立 system prompt） |

工具实现仍集中在 `chat.ts` 的 `executeToolImpl`（招聘领域动作太多，这一轮不把 50+ switch 拆散），但 **调用路径已经不再各自写一遍循环**：它们都经过 `ctx.tools` 管线和同一条 Agent Loop。

## 怎么扩展

新能力挂到已有缝上，而不是改 Loop：

- 换模型：给 `ctx.llm` 再注册一个 adapter
- 加工具：注册 schema + handler；管线自动带上权限 / 卸载 / trace
- 加提示词：`systemPrompt.register({ id, priority, render })`
- 拦截工具：听 `tools/pre-execute` / `tools/post-execute`（waterfall，必须 `next()`）
- 换整个循环：替换 `ctx.agentLoop`

查看当前树：

```
hireseek dsh
```

对话里 `/dsh` 同样打印 profile、插件列表和 prompt sections。
