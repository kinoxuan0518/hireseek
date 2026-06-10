/**
 * 技能自改写引擎（进化闭环下半场）
 *
 * 把复盘提案落地到 workspace/references/*.md：
 * - 每次进化单独 git commit，留完整版本链
 * - 进化日志写入 DB（文件、理由、commit sha），支持效果追踪与 A/B 对比
 * - 一键回滚：git revert 进化 commit
 *
 * 安全设计：只允许改 EVOLVABLE_FILES 白名单内的文件；
 * dry-run 模式只出报告不落盘。
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { config } from '../config';
import { db } from '../db';
import { EVOLVABLE_FILES } from './retrospect';
import type { EvolutionProposal, Retrospective } from './retrospect';

// ── 进化日志表 ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS evolution_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_key    TEXT NOT NULL,
    reason      TEXT NOT NULL,
    diagnosis   TEXT,
    commit_sha  TEXT,
    rolled_back INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const REPO_ROOT = path.join(__dirname, '..', '..');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
}

export interface ApplyResult {
  applied: Array<{ file: string; commitSha: string; reason: string }>;
  skipped: Array<{ file: string; why: string }>;
}

/**
 * 应用进化提案。每个文件一个独立 commit，方便单独回滚与效果归因。
 */
export function applyProposals(retro: Retrospective, opts: { dryRun?: boolean } = {}): ApplyResult {
  const result: ApplyResult = { applied: [], skipped: [] };

  for (const p of retro.proposals) {
    const relPath = EVOLVABLE_FILES[p.file];
    if (!relPath) {
      result.skipped.push({ file: p.file, why: '不在可进化白名单内' });
      continue;
    }

    const absPath = path.join(config.workspace.dir, relPath);
    const current = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';

    if (current.trim() === p.newContent.trim()) {
      result.skipped.push({ file: p.file, why: '内容无变化' });
      continue;
    }

    if (opts.dryRun) {
      result.skipped.push({ file: p.file, why: `[dry-run] 将改写 ${relPath}（${p.reason.slice(0, 80)}）` });
      continue;
    }

    fs.writeFileSync(absPath, p.newContent, 'utf-8');

    let sha = '';
    try {
      const repoRel = path.relative(REPO_ROOT, absPath);
      git('add', repoRel);
      git('commit', '-m', `evolve(${p.file}): 数据驱动进化\n\n${p.reason}\n\n[hireseek-evolution]`);
      sha = git('rev-parse', 'HEAD');
    } catch (err) {
      // git 失败不阻断（文件已落盘），日志里 sha 留空
      console.error(`[进化] git 提交失败（文件已写入）: ${err instanceof Error ? err.message : err}`);
    }

    db.prepare(`
      INSERT INTO evolution_log (file_key, reason, diagnosis, commit_sha)
      VALUES (?, ?, ?, ?)
    `).run(p.file, p.reason, JSON.stringify(retro.diagnosis), sha || null);

    result.applied.push({ file: p.file, commitSha: sha, reason: p.reason });
  }

  return result;
}

/** 回滚最近一次未回滚的进化（git revert + 标记日志） */
export function rollbackLastEvolution(): string {
  const row = db.prepare(`
    SELECT id, file_key, commit_sha FROM evolution_log
    WHERE rolled_back = 0 AND commit_sha IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get() as { id: number; file_key: string; commit_sha: string } | undefined;

  if (!row) return '没有可回滚的进化记录。';

  git('revert', '--no-edit', row.commit_sha);
  db.prepare(`UPDATE evolution_log SET rolled_back = 1 WHERE id = ?`).run(row.id);

  return `已回滚进化 #${row.id}（${row.file_key}，commit ${row.commit_sha.slice(0, 7)}）。`;
}

/** 进化历史（供 chat / CLI 查看，也是 A/B 归因的时间轴） */
export function evolutionHistory(limit = 10): string {
  const rows = db.prepare(`
    SELECT id, file_key, reason, commit_sha, rolled_back, created_at
    FROM evolution_log ORDER BY id DESC LIMIT ?
  `).all(limit) as Array<{ id: number; file_key: string; reason: string; commit_sha: string | null; rolled_back: number; created_at: string }>;

  if (rows.length === 0) return '暂无进化记录。';

  return rows.map(r =>
    `#${r.id} [${r.created_at.slice(0, 16)}] ${r.file_key}${r.rolled_back ? '（已回滚）' : ''}` +
    `${r.commit_sha ? ` @${r.commit_sha.slice(0, 7)}` : ''}\n   ${r.reason.slice(0, 150)}`,
  ).join('\n');
}

/**
 * 进化效果对比：以最近一次进化时间为界，对比前后回复率。
 * 这是 A/B 归因的最简实现——进化前 vs 进化后。
 */
export function evolutionImpact(): string {
  const last = db.prepare(`
    SELECT created_at, file_key FROM evolution_log
    WHERE rolled_back = 0 ORDER BY id DESC LIMIT 1
  `).get() as { created_at: string; file_key: string } | undefined;

  if (!last) return '暂无进化记录，无法对比。';

  const stats = (where: string) => db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status != 'contacted' THEN 1 ELSE 0 END) as progressed
    FROM candidates WHERE contacted_at ${where}
  `).get(last.created_at) as { total: number; progressed: number };

  const before = stats('< ?');
  const after = stats('>= ?');

  const rate = (s: { total: number; progressed: number }) =>
    s.total > 0 ? `${Math.round((s.progressed / s.total) * 100)}%（${s.progressed}/${s.total}）` : '无数据';

  return [
    `最近进化：${last.created_at.slice(0, 16)}（${last.file_key}）`,
    `进化前推进率：${rate(before)}`,
    `进化后推进率：${rate(after)}`,
    after.total < 30 ? '⚠️ 进化后样本 <30，结论尚不可靠，继续积累数据。' : '',
  ].filter(Boolean).join('\n');
}
