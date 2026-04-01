// @hireclaw/core/evaluator — 评估引擎主入口
//
// 参考 Claude Code 的结构化评估模式：
// - 清晰的维度定义（Dimensions.ts）
// - 结构化报告生成（ReportGenerator.ts）
// - 支持规则引擎评估（rules.ts）作为 fallback
//
// 主要导出 `Evaluator` 类，协调所有评估子模块

import type { Candidate, JobConfig, EvaluationConfig, EvaluationResult } from '../types.js';
import { evaluate, evaluateBatch } from './rules.js';
import { type ScoredDimension, validateWeights, normalizeWeights, DIMENSION_DEFINITIONS } from './dimensions/Dimensions.js';
import { ReportGenerator, type EvaluationReport } from './report/ReportGenerator.js';

// ────────────────────────────────────────────────────────────
// Evaluator Class
// ────────────────────────────────────────────────────────────

export interface EvaluatorConfig {
  /** 评估配置 */
  config?: EvaluationConfig;
  /** 是否自动生成报告 */
  autoReport?: boolean;
}

/**
 * 候选人评估引擎
 *
 * 协调维度定义、规则评估和报告生成
 *
 * @example
 * ```typescript
 * const evaluator = new Evaluator({ config: { strictness: 'standard' } });
 *
 * // 评估单个候选人
 * const report = evaluator.evaluate(candidate, job);
 * console.log(report.totalScore, report.passed);
 *
 * // 批量评估
 * const batchReport = evaluator.evaluateBatch(candidates, job);
 * console.log(batchReport.rankings);
 *
 * // 输出 Markdown 报告
 * const md = evaluator.toMarkdown(report);
 * ```
 */
export class Evaluator {
  private config: EvaluationConfig;
  private autoReport: boolean;
  private reportGenerator: ReportGenerator;

  constructor(config: EvaluatorConfig = {}) {
    this.config = config.config ?? {};
    this.autoReport = config.autoReport ?? true;
    this.reportGenerator = new ReportGenerator();

    // Validate weights if provided
    if (this.config.weights) {
      const { valid, errors } = validateWeights(this.config.weights);
      if (!valid) {
        console.warn('[Evaluator] Invalid weights:', errors.join(', '));
      }
    }
  }

  /**
   * 评估单个候选人
   */
  evaluate(candidate: Candidate, job: JobConfig): EvaluationResult {
    return evaluate(candidate, job, {
      config: this.config,
    });
  }

  /**
   * 评估单个候选人并生成报告
   */
  evaluateAndReport(candidate: Candidate, job: JobConfig): EvaluationReport {
    const result = this.evaluate(candidate, job);
    return this.reportGenerator.generate(candidate, job.id, result);
  }

  /**
   * 批量评估候选人
   */
  evaluateBatch(candidates: Candidate[], job: JobConfig): Array<{ candidate: Candidate; result: EvaluationResult }> {
    return evaluateBatch(candidates, job, {
      config: this.config,
    });
  }

  /**
   * 批量评估并生成排名报告
   */
  evaluateBatchAndReport(candidates: Candidate[], job: JobConfig) {
    const results = this.evaluateBatch(candidates, job);
    return this.reportGenerator.generateBatch(results, job.id, job.title);
  }

  /**
   * 生成 Markdown 格式报告
   */
  toMarkdown(report: EvaluationReport): string {
    return this.reportGenerator.toMarkdown(report);
  }

  /**
   * 生成飞书消息卡片
   */
  toFeishuCard(report: EvaluationReport): object {
    return this.reportGenerator.toFeishuCard(report);
  }

  /**
   * 生成 JSON 格式报告
   */
  toJSON(report: EvaluationReport): string {
    return this.reportGenerator.toJSON(report);
  }

  /**
   * 获取维度定义摘要
   */
  getDimensionSummary(): Array<{ name: string; label: string; description: string; defaultWeight: number }> {
    return Object.values(DIMENSION_DEFINITIONS).map(d => ({
      name: d.name,
      label: d.label,
      description: d.description,
      defaultWeight: d.defaultWeight,
    }));
  }

  /**
   * 获取权重配置建议
   */
  getSuggestedWeights(focus: 'technical' | 'balanced' | 'cultural'): Record<string, number> {
    switch (focus) {
      case 'technical':
        return {
          education: 0.10,
          experience: 0.30,
          skills: 0.30,
          company: 0.10,
          growth: 0.10,
          personality: 0.10,
        };
      case 'balanced':
        return {
          education: 0.15,
          experience: 0.25,
          skills: 0.25,
          company: 0.15,
          growth: 0.10,
          personality: 0.10,
        };
      case 'cultural':
        return {
          education: 0.10,
          experience: 0.20,
          skills: 0.20,
          company: 0.10,
          growth: 0.20,
          personality: 0.20,
        };
    }
  }
}

// ────────────────────────────────────────────────────────────
// Re-exports
// ────────────────────────────────────────────────────────────

export { DIMENSION_DEFINITIONS, validateWeights, normalizeWeights, scoreToLevel, LEVEL_LABELS, LEVEL_COLORS } from './dimensions/Dimensions.js';
export type { DimensionDef, DimensionKey, ScoreLevel, ScoredDimension } from './dimensions/Dimensions.js';
export { ReportGenerator } from './report/ReportGenerator.js';
export type { EvaluationReport, BatchReport, RankedCandidate, ScoreDistribution } from './report/ReportGenerator.js';
