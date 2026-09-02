import { afterEach, describe, expect, it } from 'vitest';
import { DomRunner } from '../src/runners/dom-runner';
import { GenericVisionRunner } from '../src/runners/generic-vision';
import { createRunner } from '../src/runners';
import {
  cloneAssistantMessage,
  hasAnyApiKey,
  mergeChatParams,
  normalizeProviderId,
  resolveEndpoint,
} from '../src/llm/provider';

const ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'DRIVER_PROVIDER',
  'DRIVER_MODEL',
  'VISION_PROVIDER',
  'VISION_MODEL',
  'HIRESEEK_BROWSER_MODE',
  'HIRESEEK_REASONING_EFFORT',
  'SEEYA_BROWSER_MODE',
  'SEEYA_REASONING_EFFORT',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'KIMI_API_KEY',
  'ZHIPU_API_KEY',
  'BIGMODEL_API_KEY',
  'GLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'CUSTOM_API_KEY',
  'CUSTOM_BASE_URL',
] as const;

const original: Record<string, string | undefined> = {};

function restoreProviderEnv(): void {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function isolateProviderEnv(): void {
  if (Object.keys(original).length === 0) {
    for (const key of ENV_KEYS) original[key] = process.env[key];
  }
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  if (Object.keys(original).length > 0) restoreProviderEnv();
});

describe('provider catalog', () => {
  it('normalizes kimi/glm aliases', () => {
    expect(normalizeProviderId('moonshot')).toBe('kimi');
    expect(normalizeProviderId('zhipu')).toBe('glm');
    expect(normalizeProviderId('bigmodel')).toBe('glm');
  });

  it('rejects unknown providers with the full list', () => {
    expect(() => normalizeProviderId('not-a-model')).toThrow(/kimi/);
    expect(() => normalizeProviderId('not-a-model')).toThrow(/glm/);
  });

  it('routes kimi and glm sourcing to DOM by default', () => {
    const kimi = resolveEndpoint('driver', {
      LLM_PROVIDER: 'kimi',
      MOONSHOT_API_KEY: 'sk-kimi',
    });
    expect(kimi.provider).toBe('kimi');
    expect(kimi.model).toBe('kimi-k3');
    expect(kimi.actuator).toBe('dom');
    expect(kimi.extras.reasoning_effort).toBe('low');
    expect(kimi.compat.preserveAssistantMessage).toBe(true);

    const glm = resolveEndpoint('driver', {
      LLM_PROVIDER: 'glm',
      ZHIPU_API_KEY: 'sk-glm',
    });
    expect(glm.model).toBe('glm-5.3-flash');
    expect(glm.actuator).toBe('dom');
    expect(glm.extras.thinking).toEqual({ type: 'enabled', clear_thinking: false });
  });

  it('lets SEEYA_ env override leftover HIRESEEK_ flags', () => {
    const endpoint = resolveEndpoint('driver', {
      LLM_PROVIDER: 'kimi',
      MOONSHOT_API_KEY: 'sk-kimi',
      HIRESEEK_BROWSER_MODE: 'dom',
      SEEYA_BROWSER_MODE: 'vision',
      HIRESEEK_REASONING_EFFORT: 'low',
      SEEYA_REASONING_EFFORT: 'high',
    });
    expect(endpoint.actuator).toBe('vision');
    expect(endpoint.extras.reasoning_effort).toBe('high');
  });

  it('lets DRIVER_PROVIDER diverge from chat', () => {
    const chat = resolveEndpoint('chat', {
      LLM_PROVIDER: 'deepseek',
      LLM_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'sk-ds',
      DRIVER_PROVIDER: 'glm',
      ZHIPU_API_KEY: 'sk-glm',
    });
    const driver = resolveEndpoint('driver', {
      LLM_PROVIDER: 'deepseek',
      LLM_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'sk-ds',
      DRIVER_PROVIDER: 'glm',
      ZHIPU_API_KEY: 'sk-glm',
    });
    expect(chat.model).toBe('deepseek-v4-flash');
    expect(driver.provider).toBe('glm');
    expect(driver.model).toBe('glm-5.3-flash');
  });

  it('upgrades DeepSeek vision role to vision-exp', () => {
    const vision = resolveEndpoint('vision', {
      LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-ds',
    });
    expect(vision.model).toBe('deepseek-v4-flash-vision-exp');
  });

  it('uses the seeing driver as vision when it can already look', () => {
    const vision = resolveEndpoint('vision', {
      LLM_PROVIDER: 'kimi',
      MOONSHOT_API_KEY: 'sk-kimi',
    });
    expect(vision.model).toBe('kimi-k3');
  });

  it('forces screenshot actuator when HIRESEEK_BROWSER_MODE=vision', () => {
    const driver = resolveEndpoint('driver', {
      LLM_PROVIDER: 'glm',
      ZHIPU_API_KEY: 'sk-glm',
      HIRESEEK_BROWSER_MODE: 'vision',
    });
    expect(driver.actuator).toBe('vision');
  });

  it('strips temperature for always-thinking models', () => {
    const glm = resolveEndpoint('chat', { LLM_PROVIDER: 'glm', ZHIPU_API_KEY: 'sk' });
    const params = mergeChatParams(glm, { messages: [], temperature: 0.2, max_tokens: 16 });
    expect(params.temperature).toBeUndefined();
    expect(params.reasoning_effort).toBe('high');
  });

  it('clones reasoning_content on assistant messages', () => {
    const cloned = cloneAssistantMessage({
      role: 'assistant',
      content: null,
      reasoning_content: 'think',
      tool_calls: [{ id: '1' }],
    });
    expect((cloned as { reasoning_content: string }).reasoning_content).toBe('think');
  });

  it('detects glm/kimi keys', () => {
    expect(hasAnyApiKey({})).toBe(false);
    expect(hasAnyApiKey({ ZHIPU_API_KEY: 'sk' })).toBe(true);
    expect(hasAnyApiKey({ MOONSHOT_API_KEY: 'sk' })).toBe(true);
  });
});

describe('createRunner', () => {
  it('builds a DOM runner for Kimi and GLM', () => {
    isolateProviderEnv();
    process.env.LLM_PROVIDER = 'kimi';
    process.env.MOONSHOT_API_KEY = 'sk-kimi';
    expect(createRunner()).toBeInstanceOf(DomRunner);

    isolateProviderEnv();
    process.env.LLM_PROVIDER = 'glm';
    process.env.ZHIPU_API_KEY = 'sk-glm';
    expect(createRunner()).toBeInstanceOf(DomRunner);
  });

  it('builds a vision runner when browser mode is vision', () => {
    isolateProviderEnv();
    process.env.LLM_PROVIDER = 'kimi';
    process.env.MOONSHOT_API_KEY = 'sk-kimi';
    process.env.HIRESEEK_BROWSER_MODE = 'vision';
    expect(createRunner()).toBeInstanceOf(GenericVisionRunner);
  });

  it('keeps Claude on native computer-use', () => {
    isolateProviderEnv();
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const runner = createRunner();
    expect(runner.constructor.name).toBe('ClaudeRunner');
  });
});
