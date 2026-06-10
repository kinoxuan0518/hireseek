/**
 * 自动复盘引擎（进化闭环上半场）
 *
 * 数据进：飞书多维表格（真实招聘结果）+ 本地 DB（漏斗/任务/反思）
 * 分析出：deepseek-v4-pro 生成结构化复盘——哪些话术/筛选规则表现差、
 *         应该具体怎么改（直接产出改写后的全文）
 *
 * 设计原则：用真实数据驱动技能进化，不凭感觉调 prompt。
 * 数据不足时明确说"不改"，宁可不动也不瞎改。
 */

import OpenAI from 'openai';
import { config } from '../config';
import { db } from '../db';
import { loadWorkspaceFile } from '../skills/loader';

// ── 进化目标文件（每轮 sourcing 都注入 system prompt 的可进化资产）────
export const EVOLVABLE_FILES = {
  'outreach-guide': 'references/outreach-guide.md',
  'candidate-evaluation': 'references/candidate-evaluation.md',
} as const;

export type EvolvableKey = keyof typeof EVOLVABLE_FILES;

export interface EvolutionProposal {
  /** 进化目标 */
  file: EvolvableKey;
  /** 为什么要改（必须引用数据证据） */
  reason: string;
  /** 改写后的完整文件内容 */
  newContent: string;
}

export interface Retrospective {
  /** 数据诊断结论（每条都要有数据支撑） */
  diagnosis: string[];
  /** 改写提案（数据不足时为空数组） */
  proposals: EvolutionProposal[];
  /** 本轮复盘用到的证据摘要（留档用） */
  evidence: string;
}

// ── 证据收集 ─────────────────────────────────────────────────────────

/** 本地 DB：候选人漏斗（按渠道 × 状态） */
function localFunnel(): string {
  const rows = db.prepare(`
    SELECT channel, status, COUNT(*) as n
    FROM candidates
    GROUP BY channel, status
    ORDER BY channel, n DESC
  `).all() as { channel: string; status: string; n: number }[];

  if (rows.length === 0) return '本地候选人数据：暂无。';

  const byChannel = new Map<string, string[]>();
  for (const r of rows) {
    if (!byChannel.has(r.channel)) byChannel.set(r.channel, []);
    byChannel.get(r.channel)!.push(`${r.status}=${r.n}`);
  }

  const lines = ['本地候选人漏斗（渠道 → 状态分布）：'];
  for (const [ch, stats] of byChannel) {
    lines.push(`- ${ch}: ${stats.join(', ')}`);
  }
  return lines.join('\n');
}

/** 本地 DB：最近任务执行效率 */
function recentRuns(limit = 10): string {
  const rows = db.prepare(`
    SELECT channel, started_at, contacted_count, skipped_count, status
    FROM task_runs ORDER BY id DESC LIMIT ?
  `).all(limit) as { channel: string; started_at: string; contacted_count: number; skipped_count: number; status: string }[];

  if (rows.length === 0) return '最近任务：暂无。';
  return ['最近任务执行：', ...rows.map(r =>
    `- [${r.started_at.slice(0, 10)}] ${r.channel} 触达${r.contacted_count}/跳过${r.skipped_count}（${r.status}）`,
  )].join('\n');
}

/** 本地 DB：历史反思（agent 每轮跑完写的复盘） */
function recentReflections(limit = 5): string {
  const rows = db.prepare(`
    SELECT channel, content, created_at FROM reflections ORDER BY id DESC LIMIT ?
  `).all(limit) as { channel: string; content: string; created_at: string }[];

  if (rows.length === 0) return '历史反思：暂无。';
  return ['历史反思摘录：', ...rows.map(r =>
    `- [${r.created_at.slice(0, 10)}|${r.channel}] ${r.content.slice(0, 200)}`,
  )].join('\n');
}

/** 飞书多维表格（配置缺失时优雅降级，不阻断本地复盘） */
async function feishuEvidence(): Promise<string> {
  try {
    const { buildEvolutionContext } = await import('../channels/feishu');
    return await buildEvolutionContext();
  } catch (err) {
    return `飞书多维表格：未接入（${err instanceof Error ? err.message : err}）。仅用本地数据复盘。`;
  }
}

export async function gatherEvidence(): Promise<string> {
  const feishu = await feishuEvidence();
  return [feishu, localFunnel(), recentRuns(), recentReflections()].join('\n\n');
}

// ── LLM 复盘 ─────────────────────────────────────────────────────────

const RETROSPECT_SYSTEM = `
你是 HireSeek 的进化引擎，负责基于真实招聘数据复盘并改写两份核心资产：
1. outreach-guide（打招呼/触达话术指南）
2. candidate-evaluation（候选人筛选与评分规则）

这两份文件会注入每一轮 sourcing 的 system prompt，直接决定招聘效果。

## 铁律

1. **每条诊断必须有数据支撑**——引用证据里的具体数字（回复率、状态分布、跳过原因）
2. **数据不足就不改**——样本太少（如触达<30人）或看不出模式时，proposals 留空，
   在 diagnosis 里写明"数据不足，建议积累到 X 条再复盘"
3. **改写是演进不是重写**——保留原文件的结构与有效部分，只动有数据证明有问题的段落；
   新增内容标注来源（如"基于 2026-06 复盘：脉脉渠道回复率仅 8%，增加……"）
4. **不碰风控规则**——打招呼频率、每日上限等安全约束一律保留原文

## 输出格式（严格 JSON）

{
  "diagnosis": ["诊断1（含数据）", "诊断2（含数据）"],
  "proposals": [
    {
      "file": "outreach-guide" | "candidate-evaluation",
      "reason": "为什么改 + 数据依据",
      "newContent": "改写后的完整 markdown 全文"
    }
  ]
}

不需要改的文件不要出现在 proposals 里。两个文件都没问题就输出 "proposals": []。
`.trim();

export async function runRetrospective(): Promise<Retrospective> {
  const evidence = await gatherEvidence();

  const currentDocs = Object.entries(EVOLVABLE_FILES)
    .map(([key, p]) => `### 当前 ${key}（${p}）\n\n${loadWorkspaceFile(p) || '（文件为空）'}`)
    .join('\n\n---\n\n');

  const client = new OpenAI({
    apiKey: config.deepseek.apiKey,
    baseURL: config.deepseek.baseUrl,
  });

  const res = await client.chat.completions.create({
    // 复盘是深推理任务，用 reasoner 档模型
    model: config.deepseek.reasonerModel,
    messages: [
      { role: 'system', content: RETROSPECT_SYSTEM },
      {
        role: 'user',
        content: `## 数据证据\n\n${evidence}\n\n---\n\n## 当前资产全文\n\n${currentDocs}\n\n请复盘并输出 JSON。`,
      },
    ],
    max_tokens: 8000,
    temperature: 0.2,
  });

  const text = res.choices[0]?.message?.content ?? '';
  const parsed = extractJSON(text);

  if (!parsed || !Array.isArray(parsed.diagnosis)) {
    throw new Error(`复盘输出无法解析为 JSON：${text.slice(0, 300)}`);
  }

  const proposals = (Array.isArray(parsed.proposals) ? parsed.proposals : [])
    .filter((raw): raw is EvolutionProposal => {
      const p = raw as Partial<EvolutionProposal> | null;
      return typeof p?.file === 'string' && p.file in EVOLVABLE_FILES &&
        typeof p?.reason === 'string' &&
        typeof p?.newContent === 'string' && p.newContent.length > 100;
    });

  return {
    diagnosis: parsed.diagnosis.map(String),
    proposals,
    evidence,
  };
}

function extractJSON(text: string): { diagnosis?: unknown[]; proposals?: unknown[] } | null {
  const candidates = [
    text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)?.[1],
    text.match(/(\{[\s\S]*\})/)?.[1],
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c.trim());
    } catch { /* 下一个候选 */ }
  }
  return null;
}
