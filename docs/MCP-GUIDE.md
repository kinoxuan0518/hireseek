# MCP (Model Context Protocol) 使用指南

HireClaw 现在支持 MCP 协议，可以连接各种外部服务扩展功能。

## 什么是 MCP？

MCP (Model Context Protocol) 是一个标准化协议，允许 AI 应用连接到：
- 文件系统
- 数据库
- API 服务
- 浏览器
- 等等...

## 快速开始

### 1. 配置 MCP 服务器

编辑 `workspace/mcp-servers.yaml`：

```yaml
servers:
  # 文件系统访问
  - name: filesystem
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "/Users/你的用户名/Documents"

  # Brave 搜索
  - name: brave-search
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-brave-search"
    env:
      BRAVE_API_KEY: your_api_key_here
```

### 2. 启动对话模式

```bash
hireclaw
```

系统会自动连接配置的 MCP 服务器。

### 3. 使用 MCP 工具

在对话中：

```
你: 列出所有 MCP 服务器
AI: [自动调用 mcp_list_servers 工具]

你: 读取 Documents 目录下的文件列表
AI: [自动调用 mcp_call_tool 访问 filesystem 服务器]
```

## 常用 MCP 服务器

### 1. 文件系统服务器

**功能**：访问本地文件系统

**安装**：
```yaml
- name: filesystem
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-filesystem"
    - "/path/to/directory"
```

**用途**：
- 读取候选人简历文件
- 访问招聘资料文档
- 管理候选人信息文件

### 2. GitHub 服务器

**功能**：访问 GitHub 仓库、Issues、PR

**安装**：
```yaml
- name: github
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-github"
  env:
    GITHUB_PERSONAL_ACCESS_TOKEN: ghp_xxxxx
```

**用途**：
- 搜索技术候选人的开源项目
- 分析候选人的代码贡献
- 查看候选人的技术栈

### 3. Brave 搜索服务器

**功能**：互联网搜索

**安装**：
```yaml
- name: brave-search
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-brave-search"
  env:
    BRAVE_API_KEY: your_key
```

**用途**：
- 搜索公司背景信息
- 查找候选人公开信息
- 调研行业动态

### 4. Puppeteer 服务器

**功能**：浏览器自动化

**安装**：
```yaml
- name: puppeteer
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-puppeteer"
```

**用途**：
- 访问需要登录的网站
- 截图保存候选人资料
- 自动化填写表单

### 5. Slack 服务器

**功能**：Slack 团队协作

**安装**：
```yaml
- name: slack
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-slack"
  env:
    SLACK_BOT_TOKEN: xoxb-xxxxx
```

**用途**：
- 发送候选人推荐到团队频道
- 同步面试安排
- 协作讨论候选人

## 更多 MCP 服务器

浏览官方服务器列表：
https://github.com/modelcontextprotocol/servers

## 对话工具

HireClaw 提供 3 个 MCP 相关工具：

### 1. mcp_list_servers
列出所有已连接的 MCP 服务器及其提供的工具和资源。

**示例**：
```
你: 有哪些 MCP 服务器可用？
```

### 2. mcp_call_tool
调用 MCP 服务器提供的工具。

**示例**：
```
你: 使用 filesystem 服务器读取 /Documents/candidates 目录
```

### 3. mcp_read_resource
读取 MCP 资源（文件、文档等）。

**示例**：
```
你: 读取候选人简历文件 resume.pdf
```

## 故障排除

### MCP 服务器连接失败

**问题**：`[MCP] ✗ 连接 filesystem 失败`

**解决**：
1. 检查 `mcp-servers.yaml` 配置是否正确
2. 确认目录路径存在
3. 确认有访问权限
4. 检查 npx 命令是否可用

### API Key 未配置

**问题**：`[MCP] API key required`

**解决**：
在 `mcp-servers.yaml` 的 `env` 字段中配置对应的 API key。

### 工具调用失败

**问题**：`调用工具失败: Tool not found`

**解决**：
1. 先用 `mcp_list_servers` 查看可用工具
2. 确认工具名称拼写正确
3. 确认参数格式正确

## 最佳实践

1. **按需配置**：只启用你需要的 MCP 服务器，避免启动过多服务
2. **保护密钥**：API key 不要提交到 Git，使用环境变量
3. **权限最小化**：文件系统服务器只授权必要的目录
4. **定期更新**：使用 `npx -y` 确保使用最新版本的 MCP 服务器

## 安全提示

⚠️ **重要**：
- `workspace/mcp-servers.yaml` 可能包含敏感信息（API keys），请勿上传到 Git
- 建议使用环境变量存储敏感配置
- 谨慎授权文件系统访问权限

## 示例配置（生产环境）

```yaml
servers:
  # 候选人简历目录
  - name: resumes
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "/Users/recruiter/Documents/Resumes"

  # GitHub 代码分析
  - name: github
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: $GITHUB_TOKEN

  # 搜索引擎
  - name: brave-search
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-brave-search"
    env:
      BRAVE_API_KEY: $BRAVE_API_KEY
```

## 下一步

- 浏览 [MCP 官方文档](https://modelcontextprotocol.io/introduction)
- 查看 [MCP 服务器列表](https://github.com/modelcontextprotocol/servers)
- 开发自定义 MCP 服务器
