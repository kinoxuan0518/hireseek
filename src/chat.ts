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
import { config } from './config';
import { loadWorkspaceFile, loadActiveJob, jobToPrompt } from './skills/loader';
import { buildMemoryContext, buildConversationMemory } from './memory';
import { candidateOps, conversationOps, db } from './db';
import { runChannel, runJob, scanInbox } from './orchestrator';
import { webSearch } from './search';
import type { Channel } from './types';

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
];

// ── 工具执行 ─────────────────────────────────────────────
async function executeTool(name: string, args: any): Promise<string> {
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

  return [soul, wisdom, jobCtx, memory, convMem, chatGuide].filter(Boolean).join('\n\n---\n\n');
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
  const client = new OpenAI({
    apiKey:  config.custom.apiKey || config.anthropic.apiKey,
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

  console.log(chalk.cyan('\n🦞 HireClaw 对话模式'));
  console.log(chalk.gray('直接说话，输入 exit 退出\n'));

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
      if (text === 'exit' || text === '退出') {
        console.log(chalk.gray('\n正在保存本次对话记忆...'));
        await saveConversationMemory(client, model, messages);
        console.log(chalk.gray('再见！\n'));
        rl.close();
        return;
      }

      messages.push({ role: 'user', content: text });

      // 超过 30 条时原地压缩（避免内存无限增长）
      if (messages.length > 30) {
        const pruned = pruneMessages(messages, 20);
        messages.length = 0;
        messages.push(...pruned);
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
