/**
 * Sub-Agent：后台任务执行器（CC 风格）
 *
 * 主对话把耗时工作（批量候选人调研、报告整理、跨渠道数据核对）派给
 * 后台 sub-agent，自己继续服务用户。完成后在下一次输入前推送通知。
 *
 * 设计约束：
 * - 独立上下文：每个任务有自己的消息历史，不污染主对话
 * - 受限工具集：不能弹选择器/问用户问题（后台不抢交互），不能再派子任务（不嵌套）
 * - 可取消：/tasks stop <id> 通过 AbortController 立即生效
 */

import OpenAI from 'openai';
import { config } from './config';

export interface SubTask {
  id: number;
  label: string;
  task: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  /** 最近执行的动作（滚动保留 12 条） */
  actions: string[];
  result?: string;
  error?: string;
  controller: AbortController;
}

const tasks = new Map<number, SubTask>();
let nextId = 1;

/** 待推送给用户的完成通知（主循环在下一次输入前取走） */
const notifications: string[] = [];

export function drainNotifications(): string[] {
  return notifications.splice(0, notifications.length);
}

/** 实时通知回调（chat 注册后任务完成立即推送；未注册则进队列） */
let notifier: ((msg: string) => void) | null = null;

export function setNotifier(fn: (msg: string) => void): void {
  notifier = fn;
}

/** 后台任务可用的工具白名单（无交互类、无嵌套派发） */
const ALLOWED_TOOLS = new Set([
  'browser_connect', 'browser_snapshot', 'browser_act',
  'run_shell', 'read_file', 'write_file', 'glob', 'grep',
  'web_search', 'read_pdf',
  'list_candidates', 'search_candidate', 'update_candidate', 'get_funnel',
  'feishu_recruiting_stats', 'use_recruiting_skill', 'manage_schedule',
]);

const MAX_ROUNDS = 40;

const SUB_AGENT_SYSTEM = `
你是 HireSeek 的后台执行 agent，独立完成主对话派来的一项任务。

规则：
1. 你在后台运行，**没有任何向用户提问的渠道**——遇到歧义自己做合理假设并在结果中说明
2. 专注本任务，不做任务外的事；尽量少的工具调用完成目标
3. 任务完成后，直接输出**给 HR 看的结果总结**（招聘语言，不说技术词），
   关键数字和名单放前面
4. 无法完成时，说明卡在哪、已完成哪部分、建议人工怎么接手
`.trim();

export function spawnSubAgent(opts: { task: string; label: string; model?: string }): SubTask {
  const t: SubTask = {
    id: nextId++,
    label: opts.label.slice(0, 30),
    task: opts.task,
    status: 'running',
    startedAt: Date.now(),
    actions: [],
    controller: new AbortController(),
  };
  tasks.set(t.id, t);

  void runLoop(t, opts.model);
  return t;
}

async function runLoop(t: SubTask, modelOverride?: string): Promise<void> {
  try {
    // 运行时引入，避免与 chat.ts 的静态循环依赖
    const { CHAT_TOOLS, executeTool } = await import('./chat');

    const client = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseUrl,
    });
    const model = modelOverride || config.deepseek.model;

    const tools = CHAT_TOOLS.filter(
      d => d.type === 'function' && ALLOWED_TOOLS.has(d.function.name),
    );

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SUB_AGENT_SYSTEM },
      { role: 'user', content: t.task },
    ];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (t.controller.signal.aborted) {
        t.status = 'cancelled';
        break;
      }

      const res = await client.chat.completions.create(
        { model, messages, tools, tool_choice: 'auto', max_tokens: 4096 },
        { signal: t.controller.signal },
      );

      const msg = res.choices[0].message;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        t.result = msg.content ?? '（无总结）';
        t.status = 'done';
        break;
      }

      for (const call of msg.tool_calls) {
        const name = call.function.name;
        recordAction(t, name, call.function.arguments);

        let output: string;
        if (!ALLOWED_TOOLS.has(name)) {
          output = '后台任务不能使用该工具，请换其他方式或在总结中说明此限制。';
        } else {
          try {
            output = await executeTool(name, JSON.parse(call.function.arguments || '{}'));
          } catch (err) {
            output = `工具执行失败：${err instanceof Error ? err.message : err}`;
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }

    if (t.status === 'running') {
      t.status = 'failed';
      t.error = `超过最大执行轮数（${MAX_ROUNDS}），已停止`;
    }
  } catch (err) {
    if (t.controller.signal.aborted) {
      t.status = 'cancelled';
    } else {
      t.status = 'failed';
      t.error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    t.finishedAt = Date.now();
    const msg = formatNotification(t);
    if (notifier) notifier(msg);
    else notifications.push(msg);
  }
}

function recordAction(t: SubTask, name: string, rawArgs: string): void {
  let detail = '';
  try {
    const a = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    detail = String(a.action ?? a.query ?? a.skill_name ?? a.command ?? '').slice(0, 24);
  } catch { /* 参数解析失败只记工具名 */ }
  t.actions.push(detail ? `${name}(${detail})` : name);
  if (t.actions.length > 12) t.actions.shift();
}

function elapsed(t: SubTask): string {
  const sec = Math.round(((t.finishedAt ?? Date.now()) - t.startedAt) / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
}

const STATUS_ICON: Record<SubTask['status'], string> = {
  running: '🔄',
  done: '✅',
  failed: '❌',
  cancelled: '⏹',
};

function formatNotification(t: SubTask): string {
  if (t.status === 'done') {
    return `🔔 后台任务 #${t.id}「${t.label}」完成（${elapsed(t)}）：\n${(t.result ?? '').slice(0, 600)}`;
  }
  if (t.status === 'cancelled') {
    return `🔔 后台任务 #${t.id}「${t.label}」已取消`;
  }
  return `🔔 后台任务 #${t.id}「${t.label}」失败：${t.error ?? '未知原因'}`;
}

export function getTask(id: number): SubTask | null {
  return tasks.get(id) ?? null;
}

export function runningCount(): number {
  return Array.from(tasks.values()).filter(t => t.status === 'running').length;
}

export function stopTask(id: number): string {
  const t = tasks.get(id);
  if (!t) return `没有 #${id} 这个任务`;
  if (t.status !== 'running') return `任务 #${id} 已是 ${t.status} 状态，无需停止`;
  t.controller.abort();
  return `⏹ 已发出停止信号：#${id}「${t.label}」`;
}

/** 任务面板（/tasks 与 check_tasks 共用） */
export function tasksPanel(): string {
  if (tasks.size === 0) return '暂无后台任务。让我把耗时工作派到后台即可，例如："后台帮我调研这5个候选人"';

  const lines: string[] = [];
  for (const t of Array.from(tasks.values()).reverse()) {
    lines.push(`${STATUS_ICON[t.status]} #${t.id} ${t.label} · ${elapsed(t)}`);
    if (t.status === 'running' && t.actions.length > 0) {
      lines.push(`   正在：${t.actions[t.actions.length - 1]}`);
    }
    if (t.status === 'done' && t.result) {
      lines.push(`   ${t.result.slice(0, 150).replace(/\n/g, ' ')}`);
    }
    if (t.status === 'failed' && t.error) {
      lines.push(`   原因：${t.error.slice(0, 100)}`);
    }
  }
  lines.push('');
  lines.push('停止：/tasks stop <id>　查看详情：/tasks <id>');
  return lines.join('\n');
}

/** 单任务详情 */
export function taskDetail(id: number): string {
  const t = tasks.get(id);
  if (!t) return `没有 #${id} 这个任务`;
  return [
    `${STATUS_ICON[t.status]} #${t.id}「${t.label}」 ${t.status} · ${elapsed(t)}`,
    `任务：${t.task.slice(0, 200)}`,
    t.actions.length > 0 ? `动作轨迹：${t.actions.join(' → ')}` : '',
    t.result ? `结果：\n${t.result}` : '',
    t.error ? `错误：${t.error}` : '',
  ].filter(Boolean).join('\n');
}
