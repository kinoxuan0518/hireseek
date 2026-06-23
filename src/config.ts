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
  // deepseek-chat/deepseek-reasoner 旧模型名将于 2026-07-24 弃用
  deepseek: 'deepseek-v4-flash',
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
    /** 复杂推理场景（评估、策略）用更强的 v4-pro；v4-flash 思考模式是低成本替代 */
    reasonerModel: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-v4-pro',
  },
  // 验证器（结果质检 / 流程合规）专用模型——"做的和验的分开"的关键：
  // 默认用 DeepSeek 更强档位 v4-pro；但允许指向**异构厂商**（如 Claude），
  // 让验证器与执行器的失败模式去相关，才是真正"换了一个脑子"而非只换档。
  verifier: {
    apiKey:  process.env.VERIFIER_API_KEY  || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.VERIFIER_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model:   process.env.VERIFIER_MODEL    || process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-v4-pro',
  },
  // 重校官（学习闭环：用真实过面结果重写"合适"的定义）专用模型。
  // 默认回退到 verifier；但强烈建议指向**异构于 verifier** 的模型——否则就是
  // "同一个脑子分析它自己打的预测、再改它自己依据的标准"，自证风险。
  recalibrator: {
    apiKey:  process.env.RECALIBRATOR_API_KEY  || process.env.VERIFIER_API_KEY  || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.RECALIBRATOR_BASE_URL || process.env.VERIFIER_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model:   process.env.RECALIBRATOR_MODEL    || process.env.VERIFIER_MODEL    || process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-v4-pro',
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
  // canonical 知识/契约层（独立 sandbox）的位置。消费方据此读外部契约。
  // 未配置 → contracts.ts 回退到内置默认契约，运行时绝不因此断掉。
  knowledge: {
    home: process.env.AGENT_KNOWLEDGE_HOME || '',
  },
  // 运行时技能目录。默认读 Codex/Claude 本机技能库；仓库内 workspace/skills 只做兜底。
  skills: {
    homes: (process.env.HIRESEEK_SKILL_HOME || ['~/.codex/skills', '~/.claude/skills'].join(path.delimiter))
      .split(path.delimiter)
      .map(s => s.trim())
      .filter(Boolean)
      .map(resolveHome),
    externalEnabled: process.env.HIRESEEK_EXTERNAL_SKILLS !== 'false',
    preloadLegacyForProductizedChannels: process.env.HIRESEEK_PRELOAD_LEGACY_SKILLS === 'true',
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
    // 双向 Bot：长连接事件订阅（无需公网回调），对话即指挥 HireSeek
    bot: {
      enabled: process.env.FEISHU_BOT_ENABLED === 'true',
      // 限定只响应这些用户（open_id，逗号分隔）；留空=不限制
      allowUsers: (process.env.FEISHU_BOT_ALLOW_USERS || '')
        .split(',').map(s => s.trim()).filter(Boolean),
      // 心跳/后台任务/调度通知主动推送到此 chat_id（留空=不主动推送）
      notifyChatId: process.env.FEISHU_BOT_NOTIFY_CHAT_ID || '',
    },
  },
  browser: {
    control: process.env.HIRESEEK_BROWSER_CONTROL || 'chrome',
    headless: process.env.BROWSER_HEADLESS === 'true',
    slowMo:   parseInt(process.env.BROWSER_SLOW_MO || '100', 10),
    profileDir: resolveHome(process.env.HIRESEEK_BROWSER_PROFILE_DIR || '~/.hireseek/browser-profile'),
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
    // 每周五 18:00 自动复盘进化（基于一周真实数据）
    evolve:   process.env.SCHEDULE_EVOLVE   || '0 18 * * 5',
    // 心跳主动决策循环：工作日白天每 30 分钟醒来一次，自主判断该做什么
    heartbeat: process.env.SCHEDULE_HEARTBEAT || '*/30 9-18 * * 1-5',
  },
};

// 注意：不在模块加载时校验 API key，而是在实际使用时检查
// 这样可以让首次启动引导流程正常运行
// API Key 检查在 src/index.ts 的 checkSetup() 中进行
