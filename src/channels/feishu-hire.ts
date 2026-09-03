/**
 * 飞书招聘自动闭环 —— 把"面试结果"从人工回流升级成自动拉取
 *
 * 上一层（feedback.ts）靠人一句"张三过面了"回流 ground truth。这一层让 Seeya
 * 直接从外部系统把结果拉回来，真正闭环，还顺带补上"面试官维度"。两个来源：
 *
 *   ① 飞书招聘 ATS：client.hire.interview.list 拉面试 + 每位面试官的结论，
 *      client.hire.talent 把人对回本地候选人 → recordInterviewOutcome（带面试官）
 *   ② 飞书多维表格：复用 fetchRecruitingRecords 读"招聘表"里的面试结果列
 *
 * 设计铁律（外部数据不可控 + 本机无法预演真实 schema）：
 *   · **默认 dry-run**：先把"会写什么"列给你看，确认无误才落库（--apply / dryRun:false）
 *   · **防御式映射**：飞书招聘的结论 enum / 表格的列名都可能因租户而异，全部可配，
 *     dry-run 会打印原始值，让你照着真实数据把映射一次锁定
 *   · **权限/未启用优雅降级**：报清楚缺哪个 scope、该开哪个开关，绝不静默吞掉
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { config } from '../config';
import { recordInterviewOutcome, type OutcomeResult } from '../feedback';

export interface SyncOutcome {
  name: string;
  result: 'passed' | 'failed';
  interviewer?: string;
  /** 面试官写的评语原文——"为什么判他过/挂"，重校时比过/挂这个二元位有用得多 */
  feedback?: string;
  raw: string;            // 原始结论值/列值，dry-run 时给你核对映射
  source: 'hire' | 'bitable';
  written?: OutcomeResult;
}

export interface SyncReport {
  source: 'hire' | 'bitable' | 'none';
  dryRun: boolean;
  scanned: number;        // 扫到多少条带结论的记录
  resolved: SyncOutcome[]; // 能映射成 passed/failed 的
  skipped: string[];      // 跳过的原因（待定/无结论/列缺失等）
  error?: string;
  text: string;
}

// ── 结论映射（可配，dry-run 会暴露原始值）─────────────────────────────
// 文档口径（hire/v1 interview_record.conclusion）：1=通过、2=不通过、3=未开始、
// 4=未提交、5=未到场、6=待定。只有 1/2 是可用信号，其余一律跳过。
// 仍留 env 覆盖：租户可能自定义评价表，首次务必先 dry-run 看原始值再锁定。
function parseHireConclusion(raw: unknown): 'passed' | 'failed' | null {
  const s = String(raw ?? '').trim().toLowerCase();
  const passSet = (process.env.FEISHU_HIRE_PASS_VALUES || '1,通过,推荐,推荐通过,pass,recommended,hired').split(',').map(x => x.trim().toLowerCase());
  const failSet = (process.env.FEISHU_HIRE_FAIL_VALUES || '2,不通过,不推荐,未通过,淘汰,fail,rejected').split(',').map(x => x.trim().toLowerCase());
  if (passSet.includes(s)) return 'passed';
  if (failSet.includes(s)) return 'failed';
  return null; // 待定/未知 → 不写
}

const MAX_FEEDBACK_CHARS = 4000;

/** 飞书大量字段是 i18n 对象 {zh_cn, en_us}；直接 String() 会得到 [object Object] */
function i18n(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const obj = value as { zh_cn?: unknown; en_us?: unknown };
    const zh = typeof obj.zh_cn === 'string' ? obj.zh_cn.trim() : '';
    const en = typeof obj.en_us === 'string' ? obj.en_us.trim() : '';
    return zh || en;
  }
  return '';
}

export function interviewerName(record: unknown): string {
  const rec = record as { interviewer?: { name?: unknown }; interviewer_name?: unknown; user_name?: unknown } | null;
  return i18n(rec?.interviewer?.name) || i18n(rec?.interviewer_name) || i18n(rec?.user_name);
}

/**
 * 按飞书招聘的实际返回结构取面评。
 *
 * v1（hire/v1/interview_records）：content 是总评，dimension_assessment_list[].content 是各维度评语，
 * interview_score.zh_description 是结论档位的人话描述（"通过, 能力达到要求, 建议录用"）。
 * v2（hire/v2/interview_records）：module_assessments → dimension_assessments，
 * 描述题作答在 dimension_content，逐题作答在 question_assessments[].content。
 *
 * 维度名和作答要绑在一起输出——脱离题目的一句"还不错"对重校没有价值。
 */
export function extractInterviewFeedback(record: unknown, maxChars = MAX_FEEDBACK_CHARS): string {
  if (!record || typeof record !== 'object') return '';
  const rec = record as Record<string, any>;
  const lines: string[] = [];
  const push = (text: string) => {
    const trimmed = text.trim();
    if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
  };

  // 结论档位：比裸的 conclusion 枚举值多带了面试官口径
  const levelDesc = i18n(rec.interview_score?.zh_description ?? rec.interview_score?.en_description);
  if (levelDesc) push(`面试结论档位：${levelDesc}`);

  const score = rec.record_score?.score;
  const total = rec.record_score?.total_score;
  if (typeof score === 'number') push(`面试得分：${score}${typeof total === 'number' ? `/${total}` : ''}`);

  // v1 总评
  if (typeof rec.content === 'string') push(`总评：${rec.content}`);

  // v1 维度评价
  for (const dim of rec.dimension_assessment_list ?? []) {
    const name = i18n(dim?.name) || '维度';
    const verdict = i18n(dim?.dimension_score?.name);
    const content = typeof dim?.content === 'string' ? dim.content.trim() : '';
    if (content || verdict) push(`${name}${verdict ? `（${verdict}）` : ''}：${content || verdict}`);
  }

  // v2 模块 → 维度 → 面试题
  for (const mod of rec.module_assessments ?? []) {
    for (const dim of mod?.dimension_assessments ?? []) {
      const name = i18n(dim?.dimension_name) || '维度';
      const parts: string[] = [];
      if (typeof dim?.dimension_content === 'string' && dim.dimension_content.trim()) parts.push(dim.dimension_content.trim());
      const option = i18n(dim?.dimension_option?.name);
      if (option) parts.push(option);
      for (const opt of dim?.dimension_options ?? []) {
        const label = i18n(opt?.name);
        if (label && !parts.includes(label)) parts.push(label);
      }
      if (typeof dim?.dimension_score === 'number') parts.push(`打分 ${dim.dimension_score}`);
      const level = i18n(dim?.recommended_job_level?.lower_limit_job_level_name);
      const levelHigh = i18n(dim?.recommended_job_level?.higher_limit_job_level_name);
      if (level || levelHigh) parts.push(`职级建议 ${[level, levelHigh].filter(Boolean).join('~')}`);
      if (parts.length) push(`${name}：${parts.join('；')}`);

      for (const q of dim?.question_assessments ?? []) {
        const title = i18n(q?.title);
        const answer = typeof q?.content === 'string' ? q.content.trim() : '';
        if (answer) push(`面试题「${title || '未命名'}」候选人作答：${answer}`);
      }
    }
  }

  return lines.join('\n').slice(0, maxChars).trim();
}

function parseBitableResult(raw: unknown): 'passed' | 'failed' | null {
  // 多维表格的值可能是字符串、选项对象、数组，统一拍平成文本
  const flat = Array.isArray(raw)
    ? raw.map(v => (typeof v === 'object' && v ? (v as any).text ?? (v as any).name ?? JSON.stringify(v) : v)).join(' ')
    : typeof raw === 'object' && raw ? (raw as any).text ?? (raw as any).name ?? JSON.stringify(raw) : String(raw ?? '');
  const s = flat.trim().toLowerCase();
  if (!s) return null;
  const passSet = (process.env.FEISHU_BITABLE_PASS_VALUES || '通过,过面,过,已通过,推荐,offer,入职,pass').split(',').map(x => x.trim().toLowerCase());
  const failSet = (process.env.FEISHU_BITABLE_FAIL_VALUES || '不通过,挂面,挂,未通过,淘汰,拒绝,放弃,fail').split(',').map(x => x.trim().toLowerCase());
  if (passSet.some(p => s.includes(p))) return 'passed';
  if (failSet.some(f => s.includes(f))) return 'failed';
  return null;
}

// ── 来源 ①：飞书招聘 ATS ───────────────────────────────────────────────
const HIRE_SCOPES = 'hire:interview:readonly、hire:talent:readonly（或对应读权限）';

export async function syncFromHire(opts: { dryRun?: boolean; sinceDays?: number } = {}): Promise<SyncReport> {
  const dryRun = opts.dryRun !== false;
  const base: SyncReport = { source: 'hire', dryRun, scanned: 0, resolved: [], skipped: [], text: '' };

  const { appId, appSecret } = config.feishu;
  if (!appId || !appSecret) {
    return { ...base, error: '缺少 FEISHU_APP_ID / FEISHU_APP_SECRET', text: '飞书招聘同步未配置应用凭证。' };
  }

  const client = new lark.Client({ appId, appSecret });

  // 时间窗：默认最近 30 天的面试
  const sinceMs = Date.now() - (opts.sinceDays ?? 30) * 86_400_000;

  let interviews: any[] = [];
  try {
    // 分页拉面试列表（不同版本字段略有差异，全部防御式读取）
    let pageToken: string | undefined;
    do {
      const res: any = await client.hire.interview.list({
        params: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
      });
      const data = res?.data ?? res;
      const items: any[] = data?.items ?? [];
      interviews.push(...items);
      pageToken = data?.has_more ? data?.page_token : undefined;
    } while (pageToken && interviews.length < 500);
  } catch (err: any) {
    const msg = err?.response?.data?.msg || err?.message || String(err);
    const permLike = /permission|scope|access|99991|forbidden|无权限/i.test(msg);
    return {
      ...base,
      error: msg,
      text: permLike
        ? `飞书招聘接口无权限：${msg}\n请在自建应用里开通【${HIRE_SCOPES}】并发布版本后重试。`
        : `飞书招聘接口调用失败：${msg}\n（若你们其实没用飞书招聘 ATS，用 bitable 来源即可。）`,
    };
  }

  // 收集 talent 名字（把面试对回本地候选人靠姓名）
  const talentCache = new Map<string, string>();
  const talentName = async (talentId?: string): Promise<string> => {
    if (!talentId) return '';
    if (talentCache.has(talentId)) return talentCache.get(talentId)!;
    try {
      const r: any = await client.hire.talent.get({ path: { talent_id: talentId } });
      const name = r?.data?.talent?.basic_info?.name ?? r?.data?.talent?.name ?? '';
      talentCache.set(talentId, name);
      return name;
    } catch { return ''; }
  };

  // 面试列表带的评价往往不全；v2 详情含模块/维度/逐题作答，取不到再退 v1
  const detailCache = new Map<string, unknown>();
  const recordDetail = async (recordId?: string): Promise<unknown> => {
    if (!recordId) return null;
    if (detailCache.has(recordId)) return detailCache.get(recordId);
    const path = { interview_record_id: recordId };
    for (const fetch of [
      () => (client.hire as any).v2?.interviewRecord?.get({ path }),
      () => client.hire.interviewRecord.get({ path }),
    ]) {
      try {
        const r: any = await fetch();
        const detail = r?.data?.interview_record ?? null;
        if (detail) {
          detailCache.set(recordId, detail);
          return detail;
        }
      } catch { /* 换下一个版本重试 */ }
    }
    detailCache.set(recordId, null);
    return null;
  };

  for (const iv of interviews) {
    const beginMs = Number(iv?.begin_time ?? iv?.start_time ?? 0);
    if (beginMs && beginMs < sinceMs) continue;

    // 每位面试官一条 record；取其结论
    const records: any[] = iv?.interview_record_list ?? iv?.interview_records ?? (iv?.interview_record ? [iv.interview_record] : []);
    const tName = await talentName(iv?.talent_id);
    if (!tName) { base.skipped.push(`面试 ${iv?.id ?? '?'}：拿不到候选人姓名`); continue; }

    for (const rec of records.length ? records : [iv]) {
      base.scanned++;
      const raw = rec?.conclusion ?? rec?.conclusion_status ?? iv?.conclusion;
      const result = parseHireConclusion(raw);
      if (!result) { base.skipped.push(`${tName}：结论"${raw ?? '空'}"非通过/不通过（待定或未知）`); continue; }

      // 列表里的评价常常只有总评；详情把维度和逐题作答一并带回来
      const detail = await recordDetail(rec?.id ?? rec?.interview_record_id);
      const feedback = [extractInterviewFeedback(detail), extractInterviewFeedback(rec)]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] ?? '';

      base.resolved.push({
        name: tName,
        result,
        interviewer: interviewerName(detail) || interviewerName(rec) || undefined,
        feedback: feedback || undefined,
        raw: String(raw),
        source: 'hire',
      });
    }
  }

  return finalize(base);
}

// ── 来源 ②：飞书多维表格（招聘表）────────────────────────────────────
export async function syncFromBitable(opts: { dryRun?: boolean } = {}): Promise<SyncReport> {
  const dryRun = opts.dryRun !== false;
  const base: SyncReport = { source: 'bitable', dryRun, scanned: 0, resolved: [], skipped: [], text: '' };

  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN || config.feishu.bitable.appToken;
  if (!appToken) return { ...base, error: '未配置 FEISHU_BITABLE_APP_TOKEN', text: '未配置招聘多维表格。' };

  let records: Array<{ fields: Record<string, unknown> }>;
  try {
    const { fetchRecruitingRecords } = await import('./feishu');
    records = await fetchRecruitingRecords(500);
  } catch (err: any) {
    return { ...base, error: err?.message ?? String(err), text: `读取多维表格失败：${err?.message ?? err}` };
  }

  // 字段名可配；不配则在常见候选里自动探测
  const nameKeys = (process.env.FEISHU_BITABLE_NAME_FIELD || '姓名,候选人,候选人姓名,name,Name').split(',').map(s => s.trim());
  const resultKeys = (process.env.FEISHU_BITABLE_RESULT_FIELD || '面试结果,面试结论,终面结果,结果,状态,面试状态').split(',').map(s => s.trim());
  const pick = (fields: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (k in fields && fields[k] != null && String(fields[k]).trim()) return fields[k];
    return undefined;
  };

  for (const r of records) {
    const rawName = pick(r.fields, nameKeys);
    const rawResult = pick(r.fields, resultKeys);
    if (rawName == null || rawResult == null) continue;
    base.scanned++;
    const name = Array.isArray(rawName) ? String((rawName[0] as any)?.text ?? rawName[0]) : String((rawName as any)?.text ?? rawName).trim();
    const result = parseBitableResult(rawResult);
    if (!result) { base.skipped.push(`${name}：结果列"${JSON.stringify(rawResult).slice(0, 30)}"无法判定过/挂`); continue; }
    base.resolved.push({ name, result, raw: JSON.stringify(rawResult).slice(0, 40), source: 'bitable' });
  }

  if (base.scanned === 0) {
    base.skipped.push(`没扫到"姓名 + 面试结果"两列都齐的行。当前找姓名列：${nameKeys.join('/')}；找结果列：${resultKeys.join('/')}。可用 FEISHU_BITABLE_NAME_FIELD / FEISHU_BITABLE_RESULT_FIELD 指定真实列名。`);
  }
  return finalize(base);
}

// ── 落库（非 dry-run 时）+ 出报告 ──────────────────────────────────────
function finalize(base: SyncReport): SyncReport {
  if (!base.dryRun) {
    for (const o of base.resolved) {
      const note = o.source === 'hire' ? '飞书招聘' : '飞书表格';
      o.written = recordInterviewOutcome({
        name: o.name,
        result: o.result,
        note,
        interviewer: o.interviewer,
        feedback: o.feedback,
      });
    }
  }

  const head = `📥 飞书${base.source === 'hire' ? '招聘' : '多维表格'}面试结果同步${base.dryRun ? '（dry-run 预览，未落库）' : '（已落库）'}`;
  const lines = [head, ''];
  if (base.error) lines.push(`⚠️ ${base.text || base.error}`);
  else {
    const withFeedback = base.resolved.filter(o => o.feedback).length;
    lines.push(`扫描带结论记录 ${base.scanned} 条，可映射 ${base.resolved.length} 条（其中 ${withFeedback} 条带面试官评语）：`);
    for (const o of base.resolved.slice(0, 20)) {
      lines.push(`· ${o.name} → ${o.result === 'passed' ? '过面✅' : '挂面❌'}${o.interviewer ? `（面试官 ${o.interviewer}）` : ''}　[原始:${o.raw}]`);
      if (o.feedback) lines.push(`    评语：${o.feedback.replace(/\s+/g, ' ').slice(0, 120)}${o.feedback.length > 120 ? '…' : ''}`);
    }
    if (base.resolved.length > 20) lines.push(`…还有 ${base.resolved.length - 20} 条`);
    if (base.source === 'hire' && base.resolved.length > 0 && withFeedback === 0) {
      lines.push('', '⚠️ 一条评语都没取到：可能是没开 hire:interview:readonly 的评价读权限，或本租户把评语放在别的字段。评语是重校最有用的信号，值得排查。');
    }
    if (base.skipped.length) {
      lines.push('', `跳过 ${base.skipped.length} 条：`);
      base.skipped.slice(0, 8).forEach(s => lines.push(`· ${s}`));
    }
    if (base.dryRun && base.resolved.length) lines.push('', '确认映射无误后，用 `seeya hire-sync` 真正落库（会回流去校准"合适"的判断）。');
  }
  base.text = lines.join('\n');
  return base;
}

// ── 统一入口：先招聘 ATS，再表格兜底 ───────────────────────────────────
export async function syncInterviewOutcomes(opts: { dryRun?: boolean } = {}): Promise<SyncReport> {
  const dryRun = opts.dryRun !== false;
  const hireEnabled = process.env.FEISHU_HIRE_ENABLED === 'true';
  const bitableConfigured = Boolean(process.env.FEISHU_BITABLE_APP_TOKEN || config.feishu.bitable.appToken);

  if (hireEnabled) {
    const r = await syncFromHire({ dryRun });
    // 招聘 ATS 拿到数据就用它（最权威，含面试官维度）；无权限/无数据再退表格
    if (!r.error && r.resolved.length > 0) return r;
    if (bitableConfigured) {
      const b = await syncFromBitable({ dryRun });
      b.text = `${r.text}\n\n（飞书招聘未取到可用结果，已回退多维表格）\n\n${b.text}`;
      return b;
    }
    return r;
  }

  if (bitableConfigured) return syncFromBitable({ dryRun });

  return {
    source: 'none', dryRun, scanned: 0, resolved: [], skipped: [],
    text: '未启用任何结果来源：设 FEISHU_HIRE_ENABLED=true 走飞书招聘 ATS，或配置 FEISHU_BITABLE_APP_TOKEN 走多维表格。',
  };
}
