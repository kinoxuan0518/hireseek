// @hireclaw/core/evaluator/dimensions — 评估维度定义
//
// 参考 Claude Code 的结构化评估模式，为每个维度定义清晰的标准
// - 维度元数据（名称、描述、权重、评分指南）
// - 维度评分器接口
// - 评分级别定义（不合格/合格/良好/优秀）

import type { EvaluationWeights } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Dimension Metadata
// ────────────────────────────────────────────────────────────

/**
 * 评估维度元数据
 *
 * 每个维度包含：
 * - 名称（用于代码中的 key）
 * - 中文描述（用于报告）
 * - 默认权重
 * - 评分指南（各分数段的评判标准）
 * - 维度级别（不合格/合格/良好/优秀）
 */
export interface DimensionDef {
  /** 维度标识符 */
  name: DimensionKey;
  /** 中文名称 */
  label: string;
  /** 维度描述 */
  description: string;
  /** 默认权重 */
  defaultWeight: number;
  /** 评分标准（分数 → 描述） */
  scoringGuide: DimensionScoringGuide;
  /** 关注点（评估时重点看什么） */
  focusPoints: string[];
  /** 权重范围（可选，用于约束权重配置） */
  weightRange?: { min: number; max: number };
}

export type DimensionKey =
  | 'education'
  | 'experience'
  | 'skills'
  | 'company'
  | 'growth'
  | 'personality';

export interface DimensionScoringGuide {
  /** 优秀（90-100） */
  excellent: string;
  /** 良好（80-89） */
  good: string;
  /** 合格（60-79） */
  acceptable: string;
  /** 不合格（<60） */
  poor: string;
}

// ────────────────────────────────────────────────────────────
// Score Level
// ────────────────────────────────────────────────────────────

export type ScoreLevel = 'excellent' | 'good' | 'acceptable' | 'poor';

/**
 * 分数 → 等级映射
 */
export function scoreToLevel(score: number): ScoreLevel {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 60) return 'acceptable';
  return 'poor';
}

/**
 * 等级 → 标签
 */
export const LEVEL_LABELS: Record<ScoreLevel, string> = {
  excellent: '🌟 优秀',
  good: '✅ 良好',
  acceptable: '⚠️ 合格',
  poor: '❌ 不合格',
};

/**
 * 等级 → 颜色（用于报告）
 */
export const LEVEL_COLORS: Record<ScoreLevel, string> = {
  excellent: '#52c41a',
  good: '#1890ff',
  acceptable: '#faad14',
  poor: '#f5222d',
};

// ────────────────────────────────────────────────────────────
// Built-in Dimension Definitions
// ────────────────────────────────────────────────────────────

export const DIMENSION_DEFINITIONS: Record<DimensionKey, DimensionDef> = {
  education: {
    name: 'education',
    label: '学历与绩点',
    description: '学历层次 × 院校声誉 × 绩点',
    defaultWeight: 0.15,
    focusPoints: [
      '是否 985/211 或同等海外院校',
      '硕博学历加分',
      '绩点 3.5+ 有明显加分',
      '与职位要求匹配的学历层次',
    ],
    scoringGuide: {
      excellent: '985/211 顶尖院校本科 + 高绩点(3.8+)，或海外名校',
      good: '985/211 院校，或普通院校但高绩点',
      acceptable: '普通院校本科/硕士，绩点一般',
      poor: '普通院校且无亮点',
    },
    weightRange: { min: 0.05, max: 0.30 },
  },

  experience: {
    name: 'experience',
    label: '实际经验',
    description: '工作内容深度 × 可量化成果 × 技术贡献',
    defaultWeight: 0.25,
    focusPoints: [
      '是否有具体项目描述（而非模糊职责）',
      '是否有可量化的成果（%, x倍, 提升/降低）',
      '是否有技术选型/架构思考',
      '是否主导/负责（而非仅参与）',
      '技术栈深度',
    ],
    scoringGuide: {
      excellent: '有主导项目+量化成果+技术思考，且技术栈前沿',
      good: '有具体描述，或有量化成果',
      acceptable: '工作内容模糊，但有基本可评判的信息',
      poor: '描述极少或极度模糊，无法判断价值',
    },
    weightRange: { min: 0.15, max: 0.40 },
  },

  skills: {
    name: 'skills',
    label: '技能匹配度',
    description: '与职位要求关键词的匹配程度',
    defaultWeight: 0.25,
    focusPoints: [
      '与 JD 关键词的直接匹配',
      '前沿技术栈加分（LLM/RAG/分布式等）',
      '技能数量与深度平衡',
    ],
    scoringGuide: {
      excellent: '80%+ JD 关键词匹配 + 有前沿技术栈',
      good: '50-80% 关键词匹配',
      acceptable: '30-50% 匹配，有一定相关技能',
      poor: '匹配度极低，关键技能缺失',
    },
    weightRange: { min: 0.10, max: 0.40 },
  },

  company: {
    name: 'company',
    label: '公司背景',
    description: '知名公司经历的市场认可度',
    defaultWeight: 0.15,
    focusPoints: [
      '是否有知名公司（大厂/明星公司）经历',
      '公司与职位的相关性',
      '经历丰富度（段数）',
    ],
    scoringGuide: {
      excellent: '大厂（字节/腾讯/阿里等）经历',
      good: '明星 AI 公司或中等规模知名公司',
      acceptable: '普通公司，但经历丰富度尚可',
      poor: '公司不知名，经历也较少',
    },
    weightRange: { min: 0.05, max: 0.25 },
  },

  growth: {
    name: 'growth',
    label: '成长轨迹',
    description: '职业发展方向的一致性与晋升',
    defaultWeight: 0.10,
    focusPoints: [
      '跳槽频率（<1年经历段数）',
      '职级是否在提升',
      '职业方向是否一致（不是横向漂移）',
      '最近一份工作的职级',
    ],
    scoringGuide: {
      excellent: '方向一致+职级持续提升+无频繁跳槽',
      good: '方向基本一致，有一定成长',
      acceptable: '方向略有漂移，但整体可接受',
      poor: '频繁跳槽（3+段<1年）或方向严重漂移',
    },
    weightRange: { min: 0.05, max: 0.20 },
  },

  personality: {
    name: 'personality',
    label: '个人特质',
    description: 'GitHub/个人项目/简历风格等软信息',
    defaultWeight: 0.10,
    focusPoints: [
      'GitHub 活跃度（有 repo + 近期 commit）',
      '个人项目（对技术有热情）',
      '简历是否有"有趣"的亮点',
      '爱好推断的性格特质',
    ],
    scoringGuide: {
      excellent: 'GitHub 高活跃 + 有个人项目 + 简历有亮点',
      good: 'GitHub 有 repo，或有个人项目',
      acceptable: 'GitHub 走过场，但简历整体可读',
      poor: 'GitHub 为空，简历无聊无亮点',
    },
    weightRange: { min: 0.05, max: 0.20 },
  },
};

// ────────────────────────────────────────────────────────────
// Dimension Score with Context
// ────────────────────────────────────────────────────────────

/**
 * 带完整上下文的维度评分
 */
export interface ScoredDimension {
  key: DimensionKey;
  def: DimensionDef;
  rawScore: number;
  level: ScoreLevel;
  weightedScore: number;
  weight: number;
  notes: string;
  /** 关键亮点（用于报告） */
  highlights: string[];
  /** 关键不足（用于报告） */
  concerns: string[];
}

/**
 * 将原始分数转换为带完整上下文的评分
 */
export function scoreDimension(
  key: DimensionKey,
  rawScore: number,
  weight: number,
  notes: string
): ScoredDimension {
  const def = DIMENSION_DEFINITIONS[key];
  const level = scoreToLevel(rawScore);
  const weightedScore = Math.round(rawScore * weight);

  // Extract highlights and concerns from notes
  const highlights = extractHighlights(notes, level);
  const concerns = extractConcerns(notes, level);

  return {
    key,
    def,
    rawScore,
    level,
    weightedScore,
    weight,
    notes,
    highlights,
    concerns,
  };
}

function extractHighlights(notes: string, level: ScoreLevel): string[] {
  if (level === 'poor') return [];

  const positive = notes
    .split(/[；;,]/)
    .filter(s => /大厂|顶尖|名校|量化|主导|高|丰富|良好|不错/.test(s))
    .map(s => s.trim())
    .filter(Boolean);

  return [...new Set(positive)].slice(0, 3);
}

function extractConcerns(notes: string, level: ScoreLevel): string[] {
  if (level === 'excellent') return [];

  const concerns = notes
    .split(/[；;,]/)
    .filter(s => /不足|偏低|模糊|少|缺失|差|无|未/.test(s))
    .map(s => s.trim())
    .filter(Boolean);

  return [...new Set(concerns)].slice(0, 3);
}

// ────────────────────────────────────────────────────────────
// Weight Utilities
// ────────────────────────────────────────────────────────────

/**
 * 验证权重配置是否合理
 */
export function validateWeights(weights: Partial<EvaluationWeights>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);

  if (Math.abs(total - 1.0) > 0.001) {
    errors.push(`权重总和为 ${(total * 100).toFixed(1)}%，应为 100%`);
  }

  for (const [key, weight] of Object.entries(weights)) {
    const def = DIMENSION_DEFINITIONS[key as DimensionKey];
    if (!def) continue;

    if (weight !== undefined) {
      if (weight < (def.weightRange?.min ?? 0)) {
        errors.push(`${def.label} 权重 ${weight} 低于最小值 ${def.weightRange!.min}`);
      }
      if (weight > (def.weightRange?.max ?? 1)) {
        errors.push(`${def.label} 权重 ${weight} 高于最大值 ${def.weightRange!.max}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 标准化权重（确保总和为1）
 */
export function normalizeWeights(weights: Partial<EvaluationWeights>): EvaluationWeights {
  const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);

  if (Math.abs(total - 1.0) < 0.001) {
    return weights as EvaluationWeights;
  }

  const result: EvaluationWeights = {
    education: (weights.education ?? 0) / total,
    experience: (weights.experience ?? 0) / total,
    skills: (weights.skills ?? 0) / total,
    company: (weights.company ?? 0) / total,
    growth: (weights.growth ?? 0) / total,
    personality: (weights.personality ?? 0) / total,
  };
  return result;
}
