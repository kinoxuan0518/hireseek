import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface ToolOutputOffloadInput {
  content: string;
  toolName: string;
  runId?: number | null;
  sessionId?: string | null;
  toolCallId?: string | null;
  kind?: string;
  inlineLimit?: number;
  headChars?: number;
  tailChars?: number;
}

export interface ToolOutputOffloadResult {
  content: string;
  offloaded: boolean;
  path?: string;
  originalChars: number;
}

const DEFAULT_INLINE_LIMIT = 2500;
const DEFAULT_HEAD_CHARS = 1200;
const DEFAULT_TAIL_CHARS = 800;

function outputDir(): string {
  return path.join(path.dirname(config.db.path), 'tool-outputs');
}

function safePart(value: string | number | null | undefined, fallback: string): string {
  const text = String(value ?? '').trim();
  return (text || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
}

export function offloadToolOutput(input: ToolOutputOffloadInput): ToolOutputOffloadResult {
  const inlineLimit = input.inlineLimit ?? DEFAULT_INLINE_LIMIT;
  const originalChars = input.content.length;
  if (input.content.startsWith('[工具输出已卸载]')) {
    return { content: input.content, offloaded: false, originalChars };
  }
  if (originalChars <= inlineLimit) {
    return { content: input.content, offloaded: false, originalChars };
  }

  const dir = outputDir();
  fs.mkdirSync(dir, { recursive: true });

  const hash = crypto.createHash('sha256').update(input.content).digest('hex').slice(0, 16);
  const filename = [
    safePart(input.runId, 'run-none'),
    safePart(input.sessionId, 'session-none'),
    safePart(input.toolCallId, 'call-none'),
    safePart(input.toolName, 'tool'),
    safePart(input.kind, 'output'),
    hash,
  ].join('__') + '.txt';
  const absolute = path.join(dir, filename);

  if (!fs.existsSync(absolute)) {
    const header = [
      '# HireSeek tool output offload',
      `created_at: ${new Date().toISOString()}`,
      `tool_name: ${input.toolName}`,
      `run_id: ${input.runId ?? ''}`,
      `session_id: ${input.sessionId ?? ''}`,
      `tool_call_id: ${input.toolCallId ?? ''}`,
      `kind: ${input.kind ?? 'output'}`,
      `chars: ${originalChars}`,
      '',
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(absolute, header + input.content, 'utf8');
  }

  const headChars = input.headChars ?? DEFAULT_HEAD_CHARS;
  const tailChars = input.tailChars ?? DEFAULT_TAIL_CHARS;
  const head = input.content.slice(0, headChars).trimEnd();
  const tail = input.content.slice(Math.max(0, input.content.length - tailChars)).trimStart();

  return {
    offloaded: true,
    path: absolute,
    originalChars,
    content: [
      '[工具输出已卸载]',
      `path: ${absolute}`,
      `chars: ${originalChars}`,
      '',
      '## head',
      head,
      '',
      '## tail',
      tail,
    ].join('\n'),
  };
}

export function offloadToolResultForContext(
  input: Omit<ToolOutputOffloadInput, 'kind' | 'inlineLimit' | 'headChars' | 'tailChars'> & {
    kind?: string;
  },
): ToolOutputOffloadResult {
  return offloadToolOutput({
    ...input,
    kind: input.kind ?? 'tool-result',
    inlineLimit: 6000,
    headChars: 2400,
    tailChars: 1400,
  });
}
