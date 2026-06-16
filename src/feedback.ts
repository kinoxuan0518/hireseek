/**
 * 信号回流 + 校准闭环 —— 把目标锚定在"面试通过"
 *
 * HireSeek 只管 sourcing 一环，够不到入职、更够不到价值。所以目标不能定在它
 * 控制不了的下游结果上。我们把锚点定在**最靠下游、但仍能归因到 sourcing 的那个
 * 节点：面试通过**。
 *
 *   · 结果目标：找到「能过面的人」——这没法靠凑触达数刷出来，反 Goodhart
 *   · 反馈信号：你一句"张三面试过了 / 李四挂了"，就是 ground truth 回流，
 *     不需要 ATS——飞书 Bot / 指挥台 / CLI 都是这条回流通道
 *
 * 有了 ground truth，那个 v4-pro 验证器就从"没人验证的代理"变成"能对着真实
 * 结果打分的预测器"：我们把它对每个候选人的预测分（fit_predictions）和真实
 * 过面结果（interview_outcomes）一对照，就能算出——
 *
 *   它判「合适」的人，实际过面率多少；判「不合适」的，过面率又是多少。
 *
 * 这条对照(calibrationReport)就是整套"校准"哲学落地的证据：它在不在变准，
 * 一目了然，而不是又一句好听的话。
 */

import { db } from './db';

// ── 两张表：预测（验证器写）与真实结果（人类回流）──────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS fit_predictions (
    fingerprint   TEXT NOT NULL,
    name          TEXT NOT NULL,
    job_id        TEXT NOT NULL,
    predicted_fit INTEGER NOT NULL,
    doer_score    INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (fingerprint, job_id)
  );

  CREATE TABLE IF NOT EXISTS interview_outcomes (
    fingerprint TEXT,
    name        TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    result      TEXT NOT NULL,           -- passed | failed
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (fingerprint, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_outcomes_fp ON interview_outcomes(fingerprint);
`);

/**
 * 迁移：早期版本 fit_predictions 用单列主键 (fingerprint)、interview_outcomes 用
 * 自增 id 主键。CREATE TABLE IF NOT EXISTS 不会改已存在的表，导致 ON CONFLICT
 * (fingerprint, job_id) 找不到约束。这里检测旧 schema 并重建（保留旧数据）。
 */
function migrateToCompositeKey(table: string, columns: string, newDdl: string): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql: string } | undefined;
  if (!row || row.sql.includes('PRIMARY KEY (fingerprint, job_id)')) return; // 已是新结构
  db.exec(`
    ALTER TABLE ${table} RENAME TO ${table}_old;
    ${newDdl}
    INSERT OR IGNORE INTO ${table} (${columns}) SELECT ${columns} FROM ${table}_old;
    DROP TABLE ${table}_old;
  `);
}
migrateToCompositeKey('fit_predictions', 'fingerprint, name, job_id, predicted_fit, doer_score, created_at', `
  CREATE TABLE fit_predictions (
    fingerprint TEXT NOT NULL, name TEXT NOT NULL, job_id TEXT NOT NULL,
    predicted_fit INTEGER NOT NULL, doer_score INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (fingerprint, job_id)
  );`);
migrateToCompositeKey('interview_outcomes', 'fingerprint, name, job_id, result, note, created_at', `
  CREATE TABLE interview_outcomes (
    fingerprint TEXT, name TEXT NOT NULL, job_id TEXT NOT NULL, result TEXT NOT NULL, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (fingerprint, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_outcomes_fp ON interview_outcomes(fingerprint);`);

const FIT_THRESHOLD = 60; // 与验证器一致：≥ 视为"判合适"

// ── 验证器调用：登记一条预测（按 fingerprint 去重，留最新）──────────────
export function recordFitPrediction(p: {
  fingerprint: string; name: string; jobId: string; predictedFit: number; doerScore: number | null;
}): void {
  if (!p.fingerprint) return; // 无 fingerprint 无法去重/对照，跳过（避免 NULL 主键脏数据）
  db.prepare(`
    INSERT INTO fit_predictions (fingerprint, name, job_id, predicted_fit, doer_score)
    VALUES (@fingerprint, @name, @jobId, @predictedFit, @doerScore)
    ON CONFLICT(fingerprint, job_id) DO UPDATE SET
      predicted_fit = excluded.predicted_fit,
      doer_score    = excluded.doer_score,
      created_at    = datetime('now','localtime')
  `).run(p);
}

// ── 人类回流：记录面试结果 ─────────────────────────────────────────────
export interface OutcomeResult {
  ok: boolean;
  message: string;
  fingerprint: string | null;
}

/** 按姓名定位候选人并登记面试结果。找不到也照样记下（按名字），信号不丢。 */
export function recordInterviewOutcome(opts: {
  name: string; result: 'passed' | 'failed'; note?: string; jobId?: string;
}): OutcomeResult {
  const { name, result, note } = opts;

  // 定位同名候选人；带 jobId 过滤优先，避免跨岗位张冠李戴
  const matches = (opts.jobId
    ? db.prepare(`SELECT fingerprint, job_id, company FROM candidates WHERE name = ? AND job_id = ? ORDER BY contacted_at DESC`).all(name, opts.jobId)
    : db.prepare(`SELECT fingerprint, job_id, company FROM candidates WHERE name = ? ORDER BY contacted_at DESC`).all(name)
  ) as Array<{ fingerprint: string; job_id: string; company: string | null }>;

  const cand = matches[0];
  const jobId = opts.jobId ?? cand?.job_id ?? 'default';
  const fingerprint = cand?.fingerprint ?? null;
  // 同名多于一人 → 明确警告挂到了哪一个，让人有机会纠正（而不是静默取最近一条）
  const ambiguous = matches.length > 1
    ? `（有 ${matches.length} 个同名候选人，已挂到「${cand.company || '未知公司'}」那位；如不对请指定公司或 fingerprint）`
    : '';

  // 有 fingerprint 时 UPSERT 去重（更正结果覆盖最新）；name-only 则纯 INSERT
  if (fingerprint) {
    db.prepare(`
      INSERT INTO interview_outcomes (fingerprint, name, job_id, result, note)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint, job_id) DO UPDATE SET
        result = excluded.result, note = excluded.note, created_at = datetime('now','localtime')
    `).run(fingerprint, name, jobId, result, note ?? null);
    const status = result === 'passed' ? 'interviewed' : 'rejected';
    db.prepare(`UPDATE candidates SET status = ? WHERE fingerprint = ?`).run(status, fingerprint);
  } else {
    db.prepare(`INSERT INTO interview_outcomes (fingerprint, name, job_id, result, note) VALUES (?, ?, ?, ?, ?)`)
      .run(null, name, jobId, result, note ?? null);
  }

  const tag = result === 'passed' ? '✅ 过面' : '❌ 挂面';
  const known = fingerprint ? '' : '（这人不在我触达记录里，仍按姓名记下了）';
  return {
    ok: true,
    fingerprint,
    message: `已记录 ${name} ${tag}${note ? `（${note}）` : ''}${known}${ambiguous}。这条会回流去校准我对「合适」的判断。`,
  };
}

// ── 校准对照：它判「合适」的人，实际过面率多少 ──────────────────────────
export interface Calibration {
  matched: number;          // 既有预测又有结果的人数（样本量）
  passOverall: number | null;
  passWhenFit: number | null;     // 预测合适(≥阈值) 的实际过面率
  passWhenUnfit: number | null;   // 预测不合适 的实际过面率
  lift: number | null;            // passWhenFit - passWhenUnfit，>0 说明判断有效
  summary: string;
}

export function calibrationReport(jobId?: string): Calibration {
  const where = jobId ? `WHERE o.job_id = ?` : '';
  const rows = db.prepare(`
    SELECT p.predicted_fit AS fit,
           CASE WHEN o.result = 'passed' THEN 1 ELSE 0 END AS passed
    FROM interview_outcomes o
    JOIN fit_predictions p ON p.fingerprint = o.fingerprint AND p.job_id = o.job_id
    ${where}
  `).all(...(jobId ? [jobId] : [])) as Array<{ fit: number; passed: number }>;

  const matched = rows.length;
  if (matched === 0) {
    return {
      matched: 0, passOverall: null, passWhenFit: null, passWhenUnfit: null, lift: null,
      summary: '还没有「既被我预测过、又有面试结果」的候选人——等面试结果回流几条，我就能算出我判断得准不准。',
    };
  }

  const rate = (xs: Array<{ passed: number }>) =>
    xs.length ? Math.round((xs.reduce((s, r) => s + r.passed, 0) / xs.length) * 100) : null;

  const fitRows = rows.filter(r => r.fit >= FIT_THRESHOLD);
  const unfitRows = rows.filter(r => r.fit < FIT_THRESHOLD);
  const passWhenFit = rate(fitRows);
  const passWhenUnfit = rate(unfitRows);
  const passOverall = rate(rows);
  const lift = passWhenFit != null && passWhenUnfit != null ? passWhenFit - passWhenUnfit : null;

  let summary: string;
  if (matched < 5) {
    summary = `样本还小（${matched} 人有结果），先看个方向：我判合适的过面率 ${passWhenFit ?? '—'}%，判不合适的 ${passWhenUnfit ?? '—'}%。再攒几条更准。`;
  } else if (lift == null) {
    summary = `${matched} 人有结果，总体过面率 ${passOverall}%。某一档样本还不够，暂时算不出区分度。`;
  } else if (lift > 0) {
    summary = `📈 我的判断有效：判「合适」的人过面率 ${passWhenFit}%，判「不合适」的只有 ${passWhenUnfit}%，区分度 +${lift} 分（样本 ${matched}）。`;
  } else {
    summary = `⚠️ 我的判断目前没区分度甚至反向（合适 ${passWhenFit}% vs 不合适 ${passWhenUnfit}%，样本 ${matched}）——说明「合适」的定义要重校，该把过面者的共性喂回给我。`;
  }

  return { matched, passOverall, passWhenFit, passWhenUnfit, lift, summary };
}

// ── 计分板：面试通过才是结果目标，触达只是过程量 ────────────────────────
export interface GoalBoard {
  passed: number;
  failed: number;
  passRate: number | null;
  contactedTotal: number;
  calibration: Calibration;
  text: string;
}

export function goalBoard(jobId?: string): GoalBoard {
  const scope = jobId ? `WHERE job_id = ?` : '';
  const p = (db.prepare(`SELECT COUNT(*) n FROM interview_outcomes ${scope} ${scope ? 'AND' : 'WHERE'} result='passed'`)
    .get(...(jobId ? [jobId] : [])) as { n: number }).n;
  const f = (db.prepare(`SELECT COUNT(*) n FROM interview_outcomes ${scope} ${scope ? 'AND' : 'WHERE'} result='failed'`)
    .get(...(jobId ? [jobId] : [])) as { n: number }).n;
  const contacted = (db.prepare(`SELECT COUNT(*) n FROM candidates ${scope}`)
    .get(...(jobId ? [jobId] : [])) as { n: number }).n;

  const total = p + f;
  const passRate = total ? Math.round((p / total) * 100) : null;
  const calibration = calibrationReport(jobId);

  const lines = [
    '🎯 结果目标：找到能过面的人',
    '',
    `面试通过 ${p} 人${total ? `／已知结果 ${total} 人（过面率 ${passRate}%）` : '（暂无面试结果回流）'}`,
    `过程量：累计触达 ${contacted} 人`,
    '',
    calibration.summary,
  ];
  return { passed: p, failed: f, passRate, contactedTotal: contacted, calibration, text: lines.join('\n') };
}
