# Git 自动化使用指南

HireClaw 支持 Git 自动化功能，可以在对话模式中直接管理代码版本控制。

## 功能概览

- 查看 Git 状态
- 提交代码更改
- 创建新分支
- 推送到远程仓库
- 创建 GitHub Pull Request

## 前置要求

### 基础功能（查看状态、提交、分支、推送）

- 项目必须是 git 仓库
- 已配置 git 用户信息

```bash
git config --global user.name "你的名字"
git config --global user.email "your@email.com"
```

### PR 创建功能

- 远程仓库必须是 GitHub
- 安装 GitHub CLI：`brew install gh`
- 已登录 gh CLI：`gh auth login`

## 使用示例

### 1. 查看 Git 状态

```
你: 查看一下 git 状态

AI: [自动调用 git_status 工具]
当前分支：main

已修改 (2):
  M src/chat.ts
  M README.md

未跟踪 (1):
  ? src/git-helper.ts
```

### 2. 提交代码

**提交所有更改：**
```
你: 把所有改动提交一下，消息是"feat: add git automation support"

AI: [自动调用 git_commit 工具]
提交成功！
SHA: a1b2c3d4
分支: main
提交信息: feat: add git automation support
```

**提交指定文件：**
```
你: 只提交 src/chat.ts，消息是"fix: update chat tools"

AI: [自动调用 git_commit 工具，指定 files 参数]
提交成功！
```

### 3. 创建分支

**从当前分支创建：**
```
你: 创建一个新分支叫 feature/git-tools

AI: [自动调用 git_create_branch 工具]
已创建并切换到新分支：feature/git-tools
```

**从指定分支创建：**
```
你: 基于 main 创建一个分支叫 hotfix/urgent-fix

AI: [自动调用 git_create_branch 工具，指定 baseBranch]
已创建并切换到新分支：hotfix/urgent-fix
```

### 4. 推送到远程

**普通推送：**
```
你: 推送到远程

AI: [自动调用 git_push 工具]
已推送分支 feature/git-tools 到远程仓库
```

**强制推送（谨慎使用）：**
```
你: 强制推送到远程

AI: [自动调用 git_push 工具，force=true]
已推送分支 feature/git-tools 到远程仓库
```

### 5. 创建 Pull Request

**基础 PR：**
```
你: 创建一个 PR，标题是"Add Git automation support"

AI: [自动调用 git_create_pr 工具]
PR 创建成功！
分支: feature/git-tools -> main
URL: https://github.com/user/hireclaw/pull/123
```

**带描述的 PR：**
```
你: 创建 PR，标题"Add Git automation"，描述"实现了 5 个 git 相关工具"

AI: [自动调用 git_create_pr 工具，指定 body]
PR 创建成功！
```

**草稿 PR：**
```
你: 创建一个草稿 PR

AI: [自动调用 git_create_pr 工具，draft=true]
PR 创建成功！（草稿模式）
```

**指定目标分支：**
```
你: 创建 PR 到 develop 分支

AI: [自动调用 git_create_pr 工具，baseBranch="develop"]
PR 创建成功！
分支: feature/git-tools -> develop
```

## 典型工作流

### 场景 1：修复 Bug

```
你: 查看 git 状态
→ 看到有修改的文件

你: 创建一个分支叫 fix/candidate-search
→ 创建并切换到新分支

你: 提交所有改动，消息"fix: improve candidate search logic"
→ 提交成功

你: 推送到远程
→ 推送成功

你: 创建 PR，标题"Fix candidate search"
→ PR 创建成功，返回 URL
```

### 场景 2：添加新功能

```
你: 基于 main 创建分支 feature/mcp-support
→ 创建新分支

[开发过程中...]

你: 查看 git 状态
→ 看到新增和修改的文件

你: 提交改动，消息"feat: add MCP protocol support"
→ 提交成功

你: 推送到远程
→ 推送成功

你: 创建 PR，标题"Add MCP support"，描述"支持 MCP 协议集成"
→ PR 创建成功
```

### 场景 3：快速提交（单条命令）

如果你想一次性完成多个操作，可以在对话中依次说明：

```
你: 帮我把所有改动提交到新分支 feature/quick-fix，然后推送并创建 PR

AI: [依次执行]
1. 创建分支 feature/quick-fix
2. 提交所有改动
3. 推送到远程
4. 创建 PR
```

## 安全提示

### ⚠️ 强制推送

强制推送会覆盖远程分支历史，可能导致其他人的工作丢失。只在以下情况使用：
- 确认没有其他人在使用这个分支
- 需要修正已推送的错误提交
- 重写了提交历史（如 rebase）

### ⚠️ 敏感信息

提交前确保：
- 没有包含 API keys、密码等敏感信息
- `.gitignore` 已正确配置
- 检查 `.env` 等配置文件是否被忽略

### ⚠️ 提交信息规范

建议使用语义化提交信息：
- `feat:` - 新功能
- `fix:` - Bug 修复
- `docs:` - 文档更新
- `refactor:` - 重构
- `test:` - 测试相关
- `chore:` - 构建/工具更新

## 故障排除

### 问题：未安装 gh CLI

**错误**：`未安装 gh CLI，请运行: brew install gh`

**解决**：
```bash
brew install gh
gh auth login
```

### 问题：不是 git 仓库

**错误**：`当前目录不是 git 仓库`

**解决**：
```bash
cd /path/to/your/git/repo
# 或初始化新仓库
git init
```

### 问题：不是 GitHub 仓库

**错误**：`当前仓库不是 GitHub 仓库`

**解决**：
PR 功能仅支持 GitHub 仓库。如果你的远程仓库在 GitLab、Bitbucket 等平台，需要使用对应的 CLI 工具。

### 问题：推送被拒绝

**错误**：`推送失败: Updates were rejected`

**原因**：远程分支有新提交，本地分支落后

**解决**：
```bash
# 先拉取远程更新
git pull origin <branch-name>
# 解决冲突后再推送
```

### 问题：gh auth 未登录

**错误**：`gh: To get started with GitHub CLI, please run: gh auth login`

**解决**：
```bash
gh auth login
# 按提示完成 GitHub 登录
```

## 限制和注意事项

1. **当前工作目录**：Git 操作在 HireClaw 当前工作目录执行（通常是 `hireclaw/`）
2. **分支保护**：如果目标分支有保护规则，PR 创建可能需要额外审批
3. **权限要求**：推送和创建 PR 需要有仓库的写权限
4. **gh CLI 版本**：建议使用最新版本的 gh CLI

## 与 Claude Code 对比

| 功能 | HireClaw | Claude Code |
|------|----------|-------------|
| 查看 git 状态 | ✅ | ✅ |
| 提交代码 | ✅ | ✅ |
| 创建分支 | ✅ | ✅ |
| 推送远程 | ✅ | ✅ |
| 创建 PR | ✅ (GitHub) | ✅ |
| 处理冲突 | 手动 | 手动 |
| Git rebase | 手动 | 手动 |

## 下一步

- 了解 [MCP 集成](./MCP-GUIDE.md) 连接更多外部服务
- 查看 [对话模式](../README.md#对话模式) 了解其他可用工具
- 学习 [任务管理](../README.md#任务管理) 系统
