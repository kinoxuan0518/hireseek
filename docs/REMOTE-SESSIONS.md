# 远程会话使用指南

HireClaw 支持导出对话会话，可以在其他平台（如 claude.ai）继续对话。

---

## 功能概览

- **导出会话** - 将当前对话导出为 Markdown + JSON
- **列出会话** - 查看所有已导出的会话
- **打开会话** - 在浏览器中查看会话
- **复制会话** - 复制到剪贴板（macOS）
- **跨平台使用** - 在 claude.ai 继续对话

---

## 快速开始

### 1. 导出当前对话

在对话中输入：

```
/export
```

或指定标题：

```
/export 我的招聘策略讨论
```

输出示例：

```
✓ 会话已导出
   ID: a1b2c3d4e5f67890
   标题: 我的招聘策略讨论
   消息: 15 条
   Markdown: file:///path/to/sessions/a1b2c3d4e5f67890.md
   JSON: file:///path/to/sessions/a1b2c3d4e5f67890.json

提示: 你可以将 Markdown 文件复制到 claude.ai 继续对话
```

### 2. 查看所有会话

```
/sessions
```

输出示例：

```
会话列表：

1. 我的招聘策略讨论
   ID: a1b2c3d4e5f67890
   时间: 2024-01-20 14:30:00
   消息: 15 条
   文件: file:///path/to/sessions/a1b2c3d4e5f67890.md

2. 前端工程师候选人分析
   ID: b2c3d4e5f6a78901
   时间: 2024-01-19 10:15:00
   消息: 23 条
   文件: file:///path/to/sessions/b2c3d4e5f6a78901.md
```

---

## 使用场景

### 场景 1：跨设备继续对话

**问题**：在电脑上和 HireClaw 聊了很久，想在手机上继续？

**解决**：

1. 导出会话：`/export 手机继续`
2. 打开导出的 Markdown 文件
3. 复制全部内容
4. 在手机浏览器打开 [claude.ai](https://claude.ai)
5. 粘贴对话历史
6. 继续聊天

### 场景 2：分享对话给同事

**问题**：想把和 HireClaw 的讨论分享给团队？

**解决**：

1. 导出会话：`/export 招聘策略讨论`
2. 找到 Markdown 文件（路径在输出中）
3. 发送给同事
4. 同事可以直接阅读或导入到 claude.ai

### 场景 3：归档重要对话

**问题**：某些对话很有价值，想保存下来？

**解决**：

1. 导出会话：`/export 重要-候选人评估框架`
2. 会话自动保存在 `workspace/sessions/`
3. 可以备份到云盘或 Git 仓库

### 场景 4：恢复之前的讨论

**问题**：几天前讨论的内容想重新看看？

**解决**：

1. 查看会话列表：`/sessions`
2. 找到对应的会话 ID
3. 使用工具打开：`open_session(session_id)`
4. 或直接打开 Markdown 文件

---

## 导出格式

### Markdown 格式（.md）

人类可读的格式，适合：
- 在编辑器中阅读
- 复制到 claude.ai
- 分享给他人
- 生成文档

示例：

```markdown
# 我的招聘策略讨论

**创建时间**: 2024-01-20 14:30:00
**消息数**: 15

---

## 👤 用户

帮我制定本周的招聘策略

---

## 🤖 AI

好的，让我帮你分析一下...

[内容略]

---

## 👤 用户

那 BOSS直聘和脉脉该如何分配精力？

---

## 🤖 AI

根据历史数据分析...

[内容略]
```

### JSON 格式（.json）

机器可读的格式，适合：
- 重新导入到 HireClaw
- 程序化处理
- 数据分析
- 备份恢复

示例：

```json
{
  "title": "我的招聘策略讨论",
  "createdAt": "2024-01-20T14:30:00.000Z",
  "messageCount": 15,
  "messages": [
    {
      "role": "user",
      "content": "帮我制定本周的招聘策略"
    },
    {
      "role": "assistant",
      "content": "好的，让我帮你分析一下..."
    }
  ]
}
```

---

## 对话工具

除了命令（`/export`, `/sessions`），还可以使用对话工具：

### 1. list_sessions

列出所有会话

```
你: 列出所有会话

AI: [调用 list_sessions]
    会话列表：
    1. 我的招聘策略讨论
    2. 前端工程师候选人分析
    ...
```

### 2. open_session

在浏览器打开会话

```
你: 打开会话 a1b2c3d4e5f67890

AI: [调用 open_session]
    ✓ 已在浏览器中打开会话
```

### 3. copy_session

复制会话到剪贴板（仅 macOS）

```
你: 复制会话 a1b2c3d4e5f67890 到剪贴板

AI: [调用 copy_session]
    ✓ 已复制到剪贴板

[现在可以直接粘贴到 claude.ai]
```

---

## 高级用法

### 1. 自动导出（Hook）

在每次对话结束时自动导出：

```bash
# 添加 post-chat hook（需要自己实现触发点）
你: 添加 hook，在对话结束时自动导出会话

AI: [调用 add_hook]
    hook_name: post-chat
    command: echo "对话已自动导出"
```

### 2. 批量导出

导出所有重要对话：

```bash
# 在 shell 中
cd workspace/sessions
ls *.md | wc -l  # 查看会话数量
```

### 3. Git 版本控制

将会话纳入版本控制：

```bash
# 在 hireclaw 目录
git add workspace/sessions/
git commit -m "docs: archive recruitment discussions"
git push
```

### 4. 云端同步

同步到云盘：

```bash
# 创建软链接到 Dropbox/iCloud
ln -s ~/hireclaw/workspace/sessions ~/Dropbox/HireClaw-Sessions
```

---

## 文件结构

```
workspace/
└── sessions/
    ├── a1b2c3d4e5f67890.md      # Markdown 格式
    ├── a1b2c3d4e5f67890.json    # JSON 格式
    ├── b2c3d4e5f6a78901.md
    ├── b2c3d4e5f6a78901.json
    └── ...
```

每个会话有两个文件：
- `.md` - 人类阅读
- `.json` - 机器处理

---

## 跨平台使用步骤

### 方法 1：手动复制（推荐）

1. **导出会话**
   ```
   /export 我的对话
   ```

2. **打开 Markdown 文件**
   - macOS: `open workspace/sessions/xxx.md`
   - Linux: `xdg-open workspace/sessions/xxx.md`
   - Windows: 在文件管理器中打开

3. **复制内容**
   - 全选（Cmd/Ctrl + A）
   - 复制（Cmd/Ctrl + C）

4. **粘贴到 claude.ai**
   - 打开 [claude.ai](https://claude.ai)
   - 新建对话
   - 粘贴内容
   - 继续聊天

### 方法 2：使用剪贴板（macOS）

1. **导出并复制**
   ```
   /export
   /sessions  # 查看会话 ID
   ```

2. **在对话中调用工具**
   ```
   你: 复制会话 xxx 到剪贴板
   AI: ✓ 已复制
   ```

3. **直接粘贴到 claude.ai**

---

## 故障排除

### 问题 1：找不到导出的文件

**原因**：路径不对

**解决**：
```bash
# 查找会话文件
find ~/hireclaw -name "*.md" -path "*/sessions/*"

# 或直接进入目录
cd ~/hireclaw/workspace/sessions
ls -la
```

### 问题 2：复制到剪贴板失败（非 macOS）

**原因**：剪贴板功能仅支持 macOS

**解决**：
1. 手动打开 Markdown 文件
2. 全选复制
3. 或使用 Linux 的 `xclip`:
   ```bash
   cat workspace/sessions/xxx.md | xclip -selection clipboard
   ```

### 问题 3：claude.ai 提示内容过长

**原因**：对话历史太长

**解决**：
1. 只复制最近的几轮对话
2. 或使用 HireClaw 的上下文压缩功能
3. 分段粘贴

---

## 最佳实践

### 1. 命名规范

使用描述性标题：

```
✅ 好的命名：
/export 2024-Q1招聘策略
/export 前端候选人评估-张三
/export 重要-年度招聘计划

❌ 不好的命名：
/export 对话
/export test
/export 123
```

### 2. 定期归档

每周或每月导出重要对话：

```
/export 2024-01-第三周-招聘总结
```

### 3. 分类管理

创建子目录：

```bash
cd workspace/sessions
mkdir strategy candidates plans
mv *策略* strategy/
mv *候选人* candidates/
```

### 4. 备份

定期备份会话：

```bash
# 打包备份
tar -czf sessions-backup-2024-01.tar.gz workspace/sessions/

# 上传到云端
# ...
```

---

## 未来增强（计划中）

- [ ] 直接推送到 claude.ai（需要 API 支持）
- [ ] 生成公开分享链接
- [ ] 会话合并功能
- [ ] 智能摘要生成
- [ ] 会话搜索功能

---

## 与 Claude Code 对比

| 功能 | Claude Code | HireClaw |
|------|-------------|----------|
| 导出会话 | ✅ | ✅ |
| 推送到 claude.ai | ✅ 自动 | ⚠️ 手动 |
| 本地保存 | ✅ | ✅ |
| Markdown 格式 | ✅ | ✅ |
| JSON 格式 | ✅ | ✅ |
| 跨设备同步 | ✅ 自动 | ⚠️ 手动 |

**HireClaw 优势**：
- 完全本地控制
- 支持 Markdown 和 JSON 双格式
- 可以纳入 Git 版本控制
- 易于备份和分享

**未来改进**：
- 实现自动推送到 claude.ai
- 提供云端同步服务

---

## 总结

远程会话功能让 HireClaw 的对话可以跨平台、跨设备继续，同时保持完全的本地控制和隐私安全。

**核心命令**：
- `/export` - 导出会话
- `/sessions` - 查看会话

**典型用法**：
```
HireClaw 对话 → /export → 复制 Markdown → 粘贴到 claude.ai → 继续对话
```

简单、高效、安全！🦞
