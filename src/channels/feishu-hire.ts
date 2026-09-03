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
// 飞书招聘 interview_record.conclusion 常见约定：1=通过/推荐，2=不通过，3=待定。
// 但不同租户/版本可能不同——用 env 覆盖，首次务必先 dry-run 看原始值再锁定。
function parseHireConclusion(raw: unknown): 'passed' | 'failed' | null {
  const s = String(raw ?? '').trim().toLowerCase();
  const passSet = (process.env.FEISHU_HIRE_PASS_VALUES || '1,通过,推荐,推荐通过,pass,recommended,hired').split(',').map(x => x.trim().toLowerCase());
  const failSet = (process.env.FEISHU_HIRE_FAIL_VALUES || '2,不通过,不推荐,未通过,淘汰,fail,rejected').split(',').map(x => x.trim().toLowerCase());
  if (passSet.includes(s)) return 'passed';
  if (failSet.includes(s)) return 'failed';
  return null; // 待定/未知 → 不写
}

/**
 * 面试官评语可能藏在哪：飞书招聘不同租户/版本的面试记录结构差异很大，
 * 评语有时直接挂在 record 上，有时埋在评分表单的逐题作答里。
 */
const FEEDBACK_KEYS = new Set([
  'content', 'comment', 'commentary', 'evaluation', 'evaluation_detail', 'feedback',
  'conclusion_detail', 'remark', 'remarks', 'note', 'notes', 'description',
  'answer', 'answer_content', 'text', 'summary', 'advantage', 'disadvantage',
]);

const MAX_FEEDBACK_CHARS = 4000;

/**
 * 深挖一条面试记录里的评语文本。
 *
 * 刻意做成"按 key 名收集字符串"的通用遍历，而不是绑死某一版 schema——
 * 本机无法预演真实租户的返回结构，宁可多收一点也别静默丢掉最值钱的信号。
 */
export function extractInterviewFeedback(record: unknown, maxChars = MAX_FEEDBACK_CHARS): string {
  const found: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (node == null || depth > 6) return;
    if (typeof node === 'object') {
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (FEEDBACK_KEYS.has(key.toLowerCase())) {
          if (typeof value === 'string') {
            const text = value.trim();
            // 纯数字/枚举值是结论码，不是评语
            if (text && !/^\d+$/.test(text) && !found.includes(text)) found.push(text);
          } else {
            walk(value, depth + 1);
          }
        } else {
          walk(value, depth + 1);
        }
      }
    }
  };

  walk(record, 0);
  return found.join('\n').slice(0, maxChars).trim();
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

  // 面试列表里往往只带结论码，评语要按 record id 再取一次详情
  const detailCache = new Map<string, unknown>();
  const recordDetail = async (recordId?: string): Promise<unknown> => {
    if (!recordId) return null;
    if (detailCache.has(recordId)) return detailCache.get(recordId);
    try {
      const r: any = await client.hire.interviewRecord.get({ path: { interview_record_id: recordId } });
      const detail = r?.data?.interview_record ?? r?.data ?? null;
      detailCache.set(recordId, detail);
      return detail;
    } catch {
      detailCache.set(recordId, null);
      return null;
    }
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
      const interviewer = rec?.interviewer?.name ?? rec?.interviewer_name ?? rec?.user_name ?? undefined;
      if (!result) { base.skipped.push(`${tName}：结论"${raw ?? '空'}"非通过/不通过（待定或未知）`); continue; }

      let feedback = extractInterviewFeedback(rec);
      if (!feedback) {
        const detail = await recordDetail(rec?.id ?? rec?.interview_record_id);
        if (detail) feedback = extractInterviewFeedback(detail);
      }

      base.resolved.push({
        name: tName,
        result,
        interviewer,
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
