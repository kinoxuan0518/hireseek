import { Page } from 'playwright';
import type { SkillResult } from '../types';

/**
 * 所有 LLM 实现都必须满足这个接口。
 * orchestrator 只依赖这里，不感知具体的 LLM。
 */
export interface LLMRunner {
  runSkill(
    page: Page,
    systemPrompt: string,
    task: string,
    onProgress?: (msg: string) => void
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
