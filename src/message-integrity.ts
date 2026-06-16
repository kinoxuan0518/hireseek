import type OpenAI from 'openai';

export interface MessageRepairStats {
  changed: boolean;
  insertedToolResults: number;
  droppedToolMessages: number;
}

function toolCallsOf(msg: OpenAI.ChatCompletionMessageParam): any[] {
  const calls = (msg as any).tool_calls;
  return Array.isArray(calls) ? calls : [];
}

function missingToolMessage(call: any): OpenAI.ChatCompletionToolMessageParam {
  const name = call?.function?.name || 'unknown_tool';
  return {
    role: 'tool',
    tool_call_id: call.id,
    content: `工具调用未完成：上次会话在执行 ${name} 时中断或出错，没有可用结果。`,
  };
}

/**
 * OpenAI-compatible chat APIs require every assistant tool_call to be followed
 * immediately by matching tool messages. Interrupted runs, failed tool parsing,
 * and naive history pruning can break that invariant. This repairs old history
 * without inventing successful tool output.
 */
export function repairToolMessageHistory(
  input: OpenAI.ChatCompletionMessageParam[],
): { messages: OpenAI.ChatCompletionMessageParam[]; stats: MessageRepairStats } {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  const stats: MessageRepairStats = {
    changed: false,
    insertedToolResults: 0,
    droppedToolMessages: 0,
  };

  for (let i = 0; i < input.length; i++) {
    const msg = input[i];
    const calls = msg.role === 'assistant' ? toolCallsOf(msg) : [];

    if (msg.role === 'tool') {
      stats.changed = true;
      stats.droppedToolMessages++;
      continue;
    }

    if (calls.length === 0) {
      messages.push(msg);
      continue;
    }

    messages.push(msg);

    const expected = new Set(calls.map(call => call.id).filter(Boolean));
    const seen = new Map<string, OpenAI.ChatCompletionMessageParam>();
    let j = i + 1;

    while (j < input.length && input[j].role === 'tool') {
      const tool = input[j] as any;
      const id = typeof tool.tool_call_id === 'string' ? tool.tool_call_id : '';
      if (id && expected.has(id) && !seen.has(id)) {
        seen.set(id, input[j]);
      } else {
        stats.changed = true;
        stats.droppedToolMessages++;
      }
      j++;
    }

    for (const call of calls) {
      const existing = call?.id ? seen.get(call.id) : undefined;
      if (existing) {
        messages.push(existing);
      } else if (call?.id) {
        messages.push(missingToolMessage(call));
        stats.changed = true;
        stats.insertedToolResults++;
      }
    }

    i = j - 1;
  }

  return { messages, stats };
}

export function repairToolMessageHistoryInPlace(
  messages: OpenAI.ChatCompletionMessageParam[],
): MessageRepairStats {
  const repaired = repairToolMessageHistory(messages);
  if (repaired.stats.changed) {
    messages.length = 0;
    messages.push(...repaired.messages);
  }
  return repaired.stats;
}
