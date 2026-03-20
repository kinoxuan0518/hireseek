// @hireclaw/core/pipeline — 招聘流水线编排
//
// 把评估引擎、触达引擎、平台适配器串联成完整流水线
// Think → Plan → Build → Review → Test → Ship 的招聘版本：
// Fetch → Evaluate → Plan → Outreach → Report

import type {
  PlatformAdapter,
  Candidate,
  JobConfig,
  PipelineRunRequest,
  PipelineRunResult,
  PlatformRunResult,
  PipelineError,
  EvaluationConfig,
  OutreachConfig,
  OutreachRecord,
} from '../types.js';
import { evaluateBatch } from '../evaluator/index.js';
import type { EvaluateResult } from '../evaluator/index.js';
import { generateMessage, planOutreachBatch } from '../outreach/index.js';
import type { OutreachPlan } from '../outreach/index.js';

// ────────────────────────────────────────────────────────────
// Pipeline Events
// ────────────────────────────────────────────────────────────

export type PipelineEvent =
  | { type: 'fetch:start'; platform: string }
  | { type: 'fetch:complete'; platform: string; count: number }
  | { type: 'evaluate:start'; count: number }
  | { type: 'evaluate:complete'; results: Array<{ candidate: Candidate; result: EvaluateResult }> }
  | { type: 'outreach:start'; count: number }
  | { type: 'outreach:sent'; candidateName: string; platform: string; level: number }
  | { type: 'outreach:skipped'; candidateName: string; reason: string }
  | { type: 'outreach:complete'; sent: number; skipped: number }
  | { type: 'error'; stage: string; error: string; recoverable: boolean }
  | { type: 'complete'; result: PipelineRunResult };

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ────────────────────────────────────────────────────────────
// Pipeline Engine
// ────────────────────────────────────────────────────────────

export interface PipelineConfig {
  /** 评估配置 */
  evaluation?: EvaluationConfig;
  /** 触达配置 */
  outreach?: OutreachConfig;
  /** 事件回调 */
  onEvent?: PipelineEventHandler;
  /** 每日触达上限 */
  dailyLimit?: number;
  /** 是否只评估不触达（dry run） */
  dryRun?: boolean;
  /** 已有触达记录（避免重复） */
  existingRecords?: Map<string, OutreachRecord[]>;
}

export interface PipelineStepResult {
  stage: 'fetch' | 'evaluate' | 'outreach';
  duration: number;
  success: boolean;
}

/**
 * 招聘流水线
 *
 * 将 PlatformAdapter + Evaluator + Outreach 串联成完整流程
 *
 * @example
 * ```ts
 * const pipeline = new Pipeline(bossAdapter);
 *
 * const result = await pipeline.run(
 *   { job: myJob, platforms: ['boss'] },
 *   { dryRun: true, onEvent: (e) => console.log(e) }
 * );
 * ```
 */
export class Pipeline {
  private adapters: Map<string, PlatformAdapter> = new Map();

  /** 注册平台适配器 */
  use(adapter: PlatformAdapter): this {
    this.adapters.set(adapter.name, adapter);
    return this;
  }

  /** 获取已注册的平台列表 */
  getPlatforms(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * 运行招聘流水线
   *
   * 完整流程：获取候选人 → 评估 → 规划触达 → 执行触达 → 生成报告
   */
  async run(
    request: PipelineRunRequest,
    config: PipelineConfig = {}
  ): Promise<PipelineRunResult> {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = new Date().toISOString();
    const errors: PipelineError[] = [];
    const steps: PipelineStepResult[] = [];
    const allCandidates: Candidate[] = [];
    const platformResults: PlatformRunResult[] = [];
    let totalReached = 0;
    let totalSkipped = 0;

    const emit = config.onEvent ?? (() => {});

    // ── Step 1: Fetch candidates from platforms ──
    const platforms = request.platforms.length > 0
      ? request.platforms
      : [...this.adapters.keys()];

    for (const platformName of platforms) {
      const adapter = this.adapters.get(platformName);
      if (!adapter) {
        errors.push({
          platform: platformName,
          stage: 'fetch',
          error: `Adapter "${platformName}" not registered`,
          recoverable: true,
        });
        platformResults.push({
          platform: platformName,
          fetched: 0, evaluated: 0, passed: 0, reached: 0, skipped: 0,
          errors: [`Adapter "${platformName}" not registered`],
        });
        continue;
      }

      const stepStart = Date.now();
      emit({ type: 'fetch:start', platform: platformName });

      try {
        const fetchResult = await adapter.getCandidates({
          job: request.job,
        });

        allCandidates.push(...fetchResult.candidates);

        const platformResult: PlatformRunResult = {
          platform: platformName,
          fetched: fetchResult.candidates.length,
          evaluated: 0,
          passed: 0,
          reached: 0,
          skipped: 0,
          errors: [],
        };

        steps.push({
          stage: 'fetch',
          duration: Date.now() - stepStart,
          success: true,
        });

        platformResults.push(platformResult);
        emit({ type: 'fetch:complete', platform: platformName, count: fetchResult.candidates.length });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({
          platform: platformName,
          stage: 'fetch',
          error: errMsg,
          recoverable: true,
        });

        platformResults.push({
          platform: platformName,
          fetched: 0,
          evaluated: 0,
          passed: 0,
          reached: 0,
          skipped: 0,
          errors: [errMsg],
        });

        steps.push({
          stage: 'fetch',
          duration: Date.now() - stepStart,
          success: false,
        });

        emit({ type: 'error', stage: 'fetch', error: errMsg, recoverable: true });
      }
    }

    // ── Step 2: Evaluate all candidates ──
    const evalStart = Date.now();
    emit({ type: 'evaluate:start', count: allCandidates.length });

    const evalResults = evaluateBatch(allCandidates, request.job, {
      config: config.evaluation,
    });

    const totalEvaluated = evalResults.length;
    const totalPassed = evalResults.filter(r => r.result.passed).length;

    // Update platform results with evaluation counts
    // (proportional distribution since we evaluate all at once)
    for (const pr of platformResults) {
      pr.evaluated = Math.round(pr.fetched / Math.max(platforms.length, 1));
      pr.passed = Math.round(pr.evaluated * (totalPassed / Math.max(totalEvaluated, 1)));
    }

    steps.push({
      stage: 'evaluate',
      duration: Date.now() - evalStart,
      success: true,
    });

    emit({ type: 'evaluate:complete', results: evalResults });

    // ── Step 3: Plan outreach ──
    const outreachStart = Date.now();
    emit({ type: 'outreach:start', count: totalPassed });

    const plans = planOutreachBatch(
      evalResults.filter(r => r.result.passed).map(r => ({
        candidate: r.candidate,
        evaluation: r.result,
      })),
      request.job,
      {
        availablePlatforms: platforms,
        existingRecords: config.existingRecords,
        dailyLimit: config.dailyLimit ?? 50,
      }
    );

    const contactPlans = plans.filter(p => p.shouldContact);

    // ── Step 4: Execute outreach ──
    if (!config.dryRun) {
      for (const plan of contactPlans) {
        const candidate = evalResults.find(r => r.candidate.id === plan.candidateId)?.candidate;
        if (!candidate) continue;

        for (const attempt of plan.attempts) {
          const adapter = this.adapters.get(attempt.platform);
          if (!adapter) continue;

          const message = generateMessage({
            candidate,
            evaluation: candidate.evaluation ?? evalResults.find(r => r.candidate.id === plan.candidateId)!.result,
            job: request.job,
            tier: plan.tier,
            attemptNumber: attempt.attemptNumber,
            brandTone: config.outreach?.brandTone,
          });

          try {
            const result = await adapter.reachOut({
              candidate,
              message: message.content,
            });

            if (result.success) {
              totalReached++;
              emit({
                type: 'outreach:sent',
                candidateName: plan.candidateName,
                platform: attempt.platform,
                level: message.level,
              });
            } else if (result.rateLimited) {
              emit({
                type: 'error',
                stage: 'outreach',
                error: `Rate limited on ${attempt.platform}`,
                recoverable: true,
              });
              break; // Stop outreach for this platform
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            emit({ type: 'error', stage: 'outreach', error: errMsg, recoverable: true });
          }
        }
      }
    } else {
      // Dry run — just report what would happen
      totalReached = contactPlans.length;
      for (const plan of contactPlans) {
        emit({
          type: 'outreach:sent',
          candidateName: plan.candidateName,
          platform: plan.attempts[0]?.platform ?? 'unknown',
          level: 0,
        });
      }
    }

    totalSkipped = allCandidates.length - totalReached;

    steps.push({
      stage: 'outreach',
      duration: Date.now() - outreachStart,
      success: true,
    });

    emit({ type: 'outreach:complete', sent: totalReached, skipped: totalSkipped });

    // ── Build result ──
    const result: PipelineRunResult = {
      runId,
      job: request.job,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: errors.filter(e => !e.recoverable).length > 0 ? 'failed' : 'completed',
      platformResults,
      totalCandidates: allCandidates.length,
      totalEvaluated,
      totalPassed,
      totalReached,
      totalSkipped,
      errors,
    };

    emit({ type: 'complete', result });

    return result;
  }

  /**
   * 单步评估（不触达）
   * 只运行 Fetch → Evaluate，返回评估结果
   */
  async evaluateOnly(
    job: JobConfig,
    platforms: string[] = [],
    config: EvaluationConfig = {}
  ): Promise<Array<{ candidate: Candidate; result: EvaluateResult }>> {
    const request: PipelineRunRequest = {
      job,
      platforms,
      strategy: { evaluationStrictness: config.strictness },
    };

    // Fetch
    const allCandidates: Candidate[] = [];
    for (const platformName of platforms) {
      const adapter = this.adapters.get(platformName);
      if (!adapter) continue;
      try {
        const fetchResult = await adapter.getCandidates({ job });
        allCandidates.push(...fetchResult.candidates);
      } catch { /* skip failed platforms */ }
    }

    // Evaluate
    return evaluateBatch(allCandidates, job, { config });
  }
}
