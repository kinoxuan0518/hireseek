/**
 * HireSeek Chat 模式
 * 让用户和 HireSeek 自然对话，同时能触发执行动作。
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
      name: 'use_recruiting_skill',
      description:
        '调用一项招聘技能（来自 ~/.claude/skills 及插件，如 rbt、maimai-recruiter、talent-sourcing、' +
        'candidate-intelligence、blacklake-targeted-talent-hunting 等）。' +
        '当用户的请求匹配某项技能的触发场景时调用此工具，技能的完整执行指令会注入对话，随后按指令执行。' +
        '可先传 list=true 查看全部可用技能及描述。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: '技能名称（如 rbt、maimai-recruiter、talent-sourcing）',
          },
          args: {
            type: 'string',
            description: '传给技能的参数或任务描述（可选）',
          },
          list: {
            type: 'boolean',
            description: '为 true 时仅返回全部技能清单，不执行',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'feishu_recruiting_stats',
      description:
        '读取飞书招聘多维表格的真实结果数据（候选人状态分布、渠道转化等聚合统计）。' +
        '用于复盘招聘效果、反思话术与筛选策略、驱动技能进化。需要配置飞书自建应用。',
      parameters: {
        type: 'object',
        properties: {
          max_records: {
            type: 'number',
            description: '最多读取的记录数，默认 500',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evolve',
      description:
        '进化闭环：基于飞书多维表格真实招聘结果 + 本地漏斗数据复盘，' +
        '由深推理模型诊断话术/筛选规则的问题并自动改写（git 留版本可回滚）。' +
        '用户说"复盘"、"进化"、"优化话术"、"为什么回复率低"时调用。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['run', 'dry', 'back', 'log'],
            description: 'run=复盘并落盘改写；dry=只出报告不改；back=回滚上次进化；log=进化历史与效果',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user_choice',
      description:
        '需要用户做决定时（选执行模式、选渠道、确认下一步），弹出方向键选择器让用户选，' +
        '比开放式提问体验好得多。给 2-6 个简短选项；如果允许自由回答，把"其他（我来描述）"作为最后一项。' +
        '返回用户选中的选项文本，用户取消则提示改用文字询问。',
      parameters: {
        type: 'object',
        required: ['question', 'options'],
        properties: {
          question: { type: 'string', description: '要问的问题，简短' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2-6 个选项，每个一句话以内',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_schedule',
      description:
        '查看或修改定时招聘计划（BOSS寻源/脉脉寻源/跟进未回复/每周进化复盘）。' +
        '用户说"每天早上8点跑BOSS""周末别跑""把脉脉关掉"这类需求时调用。' +
        '你负责把自然语言时间转成 cron（分 时 日 月 周），如"工作日早上8点"→"0 8 * * 1-5"。' +
        '修改前先 list 给用户看现状；修改是写配置，确认用户意图明确后再 set。',
      parameters: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'set', 'disable', 'enable'], description: '操作' },
          task: {
            type: 'string',
            enum: ['boss', 'maimai', 'followup', 'evolve'],
            description: 'set/disable/enable 时必填',
          },
          cron: { type: 'string', description: 'set 时必填，5 段 cron 表达式' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_connect',
      description:
        '连接浏览器（优先接管用户已登录的 Chrome）。操作 BOSS直聘/脉脉等页面前必须先调用一次。' +
        '可传 url_hint 按关键词选标签页（如 "zhipin"、"maimai"）。返回连接状态和当前页面。',
      parameters: {
        type: 'object',
        properties: {
          url_hint: { type: 'string', description: '标签页 URL/标题关键词，如 zhipin、maimai' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description:
        '获取当前页面的文本快照：URL、标题、可交互元素清单（[ref=N] 标注）、正文摘要。' +
        '点击/输入前先用它确认元素 ref。页面跳转后旧 ref 失效，需重新快照。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_act',
      description:
        '执行一个浏览器动作并返回最新快照。动作：click（点元素，需 ref）、type（输入文字，需 ref+text）、' +
        'press（按键如 Enter）、scroll（滚动）、goto（跳转 URL）、back、wait（等待毫秒）。' +
        '内置风控：打招呼自动节流 ≥5 秒、每日上限自动硬终止、频率告警自动提示退避。' +
        '操控浏览器一律用此工具，禁止用 run_shell 写 AppleScript。',
      parameters: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['click', 'type', 'press', 'scroll', 'goto', 'back', 'wait'],
            description: '动作类型',
          },
          ref: { type: 'number', description: '目标元素 ref（快照中 [ref=N] 的 N），click/type 必填' },
          text: { type: 'string', description: 'type 的输入内容，或 press 的按键名' },
          url: { type: 'string', description: 'goto 的目标 URL' },
          direction: { type: 'string', enum: ['up', 'down'], description: 'scroll 方向' },
          amount: { type: 'number', description: 'scroll 像素或 wait 毫秒' },
        },
      },
    },
  },
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
            description: '要执行的命令，如 "ps aux | grep node" 或 "tail -20 /tmp/hireseek.log"',
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
          apiKey: config.deepseek.apiKey || config.custom.apiKey || config.anthropic.apiKey,
          baseURL: config.deepseek.apiKey
            ? config.deepseek.baseUrl
            : config.custom.baseUrl || config.anthropic.baseUrl || undefined,
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

    case 'feishu_recruiting_stats': {
      try {
        const { buildEvolutionContext } = await import('./channels/feishu');
        console.log(chalk.gray('\n[执行中] 读取飞书招聘数据...\n'));
        return await buildEvolutionContext(typeof args.max_records === 'number' ? args.max_records : 500);
      } catch (e: any) {
        return `飞书数据读取失败：${e.message}\n提示：需要配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID，并为自建应用开通多维表格只读权限。`;
      }
    }

    case 'evolve': {
      const { evolve, rollbackLastEvolution, evolutionHistory, evolutionImpact } = await import('./evolution');
      const mode = (args.mode as string) || 'dry';

      if (mode === 'back') return rollbackLastEvolution();
      if (mode === 'log') return `${evolutionHistory()}\n\n${evolutionImpact()}`;

      console.log(chalk.gray(`\n[进化] 复盘中${mode === 'dry' ? '（dry-run）' : ''}...\n`));
      return await evolve({ dryRun: mode === 'dry', notify: mode === 'run' });
    }

    case 'ask_user_choice': {
      const { selectOption } = await import('./select');
      const options = (Array.isArray(args.options) ? args.options : []).map(String).slice(0, 9);
      if (options.length < 2) return '选项不足 2 个，请直接用文字询问用户。';

      const picked = await selectOption(String(args.question ?? '请选择'), options.map((o: string) => ({ label: o })));
      if (picked == null) {
        return '用户取消了选择（或当前环境不支持交互）。请改用文字简洁询问，不要再弹选择器。';
      }
      return `用户选择：${options[picked]}`;
    }

    case 'manage_schedule': {
      const { describeSchedule, setSchedule } = await import('./schedule-manager');
      const action = String(args.action ?? 'list');
      if (action === 'list') return describeSchedule();
      const task = String(args.task ?? '');
      if (action === 'disable') return setSchedule(task, 'off');
      if (action === 'enable') return setSchedule(task, 'default');
      return setSchedule(task, String(args.cron ?? ''));
    }

    case 'browser_connect': {
      const { connectBrowser } = await import('./chat-browser');
      return await connectBrowser(args.url_hint ? String(args.url_hint) : undefined);
    }

    case 'browser_snapshot': {
      const { snapshot } = await import('./chat-browser');
      return await snapshot();
    }

    case 'browser_act': {
      const { act } = await import('./chat-browser');
      return await act({
        action: args.action,
        ref: args.ref as number | undefined,
        text: args.text as string | undefined,
        url: args.url as string | undefined,
        direction: args.direction as 'up' | 'down' | undefined,
        amount: args.amount as number | undefined,
      });
    }

    case 'use_recruiting_skill': {
      const { listClaudeSkills, getClaudeSkill, skillToPrompt } = await import('./skills/claude-skills');

      if (args.list || !args.skill_name) {
        const catalog = listClaudeSkills()
          .map(s => `- ${s.name}（${s.source}）: ${s.description.slice(0, 150)}`)
          .join('\n');
        return `可用招聘技能：\n${catalog || '（未发现技能，请确认 ~/.claude/skills 目录）'}`;
      }

      const skill = getClaudeSkill(String(args.skill_name));
      if (!skill) {
        const names = listClaudeSkills().map(s => s.name).join(', ');
        return `未找到技能 "${args.skill_name}"。可用技能: ${names}`;
      }

      console.log(chalk.gray(`\n[技能注入] ${skill.name}\n`));
      return skillToPrompt(skill, args.args ? String(args.args) : undefined);
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

        return `任务总览：\n- 待处理：${summary.pending} 个\n- 进行中：${summary.in_progress} 个\n- 已完成：${summary.completed} 个\n\n详细看板请运行：hireseek tasks`;
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

### HR 体验铁律（用户是 HR，不是工程师）

1. **永远不要让用户做技术操作**——关弹窗、按 Esc、跑命令、改文件都不行。遇到卡点自己换至少 3 种方法重试（换选择器、按 Escape 键、刷新页面重来），全部失败才汇报，并只说业务影响。
2. **浏览器操作一律用 browser_connect / browser_snapshot / browser_act 工具**，一次调用一个动作。严禁用 run_shell 写 AppleScript 或 JS 文件去操控浏览器——那条路又慢又容易错。
3. **汇报说招聘语言**：说"已打招呼 5 人（常迈/熊文韬…），今日权益剩 196 次"，不说 SPA / DOM / ref / AppleScript / bodyLen 这类词。技术报错先翻译成业务影响再说，不贴原始错误。
4. **长任务每完成一批（约 5 人）主动汇报一次**：已触达名单、跳过原因、剩余权益、下一步。让用户随时知道进度，而不是闷头跑。
5. **风控红线由代码强制执行**（打招呼 ≥5 秒间隔、每日上限硬终止），你只需在触发时向用户解释发生了什么。
6. **需要用户做决定时用 ask_user_choice 弹选择器**——选模式、选渠道、确认下一步，都给 2-6 个选项让用户方向键选，不要抛开放式问题或表格让用户打字回答。
7. **用户可以随时插话**——执行长任务时收到 [用户插话] 消息，立即按新指示调整（跳过某人、换条件、停止某步），调整后继续任务，不要忽略也不要从头再来；收到暂停消息则立刻停手汇报。

### 风格
直接、专业、有温度。像一个真正懂招聘、又在乎结果的伙伴在聊天，不是客服，不是助手，是伙伴。
`.trim();

  // 招聘技能目录（来自 ~/.claude/skills 及插件）
  let skillsCtx = '';
  try {
    const { skillCatalog } = require('./skills/claude-skills');
    const catalog = skillCatalog();
    if (catalog) {
      skillsCtx = `## 已接管的招聘技能\n\n以下技能可通过 use_recruiting_skill 工具调用（用户也可用 /技能名 直接触发）。当用户请求匹配某技能的触发场景时，优先调用对应技能而不是临时发挥：\n\n${catalog}`;
    }
  } catch {
    // 技能目录不可用时跳过
  }

  return [soul, wisdom, jobCtx, memory, convMem, autoMemory, skillsCtx, chatGuide].filter(Boolean).join('\n\n---\n\n');
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
      const role = m.role === 'user' ? '你' : 'HireSeek';
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

  // 检查 API Key - 直接从环境变量读取，不依赖 config 缓存（DeepSeek 优先）
  const apiKey = process.env.DEEPSEEK_API_KEY ||
                 process.env.CUSTOM_API_KEY ||
                 process.env.ANTHROPIC_API_KEY ||
                 process.env.OPENAI_API_KEY ||
                 config.deepseek.apiKey ||
                 config.custom.apiKey ||
                 config.anthropic.apiKey;

  if (!apiKey) {
    console.log(chalk.red('\n❌ 错误：未配置 API Key\n'));
    console.log(chalk.yellow('请先配置 API Key：'));
    console.log(chalk.gray('  1. 方法一：运行 hireseek setup 进行配置'));
    console.log(chalk.gray('  2. 方法二：设置环境变量'));
    console.log(chalk.gray('     export DEEPSEEK_API_KEY="your-key"'));
    console.log(chalk.gray('  3. 方法三：编辑配置文件'));
    console.log(chalk.gray(`     ${path.join(config.workspace.dir, 'config.yaml')}\n`));
    process.exit(1);
  }

  // Base URL 与 API Key 来源保持一致（DeepSeek 优先）
  const usingDeepseek = Boolean(process.env.DEEPSEEK_API_KEY || config.deepseek.apiKey) &&
                        !process.env.CUSTOM_API_KEY;
  const baseURL = usingDeepseek
    ? config.deepseek.baseUrl
    : process.env.CUSTOM_BASE_URL ||
      process.env.ANTHROPIC_BASE_URL ||
      config.custom.baseUrl ||
      config.anthropic.baseUrl ||
      undefined;

  let model = process.env.LLM_MODEL || config.llm.model;

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
  ];

  // ── CC 风格输入体验：斜杠菜单 / Tab 补全 / 跨会话历史 ─────────────────
  const SLASH_COMMANDS: Array<{ cmd: string; desc: string }> = [
    { cmd: '/help', desc: '全部命令' },
    { cmd: '/status', desc: '模型 / 职位 / 浏览器状态' },
    { cmd: '/skills', desc: '技能列表' },
    { cmd: '/model', desc: '切换模型（flash/pro/自定义）' },
    { cmd: '/clear', desc: '清空对话上下文' },
    { cmd: '/export', desc: '导出会话' },
    { cmd: '/sessions', desc: '查看历史会话' },
    { cmd: '/q', desc: '退出' },
  ];

  let skillEntries: Array<{ cmd: string; desc: string }> = [];
  try {
    const { listSkills } = await import('./skill-system');
    skillEntries = listSkills().map(s => ({
      cmd: `/${s.name}`,
      desc: s.description.replace(/\s+/g, ' ').slice(0, 44),
    }));
  } catch { /* 技能加载失败不影响输入 */ }

  const allEntries = (): Array<{ cmd: string; desc: string }> => [...SLASH_COMMANDS, ...skillEntries];

  // 跨会话历史（↑↓ 回溯），存在数据库同目录
  const historyFile = path.join(path.dirname(config.db.path), 'chat_history.txt');
  let savedHistory: string[] = [];
  try {
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    savedHistory = fs.readFileSync(historyFile, 'utf-8')
      .split('\n').filter(Boolean).slice(-200).reverse();
  } catch { /* 无历史文件则从空开始 */ }

  const completer = (line: string): [string[], string] => {
    if (!line.startsWith('/')) return [[], line];
    const hits = allEntries().map(e => e.cmd).filter(c => c.startsWith(line));
    return [hits, line];
  };

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    completer,
    history: savedHistory,
    historySize: 200,
  });

  // 实时斜杠菜单：输入 / 时在光标下方浮现匹配项（Tab 补全选中）
  let menuShown = false;
  const renderSlashMenu = (): void => {
    if (!process.stdout.isTTY) return;
    const line = (rl as unknown as { line?: string }).line ?? '';

    if (menuShown) {
      // 清掉旧菜单：保存光标 → 下一行起清到屏底 → 恢复光标
      process.stdout.write('\x1b7\n\x1b[J\x1b8');
      menuShown = false;
    }

    if (!line.startsWith('/') || line.includes(' ')) return;
    const hits = allEntries().filter(e => e.cmd.toLowerCase().startsWith(line.toLowerCase())).slice(0, 5);
    if (hits.length === 0) return;

    process.stdout.write('\x1b7\n\x1b[J');
    for (const h of hits) {
      process.stdout.write(chalk.gray(`  ${h.cmd.padEnd(20)} ${h.desc}\n`));
    }
    process.stdout.write(chalk.dim('  ⇥ Tab 补全\n'));
    process.stdout.write('\x1b8');
    menuShown = true;
  };
  process.stdin.on('keypress', () => setImmediate(renderSlashMenu));

  // ── 极简启动（CC 风格：安静，信息在需要时出现）──────────────────────
  const job = loadActiveJob();
  console.log('');
  console.log(
    `${chalk.cyan.bold('🔱 HireSeek')} ${chalk.gray(`${model} · ${job?.title ?? '未配置职位'}`)}`,
  );
  console.log(chalk.gray(`   /help 命令 · /skills 技能 · Esc 打断 · Ctrl+C 两次退出`));

  const isFirstTime = !job || job.title === 'AI 算法工程师';
  if (isFirstTime) {
    console.log('');
    console.log(chalk.white('   还没配置职位——直接告诉我你想招什么人就行，'));
    console.log(chalk.white('   也可以丢给我 JD 文件路径或在线链接。'));
  }

  // 输入区分隔线：嵌入轻量状态（模型 · 今日触达），宽度自适应
  const todayContacted = (): number => {
    try {
      const row = db.prepare(
        `SELECT COUNT(*) AS n FROM candidates WHERE date(contacted_at) = date('now', 'localtime')`,
      ).get() as { n: number };
      return row.n;
    } catch {
      return 0;
    }
  };

  const promptHeader = (): string => {
    const info = ` ${model} · 今日触达 ${todayContacted()} `;
    const width = Math.min(process.stdout.columns || 60, 78);
    const pad = Math.max(4, width - info.length - 2);
    return chalk.gray(`\n──${info}${'─'.repeat(pad)}`);
  };

  // ── CC 风格交互：流式输出 / Ctrl+C 打断 / 双击退出 / Ctrl+D ───────────
  let generating: AbortController | null = null;
  let lastSigint = 0;
  let exiting = false;
  // 长任务插嘴/暂停状态
  let toolLoopActive = false;
  let interruptRequested = false;
  const pendingInterventions: string[] = [];

  const gracefulExit = async (): Promise<void> => {
    if (exiting) return;
    exiting = true;
    console.log(chalk.gray('\n\n正在保存本次对话记忆...'));
    try {
      await saveConversationMemory(client, model, messages);
    } catch { /* 保存失败不阻断退出 */ }
    console.log(chalk.gray('再见！🔱\n'));
    rl.close();
    process.exit(0);
  };

  // readline 激活时 Ctrl+C 触发的是 rl 的 SIGINT，不是 process 的
  rl.on('SIGINT', () => {
    if (generating) {
      generating.abort(); // 打断当前生成，回到输入框
      return;
    }
    if (toolLoopActive) {
      // 工具执行中（如浏览器动作等待）→ 请求暂停，当前动作完成后停下
      interruptRequested = true;
      console.log(chalk.yellow('\n⏸ 正在暂停任务（当前动作完成后停下）...'));
      return;
    }
    const now = Date.now();
    if (now - lastSigint < 2000) {
      void gracefulExit();
      return;
    }
    lastSigint = now;
    console.log(chalk.gray('\n(再按一次 Ctrl+C 退出，或输入 /q)'));
    ask();
  });

  // Ctrl+D（EOF）→ 优雅退出
  rl.on('close', () => {
    if (!exiting) void gracefulExit();
  });

  // Esc 单键中断（CC 同款）：生成中=打断；任务中=暂停；空闲=清空输入行
  process.stdin.on('keypress', (_s: unknown, key: { name?: string } | undefined) => {
    if (key?.name !== 'escape') return;
    if (generating) {
      generating.abort();
      return;
    }
    if (toolLoopActive) {
      interruptRequested = true;
      console.log(chalk.yellow('\n⏸ 正在暂停任务（当前动作完成后停下）...'));
      return;
    }
    // 空闲：清空已敲的半行输入
    const r = rl as unknown as { line: string; cursor: number; _refreshLine?: () => void };
    if (r.line) {
      r.line = '';
      r.cursor = 0;
      r._refreshLine?.();
    }
  });

  const EXIT_WORDS = new Set(['exit', 'quit', 'q', '退出', '/exit', '/quit', '/q']);

  const printHelp = (): void => {
    console.log([
      '',
      chalk.bold('命令：'),
      chalk.gray('  /q | /exit | 退出   结束对话（Ctrl+C 两次、Ctrl+D 同效）'),
      chalk.gray('  /clear              清空对话上下文，重新开始'),
      chalk.gray('  /status             模型 / 职位 / 数据库状态'),
      chalk.gray('  /model [名称]       切换模型（不带参数弹选择器）'),
      chalk.gray('  /skills             列出全部可用技能'),
      chalk.gray('  /export [标题]      导出会话      /sessions  查看会话'),
      chalk.gray('  /<技能名> [参数]    直接触发技能，如 /rbt、/找候选人'),
      chalk.gray('  Esc                 打断生成 / 暂停任务 / 清空输入（Ctrl+C 同效）'),
      '',
    ].join('\n'));
  };

  // ── 多行输入：粘贴自动合并 + 反斜杠续行 ───────────────────────────────
  /**
   * 粘贴一整段 JD 时终端会把每行作为独立 line 事件瞬间连发。
   * 收到首行后开 50ms 窗口收集后续行——人类打字间隔远大于 50ms，不会误合并。
   */
  const mergePastedLines = (first: string): Promise<string> =>
    new Promise(resolve => {
      const lines = [first];
      let timer: NodeJS.Timeout;
      const done = (): void => {
        rl.off('line', onLine);
        if (lines.length > 1) {
          console.log(chalk.gray(`  📋 已合并 ${lines.length} 行粘贴内容`));
        }
        resolve(lines.join('\n'));
      };
      const onLine = (l: string): void => {
        lines.push(l);
        clearTimeout(timer);
        timer = setTimeout(done, 50);
      };
      rl.on('line', onLine);
      timer = setTimeout(done, 50);
    });

  /** 反斜杠结尾 → 续行输入（… 提示符） */
  const readFullInput = async (first: string): Promise<string> => {
    let text = (await mergePastedLines(first)).trim();
    while (text.endsWith('\\')) {
      const more = await new Promise<string>(res => rl.question(chalk.gray('… '), res));
      text = `${text.slice(0, -1)}\n${await mergePastedLines(more)}`.trim();
    }
    return text;
  };

  /** 工具调用的人话显示：HR 看到的是动作含义，不是函数名 */
  const toolLabel = (name: string, args: Record<string, unknown>): string => {
    const short = (v: unknown, n = 40) => String(v ?? '').slice(0, n);
    switch (name) {
      case 'browser_connect':  return '🌐 连接浏览器';
      case 'browser_snapshot': return '🌐 读取页面';
      case 'browser_act': {
        const a = String(args.action ?? '');
        if (a === 'click')  return `🌐 点击 [${args.ref}]`;
        if (a === 'type')   return `🌐 输入「${short(args.text, 20)}」`;
        if (a === 'goto')   return `🌐 打开 ${short(args.url, 50)}`;
        if (a === 'press')  return `🌐 按键 ${args.text ?? 'Enter'}`;
        if (a === 'scroll') return `🌐 滚动页面`;
        if (a === 'wait')   return `🌐 等待加载`;
        return `🌐 ${a}`;
      }
      case 'ask_user_choice':  return `🔘 ${short(args.question, 30)}`;
      case 'manage_schedule': {
        const a = String(args.action ?? 'list');
        if (a === 'list') return '⏰ 查看定时计划';
        if (a === 'disable') return `⏰ 关闭计划「${args.task}」`;
        if (a === 'enable') return `⏰ 恢复计划「${args.task}」`;
        return `⏰ 调整计划「${args.task}」`;
      }
      case 'use_recruiting_skill':
        return args.list ? '📋 查看技能清单' : `📋 调用技能「${args.skill_name ?? ''}」`;
      case 'run_sourcing':     return `🔍 启动寻源${args.channel ? `（${args.channel}）` : ''}`;
      case 'scan_inbox':       return '📥 扫描收件箱';
      case 'get_funnel':       return '📊 查看招聘漏斗';
      case 'update_candidate': return `✏️ 更新候选人 ${short(args.name, 12)}`;
      case 'list_candidates':  return '👥 查看候选人列表';
      case 'search_candidate': return `👥 查找候选人 ${short(args.name ?? args.keyword, 12)}`;
      case 'feishu_recruiting_stats': return '📊 读取飞书招聘数据';
      case 'web_search':       return `🔎 搜索「${short(args.query, 24)}」`;
      case 'read_pdf':         return `📄 读取简历 ${short(args.path ?? args.file_path, 36)}`;
      case 'run_shell':        return `🖥 ${short(args.command, 48)}`;
      case 'write_file':       return `📝 写入 ${short(args.path ?? args.filename, 36)}`;
      case 'read_file':        return `📖 读取 ${short(args.path ?? args.filename, 36)}`;
      case 'remember':         return '🧠 记下偏好';
      case 'recall_memory':    return '🧠 回忆上下文';
      default:                 return `⚙ ${name}`;
    }
  };

  /** 一轮流式请求：边生成边输出，返回完整 message（含工具调用） */
  const streamRound = async (): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> => {
    generating = new AbortController();
    let firstChunk = true;
    process.stdout.write(chalk.gray('✻ 思考中'));
    const spinner = setInterval(() => {
      if (firstChunk) process.stdout.write(chalk.gray('·'));
    }, 400);

    try {
      const stream = client.beta.chat.completions.stream(
        { model, messages, tools: CHAT_TOOLS, tool_choice: 'auto', max_tokens: 4096 },
        { signal: generating.signal },
      );

      stream.on('content', (delta) => {
        if (firstChunk) {
          process.stdout.write(`\r\x1b[K${chalk.cyan('HireSeek')}: `);
          firstChunk = false;
        }
        process.stdout.write(delta);
      });

      const completion = await stream.finalChatCompletion();
      if (firstChunk) {
        process.stdout.write('\r\x1b[K'); // 纯工具调用轮，清掉思考提示
      } else {
        process.stdout.write('\n');
      }
      return completion.choices[0].message;
    } finally {
      clearInterval(spinner);
      generating = null;
    }
  };

  const ask = (): void => {
    if (exiting) return;
    // 分隔线独立打印：prompt 保持单行，↑↓ 历史回溯时重绘才不会乱
    console.log(promptHeader());
    rl.question(chalk.green('❯ '), async (input) => {
      // 清掉斜杠菜单残留
      if (process.stdout.isTTY) process.stdout.write('\x1b[J');
      menuShown = false;

      let text = await readFullInput(input);
      if (!text) { ask(); return; }

      // 单独输入 / → 弹出命令选择器（方向键选，不用记命令名）
      if (text === '/') {
        const { selectOption } = await import('./select');
        const entries = allEntries().slice(0, 10);
        const picked = await selectOption(
          '选择命令',
          entries.map(e => ({ label: e.cmd, hint: e.desc })),
        );
        if (picked == null) { ask(); return; }
        text = entries[picked].cmd;
      }

      // 写入跨会话历史（多行压平成单行，↑ 调出时仍可直接复用）
      try {
        fs.appendFileSync(historyFile, text.replace(/\n/g, ' ') + '\n');
      } catch { /* 历史写入失败不影响对话 */ }

      // 退出命令
      if (EXIT_WORDS.has(text.toLowerCase())) {
        await gracefulExit();
        return;
      }

      // 帮助
      if (text === '/help' || text === '/h' || text === '?') {
        printHelp();
        ask();
        return;
      }

      // 清空上下文（保留 system prompt）
      if (text === '/clear') {
        messages.length = 1;
        console.log(chalk.gray('\n✓ 上下文已清空，重新开始\n'));
        ask();
        return;
      }

      // 状态
      if (text === '/status') {
        const activeJob = loadActiveJob();
        const { listClaudeSkills } = await import('./skills/claude-skills');
        const { browserStatus } = await import('./chat-browser');
        console.log([
          '',
          chalk.bold('状态：'),
          chalk.gray(`  模型      ${model}（${config.llm.provider}）`),
          chalk.gray(`  职位      ${activeJob?.title ?? '未配置'}`),
          chalk.gray(`  浏览器    ${browserStatus()}`),
          chalk.gray(`  数据库    ${db.name}`),
          chalk.gray(`  技能      ${listClaudeSkills().length} 个已接管`),
          chalk.gray(`  上下文    ${messages.length} 条消息`),
          '',
        ].join('\n'));
        ask();
        return;
      }

      // 切换模型（会话内即时生效 + 持久化到 .env）
      if (text === '/model' || text.startsWith('/model ')) {
        const direct = text.slice(6).trim();
        const MODEL_CHOICES = [
          { label: 'deepseek-v4-flash', hint: '快 · 省 · 日常对话与浏览器操作（默认）' },
          { label: 'deepseek-v4-pro', hint: '深推理 · 候选人评估与复盘策略' },
          { label: '自定义…', hint: '手动输入任意模型名' },
        ];

        let next = direct;
        if (!next) {
          const { selectOption } = await import('./select');
          const picked = await selectOption('切换到哪个模型？', MODEL_CHOICES.map(c => ({
            label: c.label === model ? `${c.label}（当前）` : c.label,
            hint: c.hint,
          })));
          if (picked == null) { ask(); return; }
          if (MODEL_CHOICES[picked].label === '自定义…') {
            next = (await new Promise<string>(res => rl.question(chalk.gray('模型名: '), res))).trim();
            if (!next) { ask(); return; }
          } else {
            next = MODEL_CHOICES[picked].label;
          }
        }

        if (next === model) {
          console.log(chalk.gray(`\n已经在用 ${model} 了\n`));
          ask();
          return;
        }

        model = next;
        // 持久化到 .env，下次启动沿用
        try {
          const envPath = path.join(process.cwd(), '.env');
          let raw = '';
          try { raw = fs.readFileSync(envPath, 'utf-8'); } catch { /* 无 .env 则新建 */ }
          raw = /^LLM_MODEL=.*/m.test(raw)
            ? raw.replace(/^LLM_MODEL=.*/m, `LLM_MODEL=${next}`)
            : raw + (raw === '' || raw.endsWith('\n') ? '' : '\n') + `LLM_MODEL=${next}\n`;
          fs.writeFileSync(envPath, raw);
          console.log(chalk.gray(`\n✓ 已切换到 ${chalk.white(next)}（已保存，下次启动沿用）\n`));
        } catch {
          console.log(chalk.gray(`\n✓ 已切换到 ${chalk.white(next)}（仅本次会话，.env 写入失败）\n`));
        }
        ask();
        return;
      }

      // 技能列表
      if (text === '/skills') {
        const { formatSkillList } = await import('./skill-system');
        console.log('\n' + formatSkillList() + '\n');
        ask();
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
      const { parseSkillInvocation, executeSkill, loadSkill: loadChatSkill } = await import('./skill-system');
      const skillInvocation = parseSkillInvocation(text);

      let userMessage = text;

      if (skillInvocation.isSkill) {
        // 未知斜杠命令本地拦截：给就近推荐，不浪费一次模型调用
        if (!loadChatSkill(skillInvocation.skillName)) {
          const near = allEntries()
            .filter(e => e.cmd.toLowerCase().includes(skillInvocation.skillName.toLowerCase().slice(0, 4)))
            .slice(0, 5);
          console.log(chalk.yellow(`\n未找到命令 /${skillInvocation.skillName}`));
          if (near.length > 0) {
            console.log(chalk.gray('你是不是想找：'));
            for (const n of near) console.log(chalk.gray(`  ${n.cmd.padEnd(20)} ${n.desc}`));
          } else {
            console.log(chalk.gray('输入 / 后按 Tab 查看全部命令，或 /skills 查看技能列表'));
          }
          ask();
          return;
        }
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

      // 长任务期间用户可以直接敲字插话（无需等任务结束）
      const onIntervene = (line: string): void => {
        const t = line.trim();
        if (!t) return;
        pendingInterventions.push(t);
        console.log(chalk.gray('  ✋ 已收到插话，当前动作完成后立即生效'));
      };

      /** 一个完整回合：流式生成 + 工具循环（含暂停/插话处理） */
      const runTurn = async (): Promise<void> => {
        let msg = await streamRound();
        messages.push(msg);

        while (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

          for (const call of msg.tool_calls) {
            const args = JSON.parse(call.function.arguments || '{}');
            console.log(chalk.gray(`  ${toolLabel(call.function.name, args)}`));
            const result = await executeTool(call.function.name, args);
            toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
          }

          messages.push(...toolResults);

          // Ctrl+C 暂停：停下任务，简短汇报后把控制权还给用户
          if (interruptRequested) {
            interruptRequested = false;
            messages.push({
              role: 'user',
              content: '[系统] 用户暂停了任务。立即停止当前流程（不要再调用工具），用 2-3 句话汇报目前进度（已完成什么/进行到哪），然后等待用户指示。',
            });
            msg = await streamRound();
            messages.push(msg);
            break;
          }

          // 用户插话：注入对话，模型下一轮立即响应
          if (pendingInterventions.length > 0) {
            const note = pendingInterventions.splice(0)
              .map(s => `[用户插话] ${s}`).join('\n');
            messages.push({ role: 'user', content: note });
          }

          msg = await streamRound();
          messages.push(msg);
        }
      };

      try {
        console.log('');
        toolLoopActive = true;
        rl.on('line', onIntervene);

        await runTurn();

        // 最终回答期间敲入的插话不能丢——作为新回合继续处理
        while (pendingInterventions.length > 0) {
          const note = pendingInterventions.splice(0)
            .map(s => `[用户插话] ${s}`).join('\n');
          messages.push({ role: 'user', content: note });
          await runTurn();
        }

      } catch (err: any) {
        if (err?.name === 'APIUserAbortError' || generating === null && err?.message?.includes('abort')) {
          console.log(chalk.yellow('\n⎋ 已打断'));
        } else {
          console.error(chalk.red(`\n出错了: ${err.message}\n`));
        }
      } finally {
        rl.off('line', onIntervene);
        toolLoopActive = false;
        interruptRequested = false;
        pendingInterventions.length = 0;
      }

      ask();
    });
  };

  ask();
}
