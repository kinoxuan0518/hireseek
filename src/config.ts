import * as dotenv from 'dotenv';
import path from 'path';
import os from 'os';

dotenv.config();

function resolveHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const provider = (process.env.LLM_PROVIDER || 'claude') as 'claude' | 'openai' | 'minimax' | string;

// 每个 provider 的默认模型
const DEFAULT_MODELS: Record<string, string> = {
  claude:  'claude-opus-4-6',
  openai:  'computer-use-preview',
  minimax: 'MiniMax-Text-01',
};

export const config = {
  llm: {
    provider,
    model: process.env.LLM_MODEL || DEFAULT_MODELS[provider],
  },
  // provider 专属配置（各自 runner 里按需读取）
  anthropic: {
    apiKey:  process.env.ANTHROPIC_API_KEY || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || '',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model:  process.env.LLM_MODEL || DEFAULT_MODELS.openai,
  },
  // MiniMax（及其他 OpenAI 兼容 provider）
  minimax: {
    apiKey:  process.env.MINIMAX_API_KEY || '',
    baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
    model:   process.env.LLM_MODEL || DEFAULT_MODELS.minimax,
  },
  // 通用 OpenAI 兼容 provider（CUSTOM）
  custom: {
    apiKey:  process.env.CUSTOM_API_KEY || '',
    baseUrl: process.env.CUSTOM_BASE_URL || '',
    model:   process.env.LLM_MODEL || '',
  },
  db: {
    path: resolveHome(process.env.HIRECLAW_DB_PATH || '~/.hireclaw/hireclaw.db'),
  },
  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
  },
  browser: {
    headless: process.env.BROWSER_HEADLESS === 'true',
    slowMo:   parseInt(process.env.BROWSER_SLOW_MO || '100', 10),
    viewport: { width: 900, height: 600 },
  },
  workspace: {
    dir: path.join(__dirname, '..', 'workspace'),
  },
  search: {
    provider: process.env.SEARCH_PROVIDER || '',
    apiKey:   process.env.SEARCH_API_KEY  || '',
  },
  schedule: {
    boss:     process.env.SCHEDULE_BOSS     || '0 9 * * 1-5',
    maimai:   process.env.SCHEDULE_MAIMAI   || '0 10 * * 1-5',
    followup: process.env.SCHEDULE_FOLLOWUP || '0 14 * * 1-5',
  },
};

// 启动时校验当前 provider 所需的 key
if (provider === 'claude'   && !config.anthropic.apiKey) throw new Error('使用 Claude 需要配置 ANTHROPIC_API_KEY');
if (provider === 'openai'   && !config.openai.apiKey)    throw new Error('使用 OpenAI 需要配置 OPENAI_API_KEY');
if (provider === 'minimax'  && !config.minimax.apiKey)   throw new Error('使用 MiniMax 需要配置 MINIMAX_API_KEY');
if (provider === 'custom'   && !config.custom.apiKey)    throw new Error('使用 custom provider 需要配置 CUSTOM_API_KEY 和 CUSTOM_BASE_URL');
