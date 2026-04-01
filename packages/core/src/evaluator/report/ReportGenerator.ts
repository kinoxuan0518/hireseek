// @hireclaw/core/evaluator/report — 评估报告生成
//
// 参考 Claude Code 的结构化输出模式，生成多格式评估报告
// - Markdown（人类可读）
// - 结构化 JSON（机器可读）
// - 飞书消息卡片（便于分享）
// - 对比报告（多候选人排序）

import type { EvaluationResult, Candidate, CandidateFetchResult } from '../../types.js';
import type { ScoredDimension, ScoreLevel } from '../dimensions/Dimensions.js';
import { scoreToLevel, LEVEL_LABELS, DIMENSION_DEFINITIONS, type DimensionKey } from '../dimensions/Dimensions.js';

// ────────────────────────────────────────────────────────────
// Report Types
// ────────────────────────────────────────────────────────────

export interface EvaluationReport {
  /** 报告ID */
  reportId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 候选人信息 */
  candidate: {
    id: string;
    name: string;
    platform: string;
  };
  /** 职位信息 */
  job: {
    id: string;
    title: string;
  };
  /** 总分 */
  totalScore: number;
  totalLevel: ScoreLevel;
  passed: boolean;
  priority: EvaluationResult['priority'];
  /** 各维度评分 */
  dimensions: ScoredDimension[];
  /** 否决项 */
  vetoes: string[];
  /** 加分项 */
  bonuses: Array<{ rule: string; points: number }>;
  /** 评估摘要 */
  summary: string;
  /** 优势（用于沟通） */
  strengths: string[];
  /** 风险点（用于沟通） */
  risks: string[];
  /** 建议话术层次 */
  recommendedTier: number;
}

export interface BatchReport {
  reportId: string;
  generatedAt: string;
  jobId: string;
  totalCandidates: number;
  passedCandidates: number;
  averageScore: number;
  /** 候选人排名（从高到低） */
  rankings: RankedCandidate[];
  /** 分布统计 */
  distribution: ScoreDistribution;
  /** 平台分布 */
  platformStats: PlatformStats[];
}

export interface RankedCandidate {
  rank: number;
  candidate: Candidate;
  score: number;
  level: ScoreLevel;
  passed: boolean;
  keyHighlights: string;
}

export interface ScoreDistribution {
  excellent: number;  // >= 90
  good: number;        // 80-89
  acceptable: number;   // 60-79
  poor: number;         // < 60
}

export interface PlatformStats {
  platform: string;
  count: number;
  averageScore: number;
  passRate: number;
}

// ────────────────────────────────────────────────────────────
// Report Generator
// ────────────────────────────────────────────────────────────

export class ReportGenerator {
  /**
   * 为单个候选人生成评估报告
   */
  generate(candidate: Candidate, jobId: string, result: EvaluationResult): EvaluationReport {
    const now = new Date().toISOString();
    const totalLevel = scoreToLevel(result.score);

    // Build scored dimensions
    const scoredDimensions: ScoredDimension[] = result.dimensions.map(d => {
      const def = DIMENSION_DEFINITIONS[d.name as DimensionKey];
      return {
        key: d.name as DimensionKey,
        def,
        rawScore: d.score,
        level: scoreToLevel(d.score),
        weightedScore: d.weightedScore,
        weight: d.weight,
        notes: d.notes,
        highlights: [],
        concerns: [],
      };
    });

    const { strengths, risks } = this.extractStrengthsAndRisks(result);

    return {
      reportId: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      generatedAt: now,
      candidate: {
        id: candidate.id,
        name: candidate.name,
        platform: candidate.platform,
      },
      job: {
        id: jobId,
        title: candidate.source?.url ?? jobId,
      },
      totalScore: result.score,
      totalLevel,
      passed: result.passed,
      priority: result.priority,
      dimensions: scoredDimensions,
      vetoes: result.vetoed,
      bonuses: result.bonuses,
      summary: result.summary ?? this.generateSummary(result),
      strengths,
      risks,
      recommendedTier: this.estimateTier(result),
    };
  }

  /**
   * 生成批量评估报告
   */
  generateBatch(
    candidates: Array<{ candidate: Candidate; result: EvaluationResult }>,
    jobId: string,
    jobTitle: string
  ): BatchReport {
    const now = new Date().toISOString();
    const sorted = [...candidates].sort((a, b) => b.result.score - a.result.score);

    const rankings: RankedCandidate[] = sorted.map((item, idx) => ({
      rank: idx + 1,
      candidate: item.candidate,
      score: item.result.score,
      level: scoreToLevel(item.result.score),
      passed: item.result.passed,
      keyHighlights: this.getKeyHighlights(item.result),
    }));

    const passedCandidates = candidates.filter(c => c.result.passed).length;
    const averageScore = candidates.length > 0
      ? Math.round(candidates.reduce((sum, c) => sum + c.result.score, 0) / candidates.length)
      : 0;

    const distribution = this.calcDistribution(candidates);
    const platformStats = this.calcPlatformStats(candidates);

    return {
      reportId: `batch_${Date.now()}`,
      generatedAt: now,
      jobId,
      totalCandidates: candidates.length,
      passedCandidates,
      averageScore,
      rankings,
      distribution,
      platformStats,
    };
  }

  // ── Format Outputs ──

  /**
   * 生成 Markdown 格式报告
   */
  toMarkdown(report: EvaluationReport): string {
    const lines: string[] = [];

    lines.push(`# 🎯 候选人评估报告`);
    lines.push(`**${report.candidate.name}** | ${report.candidate.platform} | ${report.generatedAt.slice(0, 10)}`);
    lines.push('');

    // Score overview
    const statusEmoji = report.passed ? '✅' : '❌';
    lines.push(`## ${statusEmoji} 综合评估`);
    lines.push('');
    const levelLabel = LEVEL_LABELS[report.totalLevel];
    lines.push(`| 总分 | 通过 | 优先级 | 建议段位 |`);
    lines.push(`|------|------|--------|----------|`);
    lines.push(`| **${report.totalScore}** ${levelLabel} | ${report.passed ? '✅ 通过' : '❌ 未通过'} | ${report.priority} | Lv.${report.recommendedTier} |`);
    lines.push('');

    // Dimensions table
    lines.push(`## 📊 维度评分`);
    lines.push('');
    lines.push(`| 维度 | 分数 | 等级 | 加权分 | 评价 |`);
    lines.push(`|------|------|------|--------|------|`);
    for (const dim of report.dimensions) {
      const levelEmoji = dim.level === 'excellent' ? '🌟' : dim.level === 'good' ? '✅' : dim.level === 'acceptable' ? '⚠️' : '❌';
      lines.push(`| ${dim.def.label} | ${dim.rawScore} | ${levelEmoji} | ${dim.weightedScore} | ${dim.notes} |`);
    }
    lines.push('');

    // Vetoes
    if (report.vetoes.length > 0) {
      lines.push(`## ⚠️ 否决项`);
      for (const veto of report.vetoes) {
        lines.push(`- ❌ ${veto}`);
      }
      lines.push('');
    }

    // Bonuses
    if (report.bonuses.length > 0) {
      lines.push(`## 🎁 加分项`);
      for (const bonus of report.bonuses) {
        lines.push(`- 🌟 ${bonus.rule} (+${bonus.points}分)`);
      }
      lines.push('');
    }

    // Strengths & Risks
    if (report.strengths.length > 0) {
      lines.push(`## 💪 优势`);
      for (const s of report.strengths) {
        lines.push(`- ${s}`);
      }
      lines.push('');
    }

    if (report.risks.length > 0) {
      lines.push(`## ⚠️ 风险点`);
      for (const r of report.risks) {
        lines.push(`- ${r}`);
      }
      lines.push('');
    }

    // Summary
    lines.push(`## 📝 评估摘要`);
    lines.push(report.summary);

    return lines.join('\n');
  }

  /**
   * 生成飞书消息卡片格式
   */
  toFeishuCard(report: EvaluationReport): object {
    const dimRows = report.dimensions.map(d =>
      `${d.def.label}: ${d.rawScore}分 ${LEVEL_LABELS[d.level]}`
    ).join('\n');

    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: `🎯 评估报告: ${report.candidate.name}` },
          template: report.passed ? 'green' : 'red',
        },
        elements: [
          {
            tag: 'markdown',
            content: `**总分**: ${report.totalScore}/100 ${LEVEL_LABELS[report.totalLevel]}\n**优先级**: ${report.priority}\n**通过**: ${report.passed ? '✅' : '❌'}\n**建议段位**: Lv.${report.recommendedTier}`,
          },
          { tag: 'hr' },
          {
            tag: 'markdown',
            content: `**维度评分**\n${dimRows}`,
          },
        ],
      },
    };
  }

  /**
   * 生成 JSON 结构化报告
   */
  toJSON(report: EvaluationReport): string {
    return JSON.stringify(report, null, 2);
  }

  // ── Private Helpers ──

  private generateSummary(result: EvaluationResult): string {
    const passed = result.passed;
    const score = result.score;

    if (!passed) {
      if (result.vetoed.length > 0) {
        return `综合评分 ${score}，因一票否决项未通过：${result.vetoed.join('、')}。建议调整筛选条件。`;
      }
      return `综合评分 ${score}，未达到通过标准（${result.threshold}分）。建议关注 ${score - result.threshold} 分以内的提升空间。`;
    }

    if (result.score >= 90) {
      return `综合评分 ${score}，强烈推荐。该候选人背景优秀，多项指标突出，建议优先触达。`;
    }

    if (result.score >= 80) {
      return `综合评分 ${score}，推荐。该候选人整体素质良好，建议积极触达。`;
    }

    return `综合评分 ${score}，基本符合要求。候选人有一定潜力，建议酌情触达。`;
  }

  private extractStrengthsAndRisks(result: EvaluationResult): { strengths: string[]; risks: string[] } {
    const strengths: string[] = [];
    const risks: string[] = [];

    for (const dim of result.dimensions) {
      const level = scoreToLevel(dim.score);
      if (level === 'excellent') {
        strengths.push(`${dim.name}: ${dim.notes}`);
      } else if (level === 'poor') {
        risks.push(`${dim.name}: ${dim.notes}`);
      }
    }

    return { strengths, risks };
  }

  private estimateTier(result: EvaluationResult): number {
    if (result.priority === 'critical') return 4;
    if (result.priority === 'high') return 3;
    if (result.priority === 'medium') return 2;
    return 1;
  }

  private getKeyHighlights(result: EvaluationResult): string {
    const topDims = [...result.dimensions]
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    return topDims.map(d => d.notes.split('，')[0]).join(' / ');
  }

  private calcDistribution(candidates: Array<{ result: EvaluationResult }>): ScoreDistribution {
    const dist: ScoreDistribution = { excellent: 0, good: 0, acceptable: 0, poor: 0 };

    for (const { result } of candidates) {
      const level = scoreToLevel(result.score);
      dist[level]++;
    }

    return dist;
  }

  private calcPlatformStats(candidates: Array<{ candidate: Candidate; result: EvaluationResult }>): PlatformStats[] {
    const byPlatform: Record<string, typeof candidates> = {};

    for (const c of candidates) {
      const p = c.candidate.platform;
      if (!byPlatform[p]) byPlatform[p] = [];
      byPlatform[p].push(c);
    }

    return Object.entries(byPlatform).map(([platform, items]) => ({
      platform,
      count: items.length,
      averageScore: Math.round(items.reduce((sum, c) => sum + c.result.score, 0) / items.length),
      passRate: Math.round(items.filter(c => c.result.passed).length / items.length * 100),
    }));
  }
}
