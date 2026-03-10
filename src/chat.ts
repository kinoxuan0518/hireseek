/**
 * HireClaw Chat 模式
 * 让用户和 HireClaw 自然对话，同时能触发执行动作。
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
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
    const res = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: 'user',
          content: `请用 2-3 句话总结我们刚才这次对话的核心内容（第三人称，如"用户问了..."）。
然后另起一行，列出 1-3 个关键点（以"关键点："开头，逗号分隔），这些是下次对话应该记住的。
格式：
[总结]
关键点：[点1]，[点2]`,
        },
      ],
      max_tokens: 300,
    });

    const text = res.choices[0]?.message?.content ?? '';
    const [summaryPart, highlightsPart] = text.split(/关键点[：:]/);
    conversationOps.save.run({
      job_id:     jobId,
      summary:    summaryPart?.trim() ?? text,
      highlights: highlightsPart?.trim() ?? '',
    });
  } catch {
    // 保存失败不影响退出
  }
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
