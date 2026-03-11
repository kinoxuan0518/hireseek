/**
 * HireClaw Chat 模式
 * 让用户和 HireClaw 自然对话，同时能触发执行动作。
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { config } from './config';
import { loadWorkspaceFile, loadActiveJob, jobToPrompt } from './skills/loader';
import { buildMemoryContext, buildConversationMemory } from './memory';
import { candidateOps, conversationOps, db } from './db';
import { runChannel, runJob, scanInbox } from './orchestrator';
import { webSearch } from './search';
import type { Channel } from './types';

/**
 * 如果配置了 MCP 服务器，则初始化它们
 */
async function initializeMCPIfConfigured(): Promise<void> {
  const mcpConfigPath = path.join(config.workspace.dir, 'mcp-servers.yaml');

  if (!fs.existsSync(mcpConfigPath)) {
    return; // 没有配置文件，跳过
  }

  try {
    const content = fs.readFileSync(mcpConfigPath, 'utf-8');
    const mcpConfig = yaml.load(content) as { servers?: any[] };

    if (!mcpConfig?.servers || mcpConfig.servers.length === 0) {
      return; // 没有配置服务器，跳过
    }

    const { initializeMCPServers } = await import('./mcp-client');
    await initializeMCPServers(mcpConfig.servers);
  } catch (err: any) {
    console.error(chalk.yellow(`[MCP] 初始化失败: ${err.message}`));
  }
}

// ── 可用工具定义 ─────────────────────────────────────────
const CHAT_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_sourcing',
      description: '在指定招聘渠道执行 sourcing 任务。不指定渠道时自动根据职位配置决定。',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: ['boss', 'maimai', 'linkedin', 'followup'],
            description: '要执行的渠道，留空则自主决定',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_inbox',
      description: '扫描 BOSS直聘收件箱，自动检测并更新已回复的候选人状态。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_funnel',
      description: '查看当前职位的招聘漏斗数据：触达、回复、面试、Offer、入职各阶段人数。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_candidate',
      description: '更新候选人的状态（面试、入职、淘汰等）。',
      parameters: {
        type: 'object',
        required: ['name', 'status'],
        properties: {
          name: { type: 'string', description: '候选人姓名（支持模糊匹配）' },
          status: {
            type: 'string',
            enum: ['replied', 'interviewed', 'offered', 'joined', 'rejected', 'dropped'],
            description: '新状态',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网，获取公司动态、行业新闻、候选人背景等实时信息。',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_config',
      description: '保存配置信息到 .env 文件，如搜索 API key。',
      parameters: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key:   { type: 'string', description: '配置项名称，如 SEARCH_PROVIDER、SEARCH_API_KEY' },
          value: { type: 'string', description: '配置值' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: '分析图片内容（简历截图、个人主页截图等）。需要模型支持 vision（Claude Sonnet/GPT-4V 支持）。',
      parameters: {
        type: 'object',
        required: ['image_path'],
        properties: {
          image_path: {
            type: 'string',
            description: '图片的绝对路径，如 /Users/xxx/Downloads/resume.jpg',
          },
          question: {
            type: 'string',
            description: '对图片的提问，如"这份简历的候选人背景如何"，不填则做通用分析',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: '执行安全的 shell 命令（只读操作），如查看进程、读取日志、Git 状态。禁止写操作和危险命令。',
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令，如 "ps aux | grep node" 或 "tail -20 /tmp/hireclaw.log"',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: '按文件名模式搜索文件。支持 glob 模式：*.ts, **/*.yaml, src/**/*.ts。快速定位文件位置。',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob 模式，如 "*.ts" (所有 ts 文件), "workspace/**/*.md" (workspace 下所有 md 文件)',
          },
          limit: {
            type: 'number',
            description: '最多返回多少个文件，默认 100',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: '在文件内容中搜索匹配的文本。支持正则表达式。用于快速定位代码位置或配置项。',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: {
            type: 'string',
            description: '搜索模式（支持正则），如 "function runJob" 或 "LLM_PROVIDER"',
          },
          filePattern: {
            type: 'string',
            description: '文件类型过滤，如 "*.ts" 或 "*.yaml"',
          },
          ignoreCase: {
            type: 'boolean',
            description: '是否忽略大小写，默认 false',
          },
          limit: {
            type: 'number',
            description: '最多返回多少处匹配，默认 50',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_code',
      description: '读取 src/ 目录下的源代码文件。用于了解自己的实现，再决定如何修改。',
      parameters: {
        type: 'object',
        required: ['filename'],
        properties: {
          filename: {
            type: 'string',
            description: '相对于 src/ 的文件路径，如 chat.ts 或 runners/generic-vision.ts',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_code',
      description: '修改 src/ 目录下的源代码文件。写完自动做 TypeScript 校验，有错误会告诉你。修改前必须先用 read_code 读取当前内容。',
      parameters: {
        type: 'object',
        required: ['filename', 'content'],
        properties: {
          filename: {
            type: 'string',
            description: '相对于 src/ 的文件路径，如 chat.ts',
          },
          content: {
            type: 'string',
            description: '文件的完整新内容',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取 workspace 下的文件内容，如话术指南、候选人评估标准、招聘知识库等。',
      parameters: {
        type: 'object',
        required: ['filename'],
        properties: {
          filename: {
            type: 'string',
            description: '相对于 workspace/ 的文件路径，如 references/outreach-guide.md',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '创建一个新任务。可用于拆解复杂招聘目标，如"本月招 5 个岗位"可拆成 5 个子任务。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: {
            type: 'string',
            description: '任务标题，如"招聘 AI 算法工程师"',
          },
          description: {
            type: 'string',
            description: '任务详细描述',
          },
          priority: {
            type: 'number',
            description: '优先级（0-10），数字越大优先级越高',
          },
          parentId: {
            type: 'number',
            description: '父任务 ID（如果是子任务）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: '更新任务状态或内容。',
      parameters: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'number',
            description: '任务 ID',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'],
            description: '新状态',
          },
          title: {
            type: 'string',
            description: '新标题',
          },
          priority: {
            type: 'number',
            description: '新优先级',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '查看任务列表或看板。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'],
            description: '按状态筛选',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_list_servers',
      description: '列出所有已连接的 MCP 服务器及其提供的工具和资源。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_call_tool',
      description: '调用 MCP 服务器提供的工具。先用 mcp_list_servers 查看可用工具。',
      parameters: {
        type: 'object',
        required: ['server', 'tool', 'args'],
        properties: {
          server: {
            type: 'string',
            description: 'MCP 服务器名称，如 "filesystem" 或 "github"',
          },
          tool: {
            type: 'string',
            description: '工具名称',
          },
          args: {
            type: 'object',
            description: '工具参数（JSON 对象）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_read_resource',
      description: '读取 MCP 资源（文件、文档等）。先用 mcp_list_servers 查看可用资源。',
      parameters: {
        type: 'object',
        required: ['server', 'uri'],
        properties: {
          server: {
            type: 'string',
            description: 'MCP 服务器名称',
          },
          uri: {
            type: 'string',
            description: '资源 URI',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_candidates',
      description: '按状态列出候选人，如查看所有未回复、已面试的候选人。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['contacted', 'replied', 'interviewed', 'offered', 'joined', 'rejected', 'dropped'],
            description: '候选人状态，不填则列出所有',
          },
          limit: {
            type: 'number',
            description: '最多返回几条，默认 20',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '更新 workspace 下的策略文件，如话术指南、评估标准、招聘知识库等。',
      parameters: {
        type: 'object',
        required: ['filename', 'content'],
        properties: {
          filename: {
            type: 'string',
            description: '相对于 workspace/ 的文件路径，如 references/outreach-guide.md',
          },
          content: { type: 'string', description: '文件的完整新内容' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_candidate',
      description: '在数据库中查找候选人信息。',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: '候选人姓名（支持模糊匹配）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看当前 git 仓库的状态：当前分支、已修改文件、未跟踪文件等。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '提交代码更改到 git 仓库。',
      parameters: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', description: '提交信息' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: '要提交的文件列表，不填则提交所有更改',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_create_branch',
      description: '创建并切换到新分支。',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: '新分支名称' },
          baseBranch: { type: 'string', description: '基于哪个分支创建，默认当前分支' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: '推送当前分支到远程仓库。',
      parameters: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: '是否强制推送（谨慎使用）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_create_pr',
      description: '创建 GitHub Pull Request（需要 gh CLI）。',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'PR 标题' },
          body: { type: 'string', description: 'PR 描述' },
          baseBranch: { type: 'string', description: '目标分支，默认 main/master' },
          draft: { type: 'boolean', description: '是否创建为草稿 PR' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: '记住重要的信息、模式或用户偏好到跨会话记忆中。用于保存稳定的、经过验证的知识。',
      parameters: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: '要记住的内容' },
          topic: {
            type: 'string',
            description: '主题分类（recruiting-patterns, candidate-preferences, debugging, workflow）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: '从记忆中删除特定内容。',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: '要删除的内容关键词' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: '查看当前的跨会话记忆内容。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_past_context',
      description: '搜索过去的对话历史，查找特定信息或解决方案。',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '最多返回几条结果，默认 10' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user_question',
      description: '向用户提出结构化的选择题，用于明确需求、偏好或决策。支持单选或多选。',
      parameters: {
        type: 'object',
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            description: '要询问的问题列表（1-4 个）',
            items: {
              type: 'object',
              required: ['question', 'header', 'options', 'multiSelect'],
              properties: {
                question: { type: 'string', description: '完整问题' },
                header: { type: 'string', description: '简短标签（如 "优先级", "技术栈"）' },
                multiSelect: { type: 'boolean', description: '是否允许多选' },
                options: {
                  type: 'array',
                  description: '选项列表（2-4 个）',
                  items: {
                    type: 'object',
                    required: ['label', 'description'],
                    properties: {
                      label: { type: 'string', description: '选项名称' },
                      description: { type: 'string', description: '选项说明' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_pdf',
      description: '读取 PDF 文件内容（如候选人简历）。大于 10 页的 PDF 必须指定页码范围，最多 20 页。',
      parameters: {
        type: 'object',
        required: ['file_path'],
        properties: {
          file_path: { type: 'string', description: 'PDF 文件的绝对路径' },
          pages: {
            type: 'string',
            description: '页码范围（如 "1-5", "3", "10-20"），大于 10 页必须指定',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_permissions',
      description: '查看已保存的权限规则。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_permissions',
      description: '清除所有已保存的权限规则。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enter_plan_mode',
      description: '进入计划模式，探索代码库并设计实现方案。用于复杂任务，需要先探索、分析、设计后再执行。',
      parameters: {
        type: 'object',
        required: ['task_description'],
        properties: {
          task_description: { type: 'string', description: '任务描述' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exit_plan_mode',
      description: '退出计划模式，生成计划文档并请求用户批准。',
      parameters: {
        type: 'object',
        required: ['task_description', 'approach', 'steps', 'risks'],
        properties: {
          task_description: { type: 'string', description: '任务描述' },
          approach: { type: 'string', description: '实现方案概述' },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '执行步骤列表',
          },
          risks: {
            type: 'array',
            items: { type: 'string' },
            description: '风险和注意事项',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_hooks',
      description: '查看已配置的 hooks（事件触发器）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_hook',
      description: '添加 hook，在特定事件发生时自动执行 shell 命令。',
      parameters: {
        type: 'object',
        required: ['hook_name', 'command'],
        properties: {
          hook_name: {
            type: 'string',
            description: 'Hook 名称（如 post-sourcing, post-commit）',
          },
          command: {
            type: 'string',
            description: '要执行的 shell 命令',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_hook',
      description: '删除指定的 hook。',
      parameters: {
        type: 'object',
        required: ['hook_name'],
        properties: {
          hook_name: { type: 'string', description: 'Hook 名称' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_session',
      description: '导出当前对话会话到本地文件（Markdown + JSON），可在其他地方查看或导入。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '会话标题，默认使用日期' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sessions',
      description: '列出所有已导出的会话。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_session',
      description: '在浏览器中打开指定的会话文件。',
      parameters: {
        type: 'object',
        required: ['session_id'],
        properties: {
          session_id: { type: 'string', description: '会话 ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_session',
      description: '复制会话内容到剪贴板（macOS）。',
      parameters: {
        type: 'object',
        required: ['session_id'],
        properties: {
          session_id: { type: 'string', description: '会话 ID' },
        },
      },
    },
  },
];

// ── 工具执行 ─────────────────────────────────────────────
async function executeTool(name: string, args: any): Promise<string> {
  // 权限检查
  const { checkPermission } = await import('./permissions');
  const approved = await checkPermission({
    toolName: name,
    args,
    description: CHAT_TOOLS.find(t => t.function.name === name)?.function.description,
  });

  if (!approved) {
    return `工具调用被拒绝: ${name}`;
  }

  switch (name) {
    case 'analyze_image': {
      const imagePath = args.image_path;
      const question = args.question || '请分析这张图片的内容';

      // 检查文件是否存在
      if (!fs.existsSync(imagePath)) {
        return `图片文件不存在：${imagePath}`;
      }

      // 检查文件类型
      const ext = path.extname(imagePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        return `不支持的图片格式：${ext}（支持 jpg/png/gif/webp）`;
      }

      // 读取并编码
      const imageBuffer = fs.readFileSync(imagePath);
      const base64 = imageBuffer.toString('base64');
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      // 调用 vision API
      try {
        const client = new OpenAI({
          apiKey: config.custom.apiKey || config.anthropic.apiKey,
          baseURL: config.custom.baseUrl || config.anthropic.baseUrl || undefined,
        });

        const response = await client.chat.completions.create({
          model: config.llm.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: question },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              ],
            },
          ],
          max_tokens: 1000,
        });

        return response.choices[0]?.message?.content || '无法分析图片';
      } catch (e: any) {
        if (e.message?.includes('vision') || e.message?.includes('image')) {
          return '当前模型不支持图片分析（需要 Claude Sonnet 4 或 GPT-4V）';
        }
        return `图片分析失败：${e.message}`;
      }
    }

    case 'run_sourcing': {
      const channel = args.channel as Channel | undefined;
      console.log(chalk.gray('\n[执行中] 启动 sourcing 任务...\n'));
      if (channel) {
        await runChannel(channel);
      } else {
        await runJob();
      }
      return `sourcing 任务已完成。`;
    }

    case 'scan_inbox': {
      console.log(chalk.gray('\n[执行中] 扫描收件箱...\n'));
      await scanInbox();
      return `收件箱扫描完成，已更新回复状态。`;
    }

    case 'get_funnel': {
      const job   = loadActiveJob();
      const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';
      const stats = (db.prepare(`
        SELECT status, COUNT(*) as count FROM candidates
        WHERE job_id = ? GROUP BY status ORDER BY count DESC
      `).all(jobId)) as { status: string; count: number }[];

      const STATUS_LABEL: Record<string, string> = {
        contacted: '已触达', replied: '已回复', interviewed: '已面试',
        offered: '已 Offer', joined: '已入职', rejected: '已淘汰', dropped: '已放弃',
      };

      if (stats.length === 0) return '暂无数据，还没有执行过 sourcing 任务。';
      return stats.map(s => `${STATUS_LABEL[s.status] ?? s.status}：${s.count} 人`).join('\n');
    }

    case 'update_candidate': {
      const { name, status } = args;
      const matches = candidateOps.findByName.all(`%${name}%`) as any[];
      if (matches.length === 0) return `未找到候选人：${name}`;
      for (const c of matches) {
        candidateOps.updateStatus.run({ status, id: c.id });
      }
      return `已更新 ${matches.length} 位候选人（${matches.map((c: any) => c.name).join('、')}）状态为：${status}`;
    }

    case 'web_search': {
      return await webSearch(args.query);
    }

    case 'update_config': {
      const envPath = path.join(process.cwd(), '.env');
      let content   = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
      const line    = `${args.key}=${args.value}`;
      const regex   = new RegExp(`^${args.key}=.*$`, 'm');
      content = regex.test(content) ? content.replace(regex, line) : `${content}\n${line}`;
      fs.writeFileSync(envPath, content.trim() + '\n');
      process.env[args.key] = args.value;
      return `已保存：${args.key}`;
    }

    case 'glob': {
      const { searchFiles, formatGlobResults } = await import('./tools/glob');
      try {
        const files = await searchFiles({
          pattern: args.pattern,
          limit: args.limit,
        });
        return formatGlobResults(files, args.pattern);
      } catch (err: any) {
        return `搜索失败: ${err.message}`;
      }
    }

    case 'grep': {
      const { searchContent, formatGrepResults } = await import('./tools/grep');
      try {
        const matches = await searchContent({
          pattern: args.pattern,
          filePattern: args.filePattern,
          ignoreCase: args.ignoreCase,
          limit: args.limit,
        });
        return formatGrepResults(matches, args.pattern);
      } catch (err: any) {
        return `搜索失败: ${err.message}`;
      }
    }

    case 'run_shell': {
      const cmd = args.command.trim();

      // 安全检查：禁止危险命令
      const forbidden = ['rm', 'sudo', 'su', 'shutdown', 'reboot', 'mkfs', 'dd', '>', '>>', 'curl.*sh', 'wget.*sh'];
      const dangerous = forbidden.some(pattern => new RegExp(`\\b${pattern}\\b`, 'i').test(cmd));
      if (dangerous) return '⛔ 禁止执行危险命令（rm/sudo/shutdown等）';

      // 禁止链式执行和命令替换
      if (/[;&`$]|\|\|/.test(cmd.replace(/\|(?!\|)/g, ''))) {
        return '⛔ 禁止使用 ; && || ` $() 等链式执行语法，每次只能执行一条命令';
      }

      // 执行命令（10秒超时，限制输出）
      try {
        const output = execSync(cmd, {
          cwd: process.cwd(),
          timeout: 10000,
          maxBuffer: 1024 * 100, // 100KB
          encoding: 'utf-8',
        });
        return output.slice(0, 2000) || '（命令执行成功，无输出）';
      } catch (e: any) {
        const err = e.stderr?.toString() || e.stdout?.toString() || e.message;
        return `命令执行失败：\n${err.slice(0, 1000)}`;
      }
    }

    case 'read_code': {
      const target = path.join(process.cwd(), 'src', args.filename);
      const srcRoot = path.join(process.cwd(), 'src');
      if (!target.startsWith(srcRoot)) return '不允许读 src/ 以外的文件';
      if (!fs.existsSync(target)) return `文件不存在：src/${args.filename}`;
      return fs.readFileSync(target, 'utf-8');
    }

    case 'write_code': {
      const target = path.join(process.cwd(), 'src', args.filename);
      const srcRoot = path.join(process.cwd(), 'src');
      if (!target.startsWith(srcRoot)) return '不允许写 src/ 以外的文件';

      // 备份原文件
      const backup = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content, 'utf-8');

      // TypeScript 校验
      try {
        execSync('npx tsc --noEmit', { cwd: process.cwd(), stdio: 'pipe' });
        return `✓ 已写入 src/${args.filename}，TypeScript 校验通过。`;
      } catch (e: any) {
        // 校验失败，回滚
        if (backup !== null) fs.writeFileSync(target, backup);
        else fs.unlinkSync(target);
        const errors = e.stdout?.toString() || e.stderr?.toString() || e.message;
        return `✗ TypeScript 校验失败，已自动回滚。错误：\n${errors.slice(0, 800)}`;
      }
    }

    case 'read_file': {
      const target = path.join(process.cwd(), 'workspace', args.filename);
      const wsRoot = path.join(process.cwd(), 'workspace');
      if (!target.startsWith(wsRoot)) return '不允许读 workspace 以外的文件';
      if (!fs.existsSync(target)) return `文件不存在：workspace/${args.filename}`;
      return fs.readFileSync(target, 'utf-8');
    }

    case 'create_task': {
      const { createTask } = await import('./tasks');
      const taskId = createTask({
        title: args.title,
        description: args.description,
        priority: args.priority,
        parentId: args.parentId,
      });
      return `✓ 已创建任务 #${taskId}：${args.title}`;
    }

    case 'update_task': {
      const { updateTask, getTask } = await import('./tasks');
      const task = getTask(args.id);
      if (!task) return `任务 #${args.id} 不存在`;

      updateTask(args.id, {
        status: args.status,
        title: args.title,
        priority: args.priority,
      });

      return `✓ 已更新任务 #${args.id}`;
    }

    case 'list_tasks': {
      const { listTasksByStatus, listAllTasks, displayTaskBoard } = await import('./tasks');

      if (args.status) {
        const tasks = listTasksByStatus(args.status);
        if (tasks.length === 0) {
          return `暂无 ${args.status} 状态的任务`;
        }
        return tasks.map(t => `#${t.id} ${t.title}`).join('\n');
      } else {
        const tasks = listAllTasks();
        if (tasks.length === 0) {
          return '暂无任务';
        }

        const summary = {
          pending: tasks.filter(t => t.status === 'pending').length,
          in_progress: tasks.filter(t => t.status === 'in_progress').length,
          completed: tasks.filter(t => t.status === 'completed').length,
        };

        return `任务总览：\n- 待处理：${summary.pending} 个\n- 进行中：${summary.in_progress} 个\n- 已完成：${summary.completed} 个\n\n详细看板请运行：hireclaw tasks`;
      }
    }

    case 'mcp_list_servers': {
      const { mcpClient } = await import('./mcp-client');
      const servers = mcpClient.listConnections();

      if (servers.length === 0) {
        return 'MCP 服务器未配置。请在 workspace/mcp-servers.yaml 中配置并重启。';
      }

      const lines = ['已连接的 MCP 服务器：\n'];
      for (const serverName of servers) {
        const tools = mcpClient.getTools(serverName);
        const resources = mcpClient.getResources(serverName);

        lines.push(`\n【${serverName}】`);
        lines.push(`  工具 (${tools.length}):`);
        if (tools.length > 0) {
          tools.slice(0, 5).forEach(t => {
            lines.push(`    - ${t.name}: ${t.description || '无描述'}`);
          });
          if (tools.length > 5) {
            lines.push(`    ... 还有 ${tools.length - 5} 个工具`);
          }
        } else {
          lines.push('    （无）');
        }

        lines.push(`  资源 (${resources.length}):`);
        if (resources.length > 0) {
          resources.slice(0, 5).forEach(r => {
            lines.push(`    - ${r.uri}: ${r.name || '无名称'}`);
          });
          if (resources.length > 5) {
            lines.push(`    ... 还有 ${resources.length - 5} 个资源`);
          }
        } else {
          lines.push('    （无）');
        }
      }

      return lines.join('\n');
    }

    case 'mcp_call_tool': {
      const { mcpClient } = await import('./mcp-client');

      try {
        const result = await mcpClient.callTool(args.server, args.tool, args.args);
        return JSON.stringify(result, null, 2);
      } catch (err: any) {
        return `调用失败: ${err.message}`;
      }
    }

    case 'mcp_read_resource': {
      const { mcpClient } = await import('./mcp-client');

      try {
        const result = await mcpClient.readResource(args.server, args.uri);
        return JSON.stringify(result, null, 2);
      } catch (err: any) {
        return `读取失败: ${err.message}`;
      }
    }

    case 'list_candidates': {
      const { status, limit = 20 } = args;
      const rows = status
        ? (db.prepare(`SELECT name, company, channel, status, contacted_at FROM candidates WHERE status = ? ORDER BY contacted_at DESC LIMIT ?`).all(status, limit) as any[])
        : (db.prepare(`SELECT name, company, channel, status, contacted_at FROM candidates ORDER BY contacted_at DESC LIMIT ?`).all(limit) as any[]);
      if (rows.length === 0) return status ? `暂无「${status}」状态的候选人` : '暂无候选人数据';
      return rows.map((c: any) =>
        `${c.name}（${c.company || '未知公司'}，${c.channel}）- ${c.status}，${c.contacted_at?.slice(0, 10) ?? '未知'}`
      ).join('\n');
    }

    case 'write_file': {
      const target = path.join(process.cwd(), 'workspace', args.filename);
      // 只允许写 workspace/ 下的文件，防止越权
      const wsRoot = path.join(process.cwd(), 'workspace');
      if (!target.startsWith(wsRoot)) return '不允许写 workspace 以外的文件';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content, 'utf-8');
      return `已更新：workspace/${args.filename}`;
    }

    case 'search_candidate': {
      const matches = candidateOps.findByName.all(`%${args.name}%`) as any[];
      if (matches.length === 0) return `未找到候选人：${args.name}`;
      return matches.map((c: any) =>
        `${c.name}（${c.company || '未知公司'}，${c.channel}）- 状态：${c.status}，联系于：${c.contacted_at?.slice(0, 10) ?? '未知'}`
      ).join('\n');
    }

    case 'git_status': {
      const { getGitStatus, isGitRepo } = await import('./git-helper');

      if (!isGitRepo()) {
        return '当前目录不是 git 仓库';
      }

      try {
        const status = getGitStatus();
        let result = `当前分支：${status.branch}\n`;

        if (status.clean) {
          result += '\n工作区干净，没有更改';
        } else {
          if (status.staged.length > 0) {
            result += `\n已暂存 (${status.staged.length}):\n`;
            result += status.staged.map(f => `  + ${f}`).join('\n');
          }
          if (status.modified.length > 0) {
            result += `\n已修改 (${status.modified.length}):\n`;
            result += status.modified.map(f => `  M ${f}`).join('\n');
          }
          if (status.untracked.length > 0) {
            result += `\n未跟踪 (${status.untracked.length}):\n`;
            result += status.untracked.map(f => `  ? ${f}`).join('\n');
          }
        }

        return result;
      } catch (err: any) {
        return `获取 git 状态失败: ${err.message}`;
      }
    }

    case 'git_commit': {
      const { gitCommit, getGitStatus, isGitRepo } = await import('./git-helper');
      const { runHook } = await import('./hooks');

      if (!isGitRepo()) {
        return '当前目录不是 git 仓库';
      }

      try {
        // Pre-commit hook
        await runHook('pre-commit', { message: args.message });

        const sha = gitCommit({
          message: args.message,
          files: args.files,
        });

        if (sha === 'nothing') {
          return '没有需要提交的更改';
        }

        // Post-commit hook
        await runHook('post-commit', { message: args.message, sha });

        const status = getGitStatus();
        return `提交成功！\nSHA: ${sha.substring(0, 8)}\n分支: ${status.branch}\n提交信息: ${args.message}`;
      } catch (err: any) {
        return `提交失败: ${err.message}`;
      }
    }

    case 'git_create_branch': {
      const { createBranch, getGitStatus, isGitRepo } = await import('./git-helper');

      if (!isGitRepo()) {
        return '当前目录不是 git 仓库';
      }

      try {
        createBranch({
          name: args.name,
          baseBranch: args.baseBranch,
        });

        const status = getGitStatus();
        return `已创建并切换到新分支：${status.branch}`;
      } catch (err: any) {
        return `创建分支失败: ${err.message}`;
      }
    }

    case 'git_push': {
      const { gitPush, getGitStatus, isGitRepo } = await import('./git-helper');
      const { runHook } = await import('./hooks');

      if (!isGitRepo()) {
        return '当前目录不是 git 仓库';
      }

      try {
        const status = getGitStatus();

        // Pre-push hook
        await runHook('pre-git-push', { branch: status.branch, force: args.force });

        gitPush(status.branch, args.force || false);

        // Post-push hook
        await runHook('post-git-push', { branch: status.branch });

        return `已推送分支 ${status.branch} 到远程仓库`;
      } catch (err: any) {
        return `推送失败: ${err.message}`;
      }
    }

    case 'git_create_pr': {
      const { createPR, getGitStatus, isGitRepo, hasGitHubCLI, isGitHubRepo, getDefaultBranch } = await import('./git-helper');

      if (!isGitRepo()) {
        return '当前目录不是 git 仓库';
      }

      if (!isGitHubRepo()) {
        return '当前仓库不是 GitHub 仓库';
      }

      if (!hasGitHubCLI()) {
        return '未安装 gh CLI，请运行: brew install gh';
      }

      try {
        const status = getGitStatus();
        const baseBranch = args.baseBranch || getDefaultBranch();

        const prUrl = createPR({
          title: args.title,
          body: args.body,
          baseBranch,
          draft: args.draft,
        });

        return `PR 创建成功！\n分支: ${status.branch} -> ${baseBranch}\nURL: ${prUrl}`;
      } catch (err: any) {
        return `创建 PR 失败: ${err.message}`;
      }
    }

    case 'remember': {
      const { appendMemory, saveTopicFile, loadTopicFile } = await import('./auto-memory');

      try {
        if (args.topic) {
          // 保存到主题文件
          const existingContent = loadTopicFile(args.topic);
          const newContent = existingContent
            ? `${existingContent}\n- ${args.content}\n`
            : `# ${args.topic}\n\n- ${args.content}\n`;
          saveTopicFile(args.topic, newContent);
          return `已记住（主题: ${args.topic}）：${args.content}`;
        } else {
          // 保存到 MEMORY.md 的 "记忆索引" section
          appendMemory('记忆索引', args.content);
          return `已记住：${args.content}`;
        }
      } catch (err: any) {
        return `保存记忆失败: ${err.message}`;
      }
    }

    case 'forget': {
      const { forgetMemory } = await import('./auto-memory');

      try {
        const modified = forgetMemory(args.pattern);
        if (modified) {
          return `已删除包含「${args.pattern}」的记忆`;
        } else {
          return `未找到包含「${args.pattern}」的记忆`;
        }
      } catch (err: any) {
        return `删除记忆失败: ${err.message}`;
      }
    }

    case 'recall_memory': {
      const { loadMemory, listTopicFiles, loadTopicFile } = await import('./auto-memory');

      try {
        let result = '# 当前记忆\n\n';
        result += '## MEMORY.md\n\n' + loadMemory() + '\n\n';

        const topics = listTopicFiles();
        if (topics.length > 0) {
          result += '## 主题文件\n\n';
          for (const topic of topics) {
            result += `### ${topic}\n\n`;
            const content = loadTopicFile(topic);
            result += content + '\n\n';
          }
        }

        return result;
      } catch (err: any) {
        return `读取记忆失败: ${err.message}`;
      }
    }

    case 'search_past_context': {
      const { searchPastContext } = await import('./auto-memory');

      try {
        const results = searchPastContext(args.query, args.limit || 10);
        if (results.length === 0) {
          return `未找到包含「${args.query}」的历史对话`;
        }

        return `找到 ${results.length} 条相关历史记录：\n\n${results.slice(0, 5).join('\n\n---\n\n')}`;
      } catch (err: any) {
        return `搜索失败: ${err.message}`;
      }
    }

    case 'ask_user_question': {
      const { askUserQuestions, formatAnswers } = await import('./ask-user');

      try {
        const answers = await askUserQuestions({ questions: args.questions });
        return formatAnswers(args.questions, answers);
      } catch (err: any) {
        return `询问失败: ${err.message}`;
      }
    }

    case 'read_pdf': {
      const { readPDF, formatPDFContent } = await import('./pdf-reader');

      try {
        const content = await readPDF({
          filePath: args.file_path,
          pages: args.pages,
        });
        return formatPDFContent(content, args.file_path);
      } catch (err: any) {
        return `读取 PDF 失败: ${err.message}`;
      }
    }

    case 'list_permissions': {
      const { formatPermissions } = await import('./permissions');
      return formatPermissions();
    }

    case 'clear_permissions': {
      const { clearPermissions } = await import('./permissions');
      clearPermissions();
      return '已清除所有权限规则';
    }

    case 'enter_plan_mode': {
      const { enterPlanMode } = await import('./plan-mode');
      const { runHook } = await import('./hooks');

      await runHook('plan-mode-enter', { task: args.task_description });

      return enterPlanMode(args.task_description);
    }

    case 'exit_plan_mode': {
      const {
        generatePlanDocument,
        requestPlanApproval,
        exitPlanMode,
      } = await import('./plan-mode');
      const { runHook } = await import('./hooks');

      // 生成计划文档
      const planContent = generatePlanDocument(
        args.task_description,
        args.approach,
        args.steps,
        args.risks
      );

      // 请求用户批准
      const approved = await requestPlanApproval();

      await runHook('plan-mode-exit', { approved });

      // 退出计划模式
      return exitPlanMode(approved);
    }

    case 'list_hooks': {
      const { formatHooks } = await import('./hooks');
      return formatHooks();
    }

    case 'add_hook': {
      const { addHook } = await import('./hooks');

      try {
        addHook(args.hook_name, args.command);
        return `已添加 hook: ${args.hook_name}\n命令: ${args.command}`;
      } catch (err: any) {
        return `添加 hook 失败: ${err.message}`;
      }
    }

    case 'remove_hook': {
      const { removeHook } = await import('./hooks');

      try {
        removeHook(args.hook_name);
        return `已删除 hook: ${args.hook_name}`;
      } catch (err: any) {
        return `删除 hook 失败: ${err.message}`;
      }
    }

    case 'export_session': {
      const { exportSession } = await import('./remote-session');

      try {
        // 注意：这里需要访问当前的 messages，所以需要从外部传入
        // 这是一个特殊情况，我们需要在 executeTool 外部处理
        return '导出会话需要在对话结束时调用 /export 命令';
      } catch (err: any) {
        return `导出失败: ${err.message}`;
      }
    }

    case 'list_sessions': {
      const { listSessions, formatSessionList } = await import('./remote-session');

      try {
        const sessions = listSessions();
        return formatSessionList(sessions);
      } catch (err: any) {
        return `列出会话失败: ${err.message}`;
      }
    }

    case 'open_session': {
      const { openSessionInBrowser } = await import('./remote-session');

      try {
        openSessionInBrowser(args.session_id);
        return `已在浏览器中打开会话: ${args.session_id}`;
      } catch (err: any) {
        return `打开失败: ${err.message}`;
      }
    }

    case 'copy_session': {
      const { copySessionToClipboard } = await import('./remote-session');

      try {
        copySessionToClipboard(args.session_id);
        return `已复制会话 ${args.session_id} 到剪贴板`;
      } catch (err: any) {
        return `复制失败: ${err.message}`;
      }
    }

    default:
      return `未知工具：${name}`;
  }
}

// ── 构建系统提示 ─────────────────────────────────────────
function buildSystemPrompt(): string {
  const soul     = loadWorkspaceFile('SOUL.md');
  const wisdom   = loadWorkspaceFile('references/founders-wisdom.md');
  const job      = loadActiveJob();
  const jobCtx   = job ? jobToPrompt(job) : '';
  const memory   = job ? buildMemoryContext('boss', job.title.replace(/\s+/g, '_')) : '';
  const convMem  = job ? buildConversationMemory(job.title.replace(/\s+/g, '_')) : '';

  // Auto Memory - 跨会话记忆
  let autoMemory = '';
  try {
    const { getMemoryContext } = require('./auto-memory');
    autoMemory = getMemoryContext();
  } catch {
    // 如果 auto-memory 模块未加载，跳过
  }

  const chatGuide = `
## 对话模式与主动性原则

你现在处于对话模式，是用户真正的招聘伙伴，不是被动的工具。

### 主动性要求

**评估自己的输出质量**：每次完成一个动作或给出信息后，先问自己：这个结果够好吗？有没有明显的局限？

**主动说出不足**：如果结果有限制，不要等用户发现，主动说明：
- 为什么这个结果可能不够准确或完整
- 有哪些更好的方向或方案
- 如果有更好的方案但需要额外权限（API key、账号、数据），先说清楚能带来什么改善，再问用户是否愿意提供

**主动提建议**：不只是回答用户问的，还要主动发现用户没问但应该知道的事：
- 数据异常（回复率突然下降、某类候选人一直不回）
- 策略盲点（只在一个渠道找人、话术很久没换）
- 时机提醒（某个候选人联系超过 7 天没跟进）

**索取权限的顺序**：
1. 先尝试用现有能力解决
2. 如果现有能力明显不够，说明不足在哪、更好的方案是什么
3. 用户认可方向后，再具体请求所需的 key 或权限
4. 不要一上来就问"你有 xxx key 吗"——先证明值得要

### 风格
直接、专业、有温度。像一个真正懂招聘、又在乎结果的伙伴在聊天，不是客服，不是助手，是伙伴。
`.trim();

  return [soul, wisdom, jobCtx, memory, convMem, autoMemory, chatGuide].filter(Boolean).join('\n\n---\n\n');
}

// ── 对话记忆保存 ─────────────────────────────────────────
async function saveConversationMemory(
  client: OpenAI,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[]
): Promise<void> {
  // 只有真正聊过才保存（系统提示 + 至少一轮用户/助手）
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length === 0) return;

  const job   = loadActiveJob();
  const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';

  try {
    // 提取最后 6 轮对话原文（user + assistant 交替）
    const turns = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const lastTurns = turns.slice(-6).map(m => {
      const role = m.role === 'user' ? '你' : 'HireClaw';
      const text = typeof m.content === 'string' ? m.content : '[操作]';
      return `${role}: ${text.slice(0, 300)}`;
    }).join('\n');

    const res = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: 'user',
          content: `请总结这次对话，下次对话时需要注入这份记忆。按以下格式输出：

总结：[2-3句，说清楚聊了什么、做了什么决定]
候选人：[提到的候选人姓名及关键结论，如"张三-决定下周面试，李四-已放弃"，没有则写"无"]
待办：[未完成的事项，如"需要跟进王五"，没有则写"无"]
策略变化：[对话中调整了哪些招聘策略，没有则写"无"]`,
        },
      ],
      max_tokens: 400,
    });

    const text = res.choices[0]?.message?.content ?? '';
    const extract = (label: string) => {
      const m = text.match(new RegExp(`${label}[：:]([^\\n]+)`));
      return m?.[1]?.trim() ?? '';
    };

    conversationOps.save.run({
      job_id:     jobId,
      summary:    extract('总结') || text.slice(0, 200),
      highlights: [
        extract('候选人') !== '无' ? `候选人：${extract('候选人')}` : '',
        extract('待办') !== '无'   ? `待办：${extract('待办')}` : '',
        extract('策略变化') !== '无' ? `策略：${extract('策略变化')}` : '',
      ].filter(Boolean).join(' | '),
      excerpt: lastTurns,
    });
  } catch {
    // 保存失败不影响退出
  }
}

// ── 对话窗口压缩 ─────────────────────────────────────────
/**
 * 压缩消息数组，防止超过上下文窗口。
 * 保留系统提示 + 最近 N 条消息，中间的替换为摘要。
 */
function pruneMessages(
  messages: OpenAI.ChatCompletionMessageParam[],
  keepRecent = 20
): OpenAI.ChatCompletionMessageParam[] {
  if (messages.length <= keepRecent + 1) return messages; // +1 for system prompt

  const systemPrompt = messages[0]; // 系统提示永远保留
  const recentMessages = messages.slice(-keepRecent); // 最近 N 条
  const prunedCount = messages.length - keepRecent - 1;

  // 中间的消息用一条摘要替代
  const summary: OpenAI.ChatCompletionMessageParam = {
    role: 'user',
    content: `[之前的 ${prunedCount} 条消息已压缩，继续当前对话]`,
  };

  return [systemPrompt, summary, ...recentMessages];
}

// ── 主对话循环 ───────────────────────────────────────────
export async function startChat(): Promise<void> {
  // 初始化 MCP 服务器
  await initializeMCPIfConfigured();

  // 初始化自动记忆系统
  try {
    const { initializeDefaultTopics } = await import('./auto-memory');
    initializeDefaultTopics();
  } catch (err) {
    // 静默失败
  }

  // 初始化技能系统
  try {
    const { initializeDefaultSkills } = await import('./skill-system');
    initializeDefaultSkills();
  } catch (err) {
    // 静默失败
  }

  // 检查 API Key
  const apiKey = config.custom.apiKey || config.anthropic.apiKey;
  if (!apiKey) {
    console.log(chalk.red('\n❌ 错误：未配置 API Key\n'));
    console.log(chalk.yellow('请先配置 API Key：'));
    console.log(chalk.gray('  1. 方法一：运行 hireclaw setup 进行配置'));
    console.log(chalk.gray('  2. 方法二：设置环境变量'));
    console.log(chalk.gray('     export OPENAI_API_KEY="your-key"'));
    console.log(chalk.gray('  3. 方法三：编辑配置文件'));
    console.log(chalk.gray(`     ${path.join(config.workspace.dir, 'config.yaml')}\n`));
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.custom.baseUrl || config.anthropic.baseUrl || undefined,
  });
  const model = config.llm.model;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
  ];

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('🦞 HireClaw 对话模式 - 你的智能招聘助手'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.bold('💡 快速开始：'));
  console.log(chalk.gray('  • "帮我在 BOSS直聘找 10 个前端工程师"'));
  console.log(chalk.gray('  • "查看今天的候选人"'));
  console.log(chalk.gray('  • "分析一下候选人回复率"'));
  console.log(chalk.gray('  • "把张三标记为已面试"\n'));

  console.log(chalk.bold('⚡ 快捷命令：'));
  console.log(chalk.gray('  /找候选人 <职位>    - 自动 sourcing'));
  console.log(chalk.gray('  /候选人漏斗        - 查看招聘数据'));
  console.log(chalk.gray('  /分析简历 <路径>   - PDF 简历分析'));
  console.log(chalk.gray('  /export [标题]     - 导出会话'));
  console.log(chalk.gray('  /sessions         - 查看所有会话'));
  console.log(chalk.gray('  exit              - 退出对话\n'));

  console.log(chalk.bold('🎯 核心功能：'));
  console.log(chalk.gray('  ✓ 智能对话 - 自然语言控制所有功能'));
  console.log(chalk.gray('  ✓ 自动记忆 - 记住你的偏好和工作习惯'));
  console.log(chalk.gray('  ✓ 工具调用 - 44+ 工具随时待命'));
  console.log(chalk.gray('  ✓ Git 集成 - 代码管理一句话搞定'));
  console.log(chalk.gray('  ✓ 跨平台导出 - 会话可导出到 claude.ai\n'));

  console.log(chalk.yellow('💭 提示：直接说出你的需求，我会自动调用合适的工具完成任务'));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // 检查是否首次使用（没有职位配置）
  const job = loadActiveJob();
  const isFirstTime = !job || job.title === 'AI 算法工程师';

  if (isFirstTime) {
    // AI 主动发起对话
    console.log(chalk.cyan('🦞: ') + chalk.white('你好！我注意到你还没有配置招聘职位。'));
    console.log(chalk.cyan('    ') + chalk.white('你想招什么职位呢？你可以：\n'));
    console.log(chalk.gray('    • 直接口头描述：') + chalk.white('"我想招一个前端工程师，要求..."'));
    console.log(chalk.gray('    • 提供 JD 文档：') + chalk.white('"读取这个 JD: /path/to/jd.pdf"'));
    console.log(chalk.gray('    • 分享在线链接：') + chalk.white('"分析这个职位: https://..."'));
    console.log('');
  }

  // Ctrl+C 也触发记忆保存
  process.once('SIGINT', async () => {
    console.log(chalk.gray('\n\n正在保存本次对话记忆...'));
    await saveConversationMemory(client, model, messages);
    console.log(chalk.gray('再见！\n'));
    rl.close();
    process.exit(0);
  });

  const ask = (): void => {
    rl.question(chalk.green('你: '), async (input) => {
      const text = input.trim();
      if (!text) { ask(); return; }

      // 退出命令
      if (text === 'exit' || text === '退出') {
        console.log(chalk.gray('\n正在保存本次对话记忆...'));
        await saveConversationMemory(client, model, messages);
        console.log(chalk.gray('再见！\n'));
        rl.close();
        return;
      }

      // 导出会话命令
      if (text === '/export' || text.startsWith('/export ')) {
        const { exportSession } = await import('./remote-session');
        const titleMatch = text.match(/\/export\s+(.+)/);
        const title = titleMatch ? titleMatch[1] : undefined;

        const session = exportSession({
          title,
          messages,
        });

        console.log(chalk.green('\n✓ 会话已导出'));
        console.log(chalk.gray(`   ID: ${session.id}`));
        console.log(chalk.gray(`   标题: ${session.title}`));
        console.log(chalk.gray(`   消息: ${session.messageCount} 条`));
        console.log(chalk.gray(`   Markdown: ${session.url}`));
        console.log(chalk.gray(`   JSON: ${session.url.replace('.md', '.json')}`));
        console.log(chalk.yellow('\n提示: 你可以将 Markdown 文件复制到 claude.ai 继续对话\n'));

        ask();
        return;
      }

      // 列出会话命令
      if (text === '/sessions') {
        const { listSessions, formatSessionList } = await import('./remote-session');
        const sessions = listSessions();

        console.log(chalk.cyan('\n' + formatSessionList(sessions) + '\n'));

        ask();
        return;
      }

      // 检查是否是技能调用
      const { parseSkillInvocation, executeSkill } = await import('./skill-system');
      const skillInvocation = parseSkillInvocation(text);

      let userMessage = text;

      if (skillInvocation.isSkill) {
        // 执行技能，将技能提示词作为用户消息
        const skillPrompt = executeSkill(skillInvocation.skillName, skillInvocation.args);
        userMessage = skillPrompt;
        console.log(chalk.gray(`\n[执行技能: /${skillInvocation.skillName}]\n`));
      }

      messages.push({ role: 'user', content: userMessage });

      // 智能自动压缩（当接近上下文限制时）
      const { autoCompress } = await import('./context-compression');
      const result = autoCompress(messages, {
        maxTokens: 180000,  // 90% of 200K context window
        targetTokens: 100000,
        preserveRecent: 10,
      });

      if (result.compressed) {
        console.log(chalk.gray('\n[自动压缩] 对话历史已智能压缩，保留了重要信息\n'));
        messages.length = 0;
        messages.push(...result.messages);
      }

      try {
        let response = await client.chat.completions.create({
          model,
          messages,
          tools: CHAT_TOOLS,
          tool_choice: 'auto',
          max_tokens: 1024,
        });

        let msg = response.choices[0].message;
        messages.push(msg);

        // 处理工具调用
        while (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

          for (const call of msg.tool_calls) {
            const args   = JSON.parse(call.function.arguments || '{}');
            const result = await executeTool(call.function.name, args);
            toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
          }

          messages.push(...toolResults);

          response = await client.chat.completions.create({
            model,
            messages,
            tools: CHAT_TOOLS,
            tool_choice: 'auto',
            max_tokens: 1024,
          });

          msg = response.choices[0].message;
          messages.push(msg);
        }

        const reply = msg.content ?? '';
        console.log(`\n${chalk.cyan('HireClaw')}: ${reply}\n`);

      } catch (err: any) {
        console.error(chalk.red(`\n出错了: ${err.message}\n`));
      }

      ask();
    });
  };

  ask();
}
