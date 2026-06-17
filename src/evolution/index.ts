/**
 * 进化闭环统一入口：复盘 → 改写 → 报告
 */

import { runRetrospective } from './retrospect';
import { recalibrateFromOutcomes } from './recalibrate';
import { applyProposals, evolutionHistory, evolutionImpact, rollbackLastEvolution } from './skill-evolver';

export { runRetrospective, recalibrateFromOutcomes, applyProposals, evolutionHistory, evolutionImpact, rollbackLastEvolution };

export interface EvolveOptions {
  dryRun?: boolean;
  /** 完成后推送飞书报告 */
  notify?: boolean;
}

/** 跑一轮完整进化闭环，返回人类可读报告 */
export async function evolve(opts: EvolveOptions = {}): Promise<string> {
  const retro = await runRetrospective();
  const result = applyProposals(retro, { dryRun: opts.dryRun });

  const lines = [
    `🧬 HireSeek 进化复盘${opts.dryRun ? '（dry-run，未落盘）' : ''}`,
    '',
    '## 数据诊断',
    ...retro.diagnosis.map(d => `- ${d}`),
    '',
  ];

  if (result.applied.length > 0) {
    lines.push('## 已应用的进化');
    for (const a of result.applied) {
      lines.push(`- ${a.file} @${a.commitSha.slice(0, 7) || '(未提交)'}：${a.reason.slice(0, 120)}`);
    }
    lines.push('', '回滚命令：hireseek evolve --rollback');
  } else {
    lines.push('## 结论：本轮不改写');
  }

  if (result.skipped.length > 0) {
    lines.push('', '## 跳过');
    for (const s of result.skipped) lines.push(`- ${s.file}: ${s.why}`);
  }

  lines.push('', evolutionImpact());

  const report = lines.join('\n');

  if (opts.notify) {
    const { sendMessage } = await import('../channels/feishu');
    await sendMessage(report);
  }

  return report;
}

/**
 * 学习闭环：把真实过面结果回喂，自动重校"合适"的定义（candidate-evaluation.md）。
 * 与 evolve 同源的安全机制（每文件独立 git commit、可回滚、铁律无数据不改）。
 */
export async function learn(opts: EvolveOptions = {}): Promise<string> {
  const retro = await recalibrateFromOutcomes();
  const result = applyProposals(retro, { dryRun: opts.dryRun });

  const lines = [
    `🧠 HireSeek "合适"定义重校${opts.dryRun ? '（dry-run，未落盘）' : ''}`,
    '',
    '## 校准诊断',
    ...retro.diagnosis.map(d => `- ${d}`),
    '',
  ];

  if (result.applied.length > 0) {
    lines.push('## 已重写"合适"的定义');
    for (const a of result.applied) {
      lines.push(`- ${a.file} @${a.commitSha.slice(0, 7) || '(未提交)'}：${a.reason.slice(0, 140)}`);
    }
    lines.push('', '回滚命令：hireseek evolve back');
  } else if (retro.proposals.length > 0 && opts.dryRun) {
    lines.push('## 有改写提案（dry-run 未落盘）', `- ${retro.proposals[0].reason}`);
  } else {
    lines.push('## 结论：本轮不改写"合适"的定义');
  }

  const report = lines.join('\n');
  if (opts.notify) {
    const { sendMessage } = await import('../channels/feishu');
    await sendMessage(report);
  }
  return report;
}
