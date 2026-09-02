import { listedProviders, missingKeyHint, resolveEndpoint } from '../llm/provider';
import { ClaudeRunner } from './claude';
import { DomRunner } from './dom-runner';
import { GenericVisionRunner } from './generic-vision';
import { OpenAIRunner } from './openai';
import type { LLMRunner } from './interface';

export type { LLMRunner };
export { parseSkillSummary } from './interface';

/**
 * 按 DRIVER_PROVIDER / LLM_PROVIDER 选开车的脑，再按默认执行器选「手」。
 * Kimi K3 / GLM-5.3-Flash 默认仍走 DOM（点 ref），不是截图点坐标。
 * HIRESEEK_BROWSER_MODE=vision 才切到 GenericVisionRunner。
 */
export function createRunner(): LLMRunner {
  const endpoint = resolveEndpoint('driver');

  if (endpoint.actuator === 'claude-cu') {
    return new ClaudeRunner();
  }
  if (endpoint.actuator === 'openai-cu') {
    return new OpenAIRunner();
  }

  if (!endpoint.apiKey) {
    throw new Error(missingKeyHint(endpoint));
  }
  if (endpoint.provider === 'custom' && (!endpoint.baseUrl || !endpoint.model)) {
    throw new Error('custom provider 需要配置 CUSTOM_BASE_URL 和 LLM_MODEL');
  }

  if (endpoint.actuator === 'vision') {
    return new GenericVisionRunner(
      endpoint.baseUrl,
      endpoint.apiKey,
      endpoint.model,
      endpoint.compat,
    );
  }

  return new DomRunner(
    endpoint.baseUrl ?? '',
    endpoint.apiKey,
    endpoint.model,
    endpoint.compat,
  );
}

export function supportedProviders(): string {
  return listedProviders();
}
