import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';

dotenv.config();

function resolveHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const provider = (process.env.LLM_PROVIDER || 'deepseek') as 'deepseek' | 'claude' | 'openai' | 'minimax' | string;

// 每个 provider 的默认模型
const DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-chat',
  claude:  'claude-opus-4-6',
  openai:  'computer-use-preview',
  minimax: 'MiniMax-Text-01',
};

/** 数据库路径：优先新路径，但若旧版 ~/.hireclaw 数据库存在且新路径未建，则继续沿用，保证数据不丢 */
function resolveDbPath(): string {
  const explicit = process.env.HIRESEEK_DB_PATH || process.env.HIRECLAW_DB_PATH;
  if (explicit) return resolveHome(explicit);
  const newPath = resolveHome('~/.hireseek/hireseek.db');
  const legacyPath = resolveHome('~/.hireclaw/hireclaw.db');
  if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) return legacyPath;
  return newPath;
}

export const config = {
  llm: {
    provider,
    model: process.env.LLM_MODEL || DEFAULT_MODELS[provider],
  },
  // provider 专属配置（各自 runner 里按需读取）
  // DeepSeek（默认 provider，OpenAI 兼容 API）
  deepseek: {
    apiKey:  process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model:   process.env.LLM_MODEL || DEFAULT_MODELS.deepseek,
    /** 复杂推理场景（评估、策略）可切换 deepseek-reasoner */
    reasonerModel: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner',
  },
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
    path: resolveDbPath(),
  },
  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
    // 多维表格读取（进化闭环：基于真实招聘结果数据自我反思）
    appId:     process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    bitable: {
      appToken: process.env.FEISHU_BITABLE_APP_TOKEN || '',
      tableId:  process.env.FEISHU_BITABLE_TABLE_ID || '',
    },
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

// 注意：不在模块加载时校验 API key，而是在实际使用时检查
// 这样可以让首次启动引导流程正常运行
// API Key 检查在 src/index.ts 的 checkSetup() 中进行
