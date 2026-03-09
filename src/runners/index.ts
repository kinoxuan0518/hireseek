import { config } from '../config';
import type { LLMRunner } from './interface';

export type { LLMRunner };
export { parseSkillSummary } from './interface';

/** 根据 LLM_PROVIDER 环境变量选择 Runner 实现 */
export function createRunner(): LLMRunner {
  const { provider } = config.llm;
  const { GenericVisionRunner } = require('./generic-vision');

  switch (provider) {
    case 'claude':
      return new (require('./claude').ClaudeRunner)();

    case 'openai':
      return new (require('./openai').OpenAIRunner)();

    case 'minimax':
      return new GenericVisionRunner(
        config.minimax.baseUrl,
        config.minimax.apiKey,
        config.minimax.model
      );

    case 'custom':
      if (!config.custom.baseUrl || !config.custom.model) {
        throw new Error('custom provider 需要配置 CUSTOM_BASE_URL 和 LLM_MODEL');
      }
      return new GenericVisionRunner(
        config.custom.baseUrl,
        config.custom.apiKey,
        config.custom.model
      );

    default:
      throw new Error(
        `不支持的 LLM_PROVIDER: "${provider}"。可选: claude | openai | minimax | custom`
      );
  }
}
