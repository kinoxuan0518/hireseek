/**
 * 上下文自动压缩
 * 类似 Claude Code 的自动压缩机制
 * 当对话历史接近上下文限制时，智能压缩保留重要信息
 */

import type OpenAI from 'openai';

export interface CompressionOptions {
  maxTokens: number;          // 最大 token 数（触发压缩阈值）
  targetTokens: number;        // 压缩后的目标 token 数
  preserveRecent: number;      // 保留最近 N 轮对话
  preserveSystem: boolean;     // 是否保留系统提示
}

const DEFAULT_OPTIONS: CompressionOptions = {
  maxTokens: 180000,          // Claude Sonnet 4.5 的上下文窗口是 200K
  targetTokens: 100000,        // 压缩后保持在 100K 左右
  preserveRecent: 10,          // 保留最近 10 轮对话
  preserveSystem: true,        // 始终保留系统提示
};

/**
 * 估算消息的 token 数量
 * 简化估算：1 token ≈ 4 个字符（中文约 1.5 字符）
 */
export function estimateTokens(messages: OpenAI.ChatCompletionMessageParam[]): number {
  let totalChars = 0;

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    totalChars += content.length;
  }

  // 中英文混合，使用折中估算
  return Math.ceil(totalChars / 3);
}

/**
 * 检查是否需要压缩
 */
export function shouldCompress(
  messages: OpenAI.ChatCompletionMessageParam[],
  options: Partial<CompressionOptions> = {}
): boolean {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const tokens = estimateTokens(messages);

  return tokens > opts.maxTokens;
}

/**
 * 提取重要消息（用于压缩摘要）
 */
function extractImportantMessages(
  messages: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
  const important: OpenAI.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

    // 保留包含重要关键词的消息
    if (
      content.includes('错误') ||
      content.includes('失败') ||
      content.includes('成功') ||
      content.includes('完成') ||
      content.includes('决策') ||
      content.includes('计划') ||
      content.includes('重要') ||
      content.includes('关键')
    ) {
      important.push(msg);
    }

    // 保留工具调用结果
    if (msg.role === 'tool') {
      important.push(msg);
    }
  }

  return important;
}

/**
 * 生成对话摘要
 */
function summarizeConversation(
  messages: OpenAI.ChatCompletionMessageParam[]
): string {
  const summary: string[] = [];

  // 按角色统计
  const userMessages = messages.filter(m => m.role === 'user').length;
  const assistantMessages = messages.filter(m => m.role === 'assistant').length;
  const toolCalls = messages.filter(m => m.role === 'tool').length;

  summary.push(`对话统计：用户消息 ${userMessages} 条，AI 回复 ${assistantMessages} 条，工具调用 ${toolCalls} 次`);

  // 提取主题
  const topics = new Set<string>();
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (content.includes('候选人')) topics.add('候选人管理');
    if (content.includes('sourcing')) topics.add('候选人寻找');
    if (content.includes('git') || content.includes('commit')) topics.add('代码管理');
    if (content.includes('计划') || content.includes('plan')) topics.add('计划制定');
    if (content.includes('任务') || content.includes('task')) topics.add('任务管理');
  }

  if (topics.size > 0) {
    summary.push(`讨论主题：${Array.from(topics).join('、')}`);
  }

  // 提取关键决策
  const important = extractImportantMessages(messages);
  if (important.length > 0) {
    summary.push(`关键事件 ${important.length} 个（已保留详细内容）`);
  }

  return summary.join('\n');
}

/**
 * 压缩对话历史
 */
export function compressConversation(
  messages: OpenAI.ChatCompletionMessageParam[],
  options: Partial<CompressionOptions> = {}
): OpenAI.ChatCompletionMessageParam[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 1. 保留系统提示
  const systemMessages = opts.preserveSystem
    ? messages.filter(m => m.role === 'system')
    : [];

  // 2. 保留最近 N 轮对话
  const recentMessages = messages.slice(-opts.preserveRecent * 2); // 用户+AI = 2条

  // 3. 提取中间的重要消息
  const middleMessages = messages.slice(
    systemMessages.length,
    messages.length - opts.preserveRecent * 2
  );
  const importantMessages = extractImportantMessages(middleMessages);

  // 4. 生成摘要
  const summary = summarizeConversation(middleMessages);

  // 5. 组合压缩后的消息
  const compressed: OpenAI.ChatCompletionMessageParam[] = [
    ...systemMessages,
    {
      role: 'user',
      content: `[对话历史摘要]\n\n${summary}\n\n[重要事件已在下方保留详细内容]`,
    },
    ...importantMessages,
    {
      role: 'assistant',
      content: '我已了解之前的对话历史。让我们继续。',
    },
    ...recentMessages,
  ];

  // 6. 验证压缩效果
  const originalTokens = estimateTokens(messages);
  const compressedTokens = estimateTokens(compressed);

  console.log(
    `[Compression] ${originalTokens} tokens → ${compressedTokens} tokens (${Math.round((1 - compressedTokens / originalTokens) * 100)}% 减少)`
  );

  return compressed;
}

/**
 * 自动压缩（在需要时）
 */
export function autoCompress(
  messages: OpenAI.ChatCompletionMessageParam[],
  options: Partial<CompressionOptions> = {}
): {
  compressed: boolean;
  messages: OpenAI.ChatCompletionMessageParam[];
} {
  if (!shouldCompress(messages, options)) {
    return { compressed: false, messages };
  }

  const compressedMessages = compressConversation(messages, options);

  return { compressed: true, messages: compressedMessages };
}

/**
 * 获取压缩统计信息
 */
export function getCompressionStats(
  original: OpenAI.ChatCompletionMessageParam[],
  compressed: OpenAI.ChatCompletionMessageParam[]
): {
  originalTokens: number;
  compressedTokens: number;
  reductionPercent: number;
  originalMessages: number;
  compressedMessages: number;
} {
  const originalTokens = estimateTokens(original);
  const compressedTokens = estimateTokens(compressed);

  return {
    originalTokens,
    compressedTokens,
    reductionPercent: Math.round((1 - compressedTokens / originalTokens) * 100),
    originalMessages: original.length,
    compressedMessages: compressed.length,
  };
}
