/**
 * 薄 adapter —— HireSeek 作为 canonical 知识/契约层的【第一个消费方】
 *
 * 契约不属于 HireSeek，它住在独立 sandbox（如 $HOME/agent-knowledge-lab），
 * 由环境变量 AGENT_KNOWLEDGE_HOME 指向。HireSeek 只通过这个薄读取器按需读，不持有副本。
 *
 *   AGENT_KNOWLEDGE_HOME 已配 + 文件在  →  读 sandbox 的 contracts/<name>.yaml（source=sandbox）
 *   未配 / 文件缺失                     →  回退到本文件内置默认契约（source=fallback）
 *
 * 关键：sandbox 是试验田，不是单点依赖。env 没配也照常跑——契约的"家"在外面，
 * 但 HireSeek 永远有一份能兜底的内置版本，绝不因为 sandbox 不在就断运行时。
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from './config';
import type { Channel } from './types';

export interface ContractContextDep {
  key: string;
  visibility?: 'public' | 'private';
}

export interface Contract {
  name: string;
  version: number;
  description?: string;
  requires?: { context?: ContractContextDep[] };
  /** 这个能力跑完必须写入的产物（验证器据此核查履约） */
  writes?: string[];
  outputs?: Record<string, { schema?: string; description?: string }>;
  tools?: string[];
  acceptance?: string[];
  /** 这份契约从哪来的——便于 CLI/日志显示"读的是外部 sandbox 还是内置兜底" */
  _source?: 'sandbox' | 'fallback';
}

// ── 内置兜底契约（与 sandbox 的 boss-greeting.v1.yaml 保持同形，env 缺失时用）──
const FALLBACK_CONTRACTS: Record<string, Contract> = {
  'boss-greeting.v1': {
    name: 'boss_greeting',
    version: 1,
    description: '在 BOSS 直聘上按岗位画像筛选候选人并打招呼，产出结构化已触达候选人清单与可审计轨迹。',
    requires: {
      context: [
        { key: 'company_profile', visibility: 'private' },
        { key: 'active_job', visibility: 'private' },
        { key: 'candidate_evaluation_policy', visibility: 'public' },
        { key: 'outreach_policy', visibility: 'public' },
        { key: 'boss_channel_strategy', visibility: 'public' },
        { key: 'recent_candidate_memory', visibility: 'private' },
      ],
    },
    writes: ['contacted_candidates', 'run_trace', 'interaction_log'],
    outputs: { contacted_candidates: { schema: 'contacted-candidate.v1' } },
    tools: ['browser', 'web_search', 'database'],
    acceptance: [
      '一轮 run 结束后 task_runs 有本轮记录',
      'candidates 有结构化候选人，且 job_id = 当前 active job',
      'run_actions 有本轮 trace，可按 run_id 取回',
      'verifyRun(runId) 能审到本轮候选人',
      'complianceCheck(runId) 能审到本轮轨迹',
      'goalBoard 的累计触达不再是 0',
    ],
  },
};

/** 读一份契约。优先外部 sandbox，缺失则内置兜底。 */
export function loadContract(name: string): Contract {
  const home = config.knowledge.home;
  if (home) {
    try {
      const p = path.join(home, 'contracts', `${name}.yaml`);
      if (fs.existsSync(p)) {
        const parsed = yaml.load(fs.readFileSync(p, 'utf-8')) as Contract;
        if (parsed && typeof parsed === 'object') {
          parsed._source = 'sandbox';
          return parsed;
        }
      }
    } catch {
      /* 读 sandbox 失败 → 落到兜底 */
    }
  }
  const fb = FALLBACK_CONTRACTS[name];
  if (!fb) throw new Error(`未知契约且无内置兜底：${name}`);
  return { ...fb, _source: 'fallback' };
}

/** 读一份 JSON Schema（从 sandbox 的 schemas/）。缺失返回 null（schema 仅用于校验，可选）。 */
export function loadSchema(name: string): Record<string, unknown> | null {
  const home = config.knowledge.home;
  if (!home) return null;
  try {
    const p = path.join(home, 'schemas', `${name}.schema.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    /* schema 读取失败不影响主流程 */
  }
  return null;
}

/** 这个能力跑完必须写入的产物清单（验证器据此核查 run 是否履约）。 */
export function contractWrites(name: string): string[] {
  return loadContract(name).writes ?? [];
}

export function contractNameForChannel(channel: Channel): string | null {
  return channel === 'boss' ? 'boss-greeting.v1' : null;
}

export function contractWritesForChannel(channel: Channel): string[] {
  const name = contractNameForChannel(channel);
  return name ? contractWrites(name) : [];
}

/** 一句话说明当前契约来源，给 CLI / 日志用。 */
export function contractSourceLabel(name: string): string {
  const c = loadContract(name);
  return c._source === 'sandbox'
    ? `读自外部 canonical sandbox（${config.knowledge.home}）`
    : '用 HireSeek 内置兜底契约（未配 AGENT_KNOWLEDGE_HOME）';
}
