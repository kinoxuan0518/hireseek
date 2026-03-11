/**
 * 远程会话系统
 * 支持导出对话、推送到 claude.ai、生成分享链接
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import type OpenAI from 'openai';
import { config } from './config';

export interface RemoteSessionOptions {
  title?: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  pushToCloud?: boolean;  // 是否推送到 claude.ai
}

export interface RemoteSession {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  messageCount: number;
}

const SESSIONS_DIR = path.join(config.workspace.dir, 'sessions');

/**
 * 确保 sessions 目录存在
 */
function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * 生成会话 ID
 */
function generateSessionId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * 将消息转换为 Markdown 格式
 */
function messagesToMarkdown(
  messages: OpenAI.ChatCompletionMessageParam[],
  title: string
): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**创建时间**: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`**消息数**: ${messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const role = msg.role === 'user' ? '👤 用户' :
                 msg.role === 'assistant' ? '🤖 AI' :
                 msg.role === 'system' ? '⚙️ 系统' : '🔧 工具';

    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content, null, 2);

    lines.push(`## ${role}`);
    lines.push('');
    lines.push(content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 将消息转换为 JSON 格式
 */
function messagesToJSON(
  messages: OpenAI.ChatCompletionMessageParam[],
  title: string
): string {
  return JSON.stringify({
    title,
    createdAt: new Date().toISOString(),
    messageCount: messages.length,
    messages,
  }, null, 2);
}

/**
 * 导出会话到本地文件
 */
export function exportSession(options: RemoteSessionOptions): RemoteSession {
  ensureSessionsDir();

  const sessionId = generateSessionId();
  const title = options.title || `对话-${new Date().toLocaleDateString('zh-CN')}`;

  // 保存为 Markdown
  const markdownPath = path.join(SESSIONS_DIR, `${sessionId}.md`);
  const markdownContent = messagesToMarkdown(options.messages, title);
  fs.writeFileSync(markdownPath, markdownContent, 'utf-8');

  // 保存为 JSON（便于后续导入）
  const jsonPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  const jsonContent = messagesToJSON(options.messages, title);
  fs.writeFileSync(jsonPath, jsonContent, 'utf-8');

  return {
    id: sessionId,
    title,
    url: `file://${markdownPath}`,
    createdAt: new Date().toISOString(),
    messageCount: options.messages.length,
  };
}

/**
 * 推送到 claude.ai（如果配置了 Anthropic API）
 */
export async function pushToClaudeAI(
  options: RemoteSessionOptions
): Promise<RemoteSession | null> {
  // 检查是否配置了 Anthropic API
  if (!config.anthropic.apiKey || config.llm.provider !== 'claude') {
    console.log('[Remote] 未配置 Anthropic API，无法推送到 claude.ai');
    return null;
  }

  try {
    // 注意：Anthropic 官方 API 目前不直接支持创建 claude.ai 会话
    // 这里提供一个占位实现，实际需要使用 Projects API 或其他方式

    console.log('[Remote] 推送到 claude.ai...');

    // 方案 1：使用 Projects API（需要 Anthropic 支持）
    // 方案 2：导出为 Markdown，提示用户手动上传
    // 方案 3：使用第三方服务（如 ShareGPT）

    // 目前使用方案 2：导出并提示用户
    const session = exportSession(options);

    console.log('[Remote] 对话已导出到本地');
    console.log('[Remote] 你可以手动复制到 claude.ai：');
    console.log(`         ${session.url}`);

    return session;
  } catch (err: any) {
    console.error('[Remote] 推送失败:', err.message);
    return null;
  }
}

/**
 * 生成本地分享链接（通过 Dashboard）
 */
export function generateShareLink(sessionId: string): string {
  // 如果 Dashboard 运行中，生成访问链接
  const dashboardPort = 3456; // Dashboard 默认端口
  return `http://localhost:${dashboardPort}/session/${sessionId}`;
}

/**
 * 列出所有会话
 */
export function listSessions(): RemoteSession[] {
  ensureSessionsDir();

  const files = fs.readdirSync(SESSIONS_DIR);
  const sessions: RemoteSession[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const filepath = path.join(SESSIONS_DIR, file);
      const content = fs.readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);

      sessions.push({
        id: file.replace('.json', ''),
        title: data.title,
        url: `file://${filepath.replace('.json', '.md')}`,
        createdAt: data.createdAt,
        messageCount: data.messageCount,
      });
    } catch {
      // 跳过无效文件
    }
  }

  return sessions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * 读取会话
 */
export function loadSession(sessionId: string): {
  title: string;
  messages: OpenAI.ChatCompletionMessageParam[];
} | null {
  const jsonPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(content);

    return {
      title: data.title,
      messages: data.messages,
    };
  } catch {
    return null;
  }
}

/**
 * 删除会话
 */
export function deleteSession(sessionId: string): boolean {
  const mdPath = path.join(SESSIONS_DIR, `${sessionId}.md`);
  const jsonPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  let deleted = false;

  if (fs.existsSync(mdPath)) {
    fs.unlinkSync(mdPath);
    deleted = true;
  }

  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    deleted = true;
  }

  return deleted;
}

/**
 * 在浏览器中打开会话
 */
export function openSessionInBrowser(sessionId: string): void {
  const mdPath = path.join(SESSIONS_DIR, `${sessionId}.md`);

  if (!fs.existsSync(mdPath)) {
    throw new Error(`会话不存在: ${sessionId}`);
  }

  // 使用系统默认应用打开 Markdown 文件
  const command = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';

  execSync(`${command} "${mdPath}"`);
}

/**
 * 复制会话 Markdown 到剪贴板
 */
export function copySessionToClipboard(sessionId: string): void {
  const mdPath = path.join(SESSIONS_DIR, `${sessionId}.md`);

  if (!fs.existsSync(mdPath)) {
    throw new Error(`会话不存在: ${sessionId}`);
  }

  const content = fs.readFileSync(mdPath, 'utf-8');

  // 使用 pbcopy (macOS) 或其他工具
  if (process.platform === 'darwin') {
    const proc = require('child_process').spawn('pbcopy');
    proc.stdin.write(content);
    proc.stdin.end();
  } else {
    console.log('[Remote] 剪贴板功能仅支持 macOS');
    console.log('[Remote] 内容已打印，请手动复制：\n');
    console.log(content);
  }
}

/**
 * 格式化会话列表
 */
export function formatSessionList(sessions: RemoteSession[]): string {
  if (sessions.length === 0) {
    return '暂无会话记录';
  }

  let output = '会话列表：\n\n';

  sessions.forEach((session, index) => {
    const date = new Date(session.createdAt).toLocaleString('zh-CN');
    output += `${index + 1}. ${session.title}\n`;
    output += `   ID: ${session.id}\n`;
    output += `   时间: ${date}\n`;
    output += `   消息: ${session.messageCount} 条\n`;
    output += `   文件: ${session.url}\n\n`;
  });

  return output.trim();
}
