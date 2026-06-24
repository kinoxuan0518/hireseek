import type { BrowserAction, BrowserTarget } from '../browser-session';
import type { SkillResult, TraceStep } from '../types';
import type { ToolExecutionMode } from '../agent-core/tool-registry';

export interface BrowserActionPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface BrowserActionPolicyContext {
  runId?: number;
  sessionId?: string;
  executionMode?: Extract<ToolExecutionMode, 'execute' | 'dry_run' | 'prepare'>;
  observedStageIds?: string[];
  actionLabel?: string;
  pageSnapshot?: string;
  targetJobTitle?: string;
  pendingContactName?: string;
  pendingContactAwaitingRecord?: boolean;
}

export type BrowserActionPolicy = (
  action: BrowserAction,
  context: BrowserActionPolicyContext,
) => BrowserActionPolicyDecision;

export interface RunCompletionPolicyContext {
  executionMode: Extract<ToolExecutionMode, 'execute' | 'dry_run' | 'prepare'>;
  trace: TraceStep[];
  pageSnapshot: string;
  targetJobTitle?: string;
  pendingContactName?: string;
  pendingContactAwaitingRecord?: boolean;
}

export type RunCompletionPolicy = (
  context: RunCompletionPolicyContext,
) => BrowserActionPolicyDecision;

export interface RunSkillOptions {
  /** execute=真实执行；dry_run=只观察/预检，禁止外部副作用。 */
  executionMode?: Extract<ToolExecutionMode, 'execute' | 'dry_run' | 'prepare'>;
  blockedBrowserActions?: BrowserAction['action'][];
  /** 中层平台协议可在这里约束浏览器动作；runner 只执行通用策略结果。 */
  browserActionPolicy?: BrowserActionPolicy;
  /** 中层协议决定何时可以把本轮标记为完成；runner 只机械执行判定。 */
  completionPolicy?: RunCompletionPolicy;
  /** 当前 task_runs.id，用于 agent-core 通用工具 trace；没有时仍保留内存 trace。 */
  runId?: number;
  /** 当前对话/任务 session id，用于会话级工具 trace。 */
  sessionId?: string;
  /** 平台协议声明的首个阶段 id；runner 只把初始快照归档到该阶段。 */
  initialStageId?: string;
  /** 结构化触达登记前必须已经在 run trace 中观测到的协议阶段。 */
  requiredStagesBeforeContact?: string[];
  /** 平台协议可用于校验职位定位，但 runner 不解释职位语义。 */
  targetJobTitle?: string;
}

/**
 * 所有 LLM 实现都必须满足这个接口。
 * orchestrator 只依赖这里，不感知具体的 LLM。
 */
export interface LLMRunner {
  runSkill(
    page: BrowserTarget,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void,
    options?: RunSkillOptions,
  ): Promise<SkillResult>;
}

/**
 * computer-use 动作的统一格式。
 * 各 LLM 的实现负责把自己 API 的响应转换成这个格式。
 */
export interface ComputerAction {
  action: 'screenshot' | 'left_click' | 'right_click' | 'double_click'
        | 'type' | 'key' | 'scroll' | 'move';
  coordinate?: [number, number];
  text?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

/** 从 summary 文本中解析触达 / 跳过数字 */
export function parseSkillSummary(text: string): { contacted: number; skipped: number } {
  const contacted = parseInt(text.match(/触达人数[：:]\s*(\d+)/)?.[1] ?? '0', 10);
  const skipped   = parseInt(text.match(/跳过人数[：:]\s*(\d+)/)?.[1] ?? '0', 10);
  return { contacted, skipped };
}

/**
 * 从总结里解析"已触达候选人清单"——每行 `- 姓名 | 公司 | 自评分 | 理由`。
 * 容错：缺字段照样收，分数非法记为 undefined；解析不到返回空数组。
 * 这是 verifier / 漏斗能拿到真实候选人的来源，所以宁可宽松也别丢数据。
 */
export function parseContactedCandidates(
  text: string,
): Array<{ name: string; company?: string; score?: number; reason?: string }> {
  const out: Array<{ name: string; company?: string; score?: number; reason?: string }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/^[-*·•]/.test(line) || !line.includes('|')) continue;
    const parts = line.replace(/^[-*·•]\s*/, '').split('|').map(s => s.trim());
    const name = parts[0];
    if (!name || name === '无' || name === '姓名') continue;
    const scoreNum = parts[2] != null ? parseInt(parts[2].match(/\d+/)?.[0] ?? '', 10) : NaN;
    out.push({
      name,
      company: parts[1] || undefined,
      score: Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : undefined,
      reason: parts[3] || undefined,
    });
  }
  return out;
}
