/**
 * 共享 agent 会话 —— 网页指挥台与飞书 Bot 共用的"大脑"
 *
 * 终端 chat、飞书 Bot、网页指挥台都走同一套 DSH Agent Loop：
 * 同一份系统提示、同一条工具管线、同一份 Session Log。
 */

import OpenAI from 'openai';
import { buildSystemPrompt, describeToolCall, ensureChatRuntimeBound } from './chat';
import { repairToolMessageHistoryInPlace } from './message-integrity';
import { getHarness } from './runtime';
import { resolveLLM } from './plugins/llm-openai';

const MAX_HISTORY = 24;
const MAX_ROUNDS = 30;

export interface AgentSession {
  id: string;
  title: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  busy: boolean;
}

export function createSession(): AgentSession {
  ensureChatRuntimeBound();
  const created = new Date().toISOString();
  const harness = getHarness('headless');
  const session = harness.sessions.create({
    id: `agent-${created.replace(/[:.]/g, '-')}`,
    title: `Agent 会话-${new Date().toLocaleString('zh-CN')}`,
    source: 'agent-session',
  });
  session.ensureSystem(buildSystemPrompt());
  return {
    id: session.id,
    title: session.title,
    messages: session.deriveMessages(),
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

export { resolveLLM };

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
  ensureChatRuntimeBound();
  const harness = getHarness('headless');
  pruneHistory(session);
  const live = harness.sessions.get(session.id) ?? harness.sessions.create({
    id: session.id,
    title: session.title,
    source: 'agent-session',
  });
  live.title = session.title;
  repairToolMessageHistoryInPlace(session.messages);
  live.hydrate(session.messages);

  const result = await harness.loop.runTurn({
    session: live,
    input: userText,
    maxSteps: MAX_ROUNDS,
    kind: 'agent-session-tool-result',
    source: 'agent-session',
    preserveSystem: true,
    onBeforeTool: (name, args) => {
      if (opts.onStep) opts.onStep(describeToolCall(name, args));
    },
  });

  session.messages = live.deriveMessages();
  return result.text;
}
