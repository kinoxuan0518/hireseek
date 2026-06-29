import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { Channel } from '../types';

export type RecruitingCapabilityKind = 'principles' | 'evaluation' | 'outreach' | 'search';
export type RecruitingCapabilityVisibility = 'public' | 'private';

export interface RecruitingCapabilityContract {
  consumes: string[];
  produces: string[];
  writes: string[];
  constraints: string[];
}

export interface RecruitingCapability {
  id: string;
  version: number;
  name: string;
  kind: RecruitingCapabilityKind;
  description: string;
  sourceFiles: string[];
  appliesTo: 'all' | Channel[];
  priority: number;
  visibility: RecruitingCapabilityVisibility;
  contract: RecruitingCapabilityContract;
}

export interface RecruitingCapabilityManifestEntry {
  id: string;
  version: number;
  kind: RecruitingCapabilityKind;
  appliesTo: 'all' | Channel[];
  priority: number;
  visibility: RecruitingCapabilityVisibility;
  sourceFiles: Array<{ path: string; exists: boolean; bytes: number }>;
  contract: RecruitingCapabilityContract;
}

export interface RecruitingCapabilityContextOptions {
  channel?: Channel;
  includeKinds?: RecruitingCapabilityKind[];
  excludeIds?: string[];
  maxCharsPerFile?: number;
}

const OUTREACH_OUTPUT_PROTOCOL = `
## 触达输出协议（outreach-output.v1）

每个真实打招呼的候选人都必须通过 record_contacted 输出结构化字段：

- evidence：为什么联系 ta，必须来自页面/简历可见事实。
- personalization_evidence：招呼语里实际使用的候选人真实信息点，不能是“背景匹配”这类泛话。
- message_intent：这条招呼希望触发的回应理由，例如技术挑战、成长空间、方向匹配、团队影响力、稳定性。
- greeting_text：实际发送给候选人的招呼语。
- risk_flags：可选，记录信息不足或可能误判的风险，如 unclear_agent_experience、generic_message_risk。
- fit_tags：可选，记录命中的匹配标签，如 Agent、RAG、大厂、明星创业、1-3年。

缺少上述核心字段时，不算完成一次可审计触达。
`.trim();

const CAPABILITIES: RecruitingCapability[] = [
  {
    id: 'founder-recruiting-principles.v1',
    version: 1,
    name: '招聘基本判断',
    kind: 'principles',
    description: '招聘交换观、读人框架、尊重与结果目标。',
    sourceFiles: ['references/founders-wisdom.md'],
    appliesTo: 'all',
    priority: 10,
    visibility: 'public',
    contract: {
      consumes: ['active-job-facts', 'company-facts'],
      produces: ['recruiting-principles'],
      writes: [],
      constraints: ['must-not-override-code-guards'],
    },
  },
  {
    id: 'candidate-evaluation.v1',
    version: 1,
    name: '候选人判断',
    kind: 'evaluation',
    description: '跨渠道共享的候选人质量判断框架。',
    sourceFiles: ['references/candidate-evaluation.md'],
    appliesTo: 'all',
    priority: 20,
    visibility: 'public',
    contract: {
      consumes: ['active-job-facts', 'candidate-visible-evidence'],
      produces: ['candidate-fit-signals', 'candidate-risk-flags'],
      writes: [],
      constraints: ['must-ground-judgment-in-visible-evidence'],
    },
  },
  {
    id: 'outreach-voice.v1',
    version: 1,
    name: '触达话术',
    kind: 'outreach',
    description: '跨渠道共享的个性化触达原则、消息结构与质量标准。',
    sourceFiles: ['references/outreach-guide.md', 'references/outreach-playbook.md'],
    appliesTo: 'all',
    priority: 30,
    visibility: 'public',
    contract: {
      consumes: ['active-job-facts', 'candidate-visible-evidence', 'candidate-fit-signals'],
      produces: ['outreach-voice', 'outreach-output.v1'],
      writes: ['record_contacted'],
      constraints: ['must-write-structured-contact-output', 'must-avoid-generic-message'],
    },
  },
  {
    id: 'talent-sourcing-strategy.v1',
    version: 1,
    name: '人才寻源策略',
    kind: 'search',
    description: '岗位画像、关键词矩阵、搜索轮次与人才情报输出协议。',
    sourceFiles: ['references/talent-sourcing/capability-spec.md', 'references/search-playbook.md'],
    appliesTo: ['maimai', 'linkedin'],
    priority: 40,
    visibility: 'public',
    contract: {
      consumes: ['active-job-facts', 'market-research-evidence'],
      produces: ['search-keyword-matrix', 'source-round-plan'],
      writes: [],
      constraints: ['must-keep-channel-specific-ui-rules-out-of-shared-search'],
    },
  },
];

function capabilityAppliesTo(capability: RecruitingCapability, channel?: Channel): boolean {
  if (!channel || capability.appliesTo === 'all') return true;
  return capability.appliesTo.includes(channel);
}

function readWorkspaceFile(relPath: string, maxChars: number): string {
  const fullPath = path.join(config.workspace.dir, relPath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf-8').trim().slice(0, maxChars);
}

export function listRecruitingCapabilities(channel?: Channel): RecruitingCapability[] {
  return CAPABILITIES
    .filter(capability => capabilityAppliesTo(capability, channel))
    .sort((a, b) => a.priority - b.priority);
}

function sourceStatus(file: string): { path: string; exists: boolean; bytes: number } {
  const fullPath = path.join(config.workspace.dir, file);
  if (!fs.existsSync(fullPath)) return { path: file, exists: false, bytes: 0 };
  return { path: file, exists: true, bytes: fs.statSync(fullPath).size };
}

export function buildRecruitingCapabilityManifest(channel?: Channel): RecruitingCapabilityManifestEntry[] {
  return listRecruitingCapabilities(channel).map(capability => ({
    id: capability.id,
    version: capability.version,
    kind: capability.kind,
    appliesTo: capability.appliesTo,
    priority: capability.priority,
    visibility: capability.visibility,
    sourceFiles: capability.sourceFiles.map(sourceStatus),
    contract: capability.contract,
  }));
}

export function buildRecruitingCapabilityContext(opts: RecruitingCapabilityContextOptions = {}): string {
  const includeKinds = opts.includeKinds ? new Set(opts.includeKinds) : null;
  const excludeIds = new Set(opts.excludeIds ?? []);
  const maxChars = opts.maxCharsPerFile ?? 12000;
  const capabilities = listRecruitingCapabilities(opts.channel)
    .filter(capability => !includeKinds || includeKinds.has(capability.kind))
    .filter(capability => !excludeIds.has(capability.id));

  if (capabilities.length === 0) return '';

  const sections = capabilities.map(capability => {
    const docs = capability.sourceFiles
      .map(file => {
        const content = readWorkspaceFile(file, maxChars);
        return content ? `### 来源：${file}\n\n${content}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    return [
      `## ${capability.name}（${capability.id}）`,
      `类型：${capability.kind}`,
      `说明：${capability.description}`,
      `适用渠道：${capability.appliesTo === 'all' ? 'all' : capability.appliesTo.join(', ')}`,
      docs || '（来源文件缺失，跳过具体内容）',
    ].join('\n\n');
  });

  return [
    '# HireSeek 中层招聘能力',
    '这些能力是跨渠道共享的招聘知识与判断协议。外部 skill 可补充案例和页面细节，但不能覆盖这里的中层能力、平台协议、代码护栏或结构化输出契约。',
    OUTREACH_OUTPUT_PROTOCOL,
    ...sections,
  ].join('\n\n---\n\n');
}

export function formatRecruitingCapabilities(channel?: Channel): string {
  const capabilities = listRecruitingCapabilities(channel);
  if (capabilities.length === 0) return '当前没有注册任何招聘中层能力。';

  return [
    'HireSeek 中层招聘能力',
    '',
    ...capabilities.map(c => [
      `- ${c.id}: ${c.name}`,
      `  类型: ${c.kind}`,
      `  适用渠道: ${c.appliesTo === 'all' ? 'all' : c.appliesTo.join(', ')}`,
      `  来源: ${c.sourceFiles.join(', ')}`,
      `  产出: ${c.contract.produces.join(', ') || '无'}`,
      `  写入: ${c.contract.writes.join(', ') || '无'}`,
    ].join('\n')),
    '',
    '说明：这些能力会被 BOSS、脉脉、LinkedIn 等上层工作流复用；skill 只作为迁移素材和兜底。',
  ].join('\n');
}

export function formatRecruitingCapabilityManifest(channel?: Channel): string {
  const manifest = buildRecruitingCapabilityManifest(channel);
  if (manifest.length === 0) return '当前没有可用的招聘能力 manifest。';
  return [
    'HireSeek Recruiting Capability Manifest',
    '',
    ...manifest.map(entry => {
      const appliesTo = entry.appliesTo === 'all' ? 'all' : entry.appliesTo.join(', ');
      const sources = entry.sourceFiles
        .map(file => `${file.path}:${file.exists ? `${file.bytes}B` : 'missing'}`)
        .join(', ');
      return [
        `- ${entry.id}`,
        `  version: ${entry.version}`,
        `  kind: ${entry.kind}`,
        `  appliesTo: ${appliesTo}`,
        `  priority: ${entry.priority}`,
        `  visibility: ${entry.visibility}`,
        `  consumes: ${entry.contract.consumes.join(', ') || 'none'}`,
        `  produces: ${entry.contract.produces.join(', ') || 'none'}`,
        `  writes: ${entry.contract.writes.join(', ') || 'none'}`,
        `  constraints: ${entry.contract.constraints.join(', ') || 'none'}`,
        `  sources: ${sources}`,
      ].join('\n');
    }),
  ].join('\n');
}
