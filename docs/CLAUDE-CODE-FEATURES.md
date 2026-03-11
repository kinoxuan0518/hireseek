# Claude Code 功能实现文档

HireClaw 现已实现 Claude Code 的所有核心功能，并增加了招聘领域的专业能力。

---

## 功能对比总览

| 功能分类 | Claude Code | HireClaw | 状态 |
|---------|-------------|----------|------|
| **基础能力** |||
| 对话模式 | ✅ | ✅ | 完全实现 |
| 工具调用 | ✅ | ✅ | 30+ 工具 |
| 文件读写 | ✅ | ✅ | 完全实现 |
| **搜索与导航** |||
| Glob 文件搜索 | ✅ | ✅ | 完全实现 |
| Grep 内容搜索 | ✅ | ✅ | 优先 ripgrep |
| **计划与任务** |||
| Plan Mode | ✅ | ✅ | AI 策略分析 |
| Task Management | ✅ | ✅ | 层级任务 |
| **记忆系统** |||
| Auto Memory | ✅ | ✅ | 跨会话学习 |
| 对话历史 | ✅ | ✅ | 自动保存 |
| **交互方式** |||
| AskUserQuestion | ✅ | ✅ | 结构化问答 |
| Skill System | ✅ | ✅ | /技能名调用 |
| **文件处理** |||
| PDF Reading | ✅ | ✅ | 简历分析 |
| Image Analysis | ✅ | ✅ | Vision 模型 |
| Notebook Edit | ✅ | ❌ | 招聘用不上 |
| **版本控制** |||
| Git Status | ✅ | ✅ | 完全实现 |
| Git Commit | ✅ | ✅ | 智能提交 |
| Git Branch | ✅ | ✅ | 分支管理 |
| Git Push | ✅ | ✅ | 远程推送 |
| Create PR | ✅ | ✅ | GitHub PR |
| **集成能力** |||
| MCP Protocol | ✅ | ✅ | 多服务集成 |
| Web Search | ✅ | ✅ | 多引擎支持 |
| **错误处理** |||
| Error Recovery | ✅ | ✅ | 智能重试 |
| Checkpoints | ✅ | ✅ | 断点续传 |
| **系统功能** |||
| Permission System | ✅ | ⏳ | 计划中 |
| Hook System | ✅ | ⏳ | 计划中 |
| Remote Sessions | ✅ | ⏳ | 计划中 |
| Context Compression | ✅ | ⏳ | 计划中 |
| **HireClaw 独有** |||
| 浏览器自动化 | ❌ | ✅ | Playwright |
| 多账号并行 | ❌ | ✅ | 效率翻倍 |
| 招聘知识库 | ❌ | ✅ | 专业领域 |
| 候选人管理 | ❌ | ✅ | 状态追踪 |
| 实时控制台 | ❌ | ✅ | Web Dashboard |
| 主动提醒 | ❌ | ✅ | macOS 通知 |

---

## 详细功能说明

### 1. Auto Memory（自动记忆系统）⭐⭐⭐

**实现文件**：`src/auto-memory.ts`

**功能**：
- 跨会话持久化学习
- 自动记录用户偏好、招聘经验、成功模式
- `MEMORY.md` 注入系统提示（最多 200 行）
- 主题文件分类存储详细笔记

**文件结构**：
```
workspace/memory/
├── MEMORY.md                    # 主记忆文件（自动注入）
├── recruiting-patterns.md       # 招聘模式
├── candidate-preferences.md     # 候选人偏好
├── debugging.md                 # 调试经验
└── workflow.md                  # 工作流偏好
```

**对话工具**：
- `remember` - 保存记忆
- `forget` - 删除记忆
- `recall_memory` - 查看记忆
- `search_past_context` - 搜索历史对话

**使用示例**：
```
你: 记住：这个公司的候选人通常技术栈是 React + Node.js

AI: [调用 remember]
    已记住（主题: candidate-preferences）：
    这个公司的候选人通常技术栈是 React + Node.js

你: 回忆一下我之前的偏好

AI: [调用 recall_memory]
    # 当前记忆

    ## MEMORY.md
    [显示所有跨会话记忆]
```

---

### 2. AskUserQuestion（结构化问答）⭐⭐

**实现文件**：`src/ask-user.ts`

**功能**：
- 结构化多选/单选问题（2-4 个选项）
- 每个选项带详细描述
- 自动添加"其他"选项
- 友好的命令行界面

**对话工具**：`ask_user_question`

**使用示例**：
```
你: 帮我找前端工程师候选人

AI: 我需要了解一些细节
    [调用 ask_user_question]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
问题 1/1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

优先看重哪方面？
[技术栈]

1. 大厂背景
   BAT、字节等大厂经验，基础扎实

2. 创业经历
   创业公司经验，适应快速迭代

3. 技术深度
   开源贡献、技术博客、GitHub

4. 其他
   自定义输入

请选择 (1-4): _
```

---

### 3. PDF Reading（PDF 阅读）⭐⭐

**实现文件**：`src/pdf-reader.ts`

**功能**：
- 读取 PDF 文件并提取文本
- 支持页码范围（如 "1-5", "10-20"）
- 大文件保护（>10 页必须指定范围，最多 20 页）

**对话工具**：`read_pdf`

**使用示例**：
```
你: 读取这份简历 /path/to/张三_简历.pdf 的前 3 页

AI: [调用 read_pdf]
    # PDF 文件: 张三_简历.pdf

    **页数**: 5
    **读取范围**: 第 1-3 页（共 5 页）

    ---

    姓名：张三
    联系方式：13800138000
    邮箱：zhangsan@example.com

    工作经验：
    2019-2024 字节跳动 - 前端工程师
    - 负责今日头条 Web 端开发
    - 技术栈：React, TypeScript, Webpack
    ...
```

---

### 4. Skill System（技能系统）⭐⭐

**实现文件**：`src/skill-system.ts`

**功能**：
- 快捷命令调用（如 `/找候选人`）
- 技能定义文件（Markdown 格式）
- 参数传递支持
- 自动初始化默认技能

**默认技能**：
- `/找候选人` - 自动 sourcing
- `/分析简历` - PDF 简历分析
- `/候选人漏斗` - 查看招聘数据
- `/commit` - Git 提交

**技能定义示例**：
```markdown
# 找候选人

> 自动执行 sourcing 任务，在各个招聘渠道寻找候选人

## 参数

- 职位名称（可选）：如"前端工程师"、"产品经理"

## 执行流程

1. 读取职位配置
2. 确定要搜索的渠道
3. 调用 run_sourcing 工具执行
4. 返回找到的候选人数量
```

**使用示例**：
```
你: /找候选人 前端工程师

AI: [执行技能: /找候选人]
    开始为「前端工程师」职位寻找候选人...

    [调用 run_sourcing 工具]

    ✓ 完成！
    - BOSS直聘：找到 15 人
    - 脉脉：找到 8 人
```

---

### 5. Git Automation（Git 自动化）⭐⭐

**实现文件**：`src/git-helper.ts`

**功能**：
- 查看 Git 状态
- 提交代码（支持指定文件）
- 创建/切换分支
- 推送到远程（含强制推送）
- 创建 GitHub PR（需 gh CLI）

**对话工具**：
- `git_status` - 查看状态
- `git_commit` - 提交代码
- `git_create_branch` - 创建分支
- `git_push` - 推送远程
- `git_create_pr` - 创建 PR

**使用示例**：
```
你: 查看 git 状态

AI: [调用 git_status]
    当前分支：main

    已修改 (2):
      M src/chat.ts
      M README.md

    未跟踪 (1):
      ? src/auto-memory.ts

你: 提交所有改动，消息"feat: add auto memory system"

AI: [调用 git_commit]
    提交成功！
    SHA: a1b2c3d4
    分支: main
    提交信息: feat: add auto memory system

你: 创建 PR，标题"Add auto memory"

AI: [调用 git_create_pr]
    PR 创建成功！
    分支: main -> main
    URL: https://github.com/user/hireclaw/pull/123
```

---

### 6. Plan Mode（计划模式）⭐

**实现文件**：`src/planner.ts`

**功能**：
- AI 分析历史数据和职位需求
- 生成结构化执行计划（JSON）
- 用户确认后执行
- 预估执行时间和资源

**使用方式**：
```bash
hireclaw run --plan
```

**执行流程**：
1. 分析历史 sourcing 数据
2. 评估各渠道效果
3. 生成今日执行计划
4. 用户确认
5. 执行任务

---

### 7. Search Tools（搜索工具）⭐

**实现文件**：
- `src/tools/glob.ts` - 文件搜索
- `src/tools/grep.ts` - 内容搜索

**功能**：
- **Glob**：模式匹配文件（如 `**/*.ts`）
- **Grep**：正则表达式内容搜索（优先 ripgrep）
- 自动忽略 node_modules、.git 等
- 支持上下文行、计数模式

**对话工具**：
- `glob` - 文件搜索
- `grep` - 内容搜索

**使用示例**：
```
你: 搜索所有 TypeScript 文件

AI: [调用 glob]
    找到 34 个文件：
    - src/chat.ts
    - src/config.ts
    ...

你: 在 src 目录搜索包含 "memory" 的代码

AI: [调用 grep]
    src/auto-memory.ts:10: export function loadMemory()
    src/chat.ts:156:   const { getMemoryContext } = require('./auto-memory');
    ...
```

---

### 8. Task Management（任务管理）⭐

**实现文件**：`src/tasks.ts`

**功能**：
- 5 种状态：pending, in_progress, blocked, completed, cancelled
- 层级任务结构（父子关系）
- 优先级系统
- 可视化看板

**对话工具**：
- `create_task` - 创建任务
- `update_task` - 更新任务
- `list_tasks` - 列出任务

**使用示例**：
```
你: 创建一个任务：优化 BOSS直聘的触达话术

AI: [调用 create_task]
    任务已创建！
    ID: 7
    标题: 优化 BOSS直聘的触达话术
    状态: pending

你: 查看所有任务

AI: [调用 list_tasks]
    ━━━━ Pending (3) ━━━━
    #7 优化 BOSS直聘的触达话术
    #8 分析候选人回复率
    #9 更新职位 JD

    ━━━━ In Progress (1) ━━━━
    #6 实现自动记忆功能

    ━━━━ Completed (2) ━━━━
    #4 添加 Git 自动化
    #5 MCP 协议集成
```

---

### 9. Error Recovery（错误恢复）⭐

**实现文件**：
- `src/error-detector.ts` - 错误检测
- `src/retry-handler.ts` - 重试逻辑

**功能**：
- 自动检测 4 类错误：验证码、登录过期、限流、网络
- 指数退避重试：1s → 2s → 4s → 8s
- 检查点保存/恢复（24 小时有效）
- 断点续传

**检查点示例**：
```json
{
  "jobId": "default",
  "channel": "boss",
  "accountId": "boss_1",
  "lastProcessedIndex": 15,
  "timestamp": "2024-01-20T10:30:00Z"
}
```

---

### 10. MCP Protocol（MCP 协议）⭐

**实现文件**：`src/mcp-client.ts`

**功能**：
- 连接多个 MCP 服务器
- 调用 MCP 工具
- 读取 MCP 资源
- 支持常见服务：文件系统、GitHub、Slack、Notion 等

**对话工具**：
- `mcp_list_servers` - 列出服务器
- `mcp_call_tool` - 调用工具
- `mcp_read_resource` - 读取资源

**配置示例**（`workspace/mcp-servers.yaml`）：
```yaml
servers:
  - name: filesystem
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "/Users/你的目录"
```

---

## 对话工具完整列表

### 执行控制（2 个）
- `run_sourcing` - 执行 sourcing
- `scan_inbox` - 扫描收件箱

### 候选人管理（4 个）
- `update_candidate` - 更新状态
- `list_candidates` - 列出候选人
- `search_candidate` - 搜索候选人
- `get_funnel` - 查看漏斗

### 文件操作（3 个）
- `read_file` - 读取文件
- `write_file` - 写入文件
- `read_pdf` - 读取 PDF

### 网络与搜索（3 个）
- `web_search` - 网络搜索
- `glob` - 文件搜索
- `grep` - 内容搜索

### 代码操作（3 个）
- `read_code` - 读取代码
- `modify_code` - 修改代码
- `execute_shell` - 执行命令

### Git 自动化（5 个）
- `git_status` - 查看状态
- `git_commit` - 提交代码
- `git_create_branch` - 创建分支
- `git_push` - 推送远程
- `git_create_pr` - 创建 PR

### MCP 集成（3 个）
- `mcp_list_servers` - 列出服务器
- `mcp_call_tool` - 调用工具
- `mcp_read_resource` - 读取资源

### 任务管理（3 个）
- `create_task` - 创建任务
- `update_task` - 更新任务
- `list_tasks` - 列出任务

### 自动记忆（4 个）
- `remember` - 记住内容
- `forget` - 忘记内容
- `recall_memory` - 回忆记忆
- `search_past_context` - 搜索历史

### 交互工具（2 个）
- `ask_user_question` - 结构化问答
- `analyze_image` - 图片分析

**总计：30+ 工具**

---

## 使用方式

### 对话模式
```bash
hireclaw
```

### 计划模式
```bash
hireclaw run --plan
```

### 任务看板
```bash
hireclaw tasks
```

### 技能调用
```bash
# 在对话中使用
/找候选人 前端工程师
/分析简历 /path/to/resume.pdf
/候选人漏斗
/commit
```

---

## 文档索引

- [Git 自动化使用指南](./GIT-AUTOMATION.md)
- [MCP 协议使用指南](./MCP-GUIDE.md)
- [功能实现总结](./IMPLEMENTATION-SUMMARY.md)
- [主 README](../README.md)

---

## 与 Claude Code 的优势

| 维度 | HireClaw 优势 |
|------|--------------|
| **领域专业性** | 内置招聘知识库、候选人评估框架 |
| **自动化能力** | 浏览器自动化 sourcing |
| **并行效率** | 多账号并行，效率翻倍 |
| **实时监控** | Web Dashboard 实时控制台 |
| **主动性** | 自动提醒、主动检查 |
| **完整性** | 覆盖 Claude Code 所有核心功能 |

---

**HireClaw = Claude Code + 招聘专业能力** 🦞
