/**
 * 共享 agent 会话 —— 网页指挥台与飞书 Bot 共用的"大脑"
 *
 * 终端 chat 模式（startChat）有自己的流式交互循环；而无头入口（飞书 Bot、
 * 网页指挥台）需要的是一个纯函数式的回合：喂一句用户的话，跑完含 tool-call
 * 的循环，吐出给用户的最终回复。这里把那段逻辑收成一处，两个入口共用同一套
 * 系统提示、同一批工具、同一种历史折叠策略——避免飞书改一遍、网页再改一遍。
 */

import OpenAI from 'openai';
import { config } from './config';
import { buildSystemPrompt, CHAT_TOOLS, executeTool, describeToolCall } from './chat';
import { repairToolMessageHistoryInPlace } from './message-integrity';
import { saveAgentSessionMessages } from './agent-core/session-store';
import { offloadToolResultForContext } from './agent-core/tool-output-store';

const MAX_HISTORY = 24;   // 系统提示之外保留的最近消息条数
const MAX_ROUNDS  = 30;   // 单次回复内最多 tool-call 轮数

export interface AgentSession {
  id: string;
  title: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  busy: boolean;
}

export function createSession(): AgentSession {
  const created = new Date().toISOString();
  return {
    id: `agent-${created.replace(/[:.]/g, '-')}`,
    title: `Agent 会话-${new Date().toLocaleString('zh-CN')}`,
    messages: [{ role: 'system', content: buildSystemPrompt() }],
    busy: false,
  };
}

function pruneHistory(s: AgentSession): void {
  if (s.messages.length <= MAX_HISTORY + 1) return;
  const system = s.messages[0];
  const recent = s.messages.slice(-MAX_HISTORY);
  s.messages = [system, { role: 'user', content: '[较早的对话已折叠]' }, ...recent];
  repairToolMessageHistoryInPlace(s.messages);
}

// ── LLM 客户端解析（与 chat 主循环同源，DeepSeek 优先）─────────────────
export function resolveLLM(): { client: OpenAI; model: string } {
  const usingDeepseek =
    Boolean(process.env.DEEPSEEK_API_KEY || config.deepseek.apiKey) &&
    !process.env.CUSTOM_API_KEY;

  const apiKey =
    process.env.DEEPSEEK_API_KEY ||
    process.env.CUSTOM_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    config.deepseek.apiKey ||
    config.custom.apiKey ||
    config.anthropic.apiKey;

  const baseURL = usingDeepseek
    ? config.deepseek.baseUrl
    : process.env.CUSTOM_BASE_URL ||
      process.env.ANTHROPIC_BASE_URL ||
      config.custom.baseUrl ||
      config.anthropic.baseUrl ||
      undefined;

  const model = process.env.LLM_MODEL || config.llm.model;
  return { client: new OpenAI({ apiKey, baseURL }), model };
}

export interface TurnOptions {
  /** 每次工具调用前回报一句人话（网页据此流式显示"它正在做什么"）。 */
  onStep?: (label: string) => void;
}

/** 跑一轮含 tool-call 的对话，产出给用户的文字回复。 */
export async function runAgentTurn(
  session: AgentSession,
  userText: string,
  opts: TurnOptions = {},
): Promise<string> {
  const { client, model } = resolveLLM();

  session.messages.push({ role: 'user', content: userText });
  pruneHistory(session);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    repairToolMessageHistoryInPlace(session.messages);
    const res = await client.chat.completions.create({
      model,
      messages: session.messages,
      tools: CHAT_TOOLS,
      tool_choice: 'auto',
      max_tokens: 4096,
    });

    const msg = res.choices[0].message;
    session.messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      try {
        saveAgentSessionMessages({
          sessionId: session.id,
          title: session.title,
          source: 'agent-session',
          messages: session.messages,
        });
      } catch { /* 会话持久化失败不影响回复 */ }
      return msg.content ?? '（没有可回复的内容）';
    }

    for (const call of msg.tool_calls) {
      let parsedArgs: Record<string, unknown> = {};
      try { parsedArgs = JSON.parse(call.function.arguments || '{}'); } catch { /* 参数非 JSON */ }

      if (opts.onStep) opts.onStep(describeToolCall(call.function.name, parsedArgs));

      let output: string;
      try {
        output = await executeTool(call.function.name, parsedArgs, {
          sessionId: session.id,
          toolCallId: call.id,
        });
      } catch (err) {
        output = `工具执行失败：${err instanceof Error ? err.message : err}`;
      }
      output = offloadToolResultForContext({
        content: output,
        toolName: call.function.name,
        sessionId: session.id,
        toolCallId: call.id,
        kind: 'agent-session-tool-result',
      }).content;
      session.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }

  const finalText = `这件事调用了很多步还没收尾（已达 ${MAX_ROUNDS} 轮上限），我先停一下。要不要把任务拆细一点再让我继续？`;
  try {
    saveAgentSessionMessages({
      sessionId: session.id,
      title: session.title,
      source: 'agent-session',
      messages: session.messages,
    });
  } catch { /* 会话持久化失败不影响回复 */ }
  return finalText;
}
