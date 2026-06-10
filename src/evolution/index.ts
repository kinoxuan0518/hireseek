/**
 * 进化闭环统一入口：复盘 → 改写 → 报告
 */

import { runRetrospective } from './retrospect';
import { applyProposals, evolutionHistory, evolutionImpact, rollbackLastEvolution } from './skill-evolver';

export { runRetrospective, applyProposals, evolutionHistory, evolutionImpact, rollbackLastEvolution };

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
