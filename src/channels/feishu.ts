import axios from 'axios';
import { config } from '../config';

export async function sendMessage(text: string): Promise<void> {
  if (!config.feishu.webhookUrl) {
    // 未配置时只打印到终端
    console.log('\n─────────────────────────────────');
    console.log(text);
    console.log('─────────────────────────────────\n');
    return;
  }

  try {
    await axios.post(config.feishu.webhookUrl, {
      msg_type: 'text',
      content: { text },
    });
  } catch (err) {
    console.error('[飞书] 推送失败:', err instanceof Error ? err.message : err);
  }
}

// ── 多维表格读取（进化闭环）─────────────────────────────────────────────
//
// 读取飞书招聘多维表格的真实结果数据（候选人状态、回复、面试转化），
// 供 agent 反思与技能进化使用。需要在飞书开放平台创建自建应用并开通
// bitable:app:readonly 权限，配置 FEISHU_APP_ID / FEISHU_APP_SECRET /
// FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID。

const FEISHU_API = 'https://open.feishu.cn/open-apis';

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getTenantAccessToken(): Promise<string> {
  const appId   = process.env.FEISHU_APP_ID   || config.feishu.appId;
  const appSecret = process.env.FEISHU_APP_SECRET || config.feishu.appSecret;
  if (!appId || !appSecret) {
    throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }

  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const res = await axios.post(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    app_id: appId,
    app_secret: appSecret,
  });

  const data = res.data as { code: number; msg: string; tenant_access_token: string; expire: number };
  if (data.code !== 0) {
    throw new Error(`飞书获取 token 失败: ${data.msg}`);
  }

  // 提前 5 分钟过期，避免边界失效
  tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + (data.expire - 300) * 1000 };
  return tokenCache.token;
}

export interface BitableRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

/** 分页拉取多维表格全部记录（上限 maxRecords 条） */
export async function fetchRecruitingRecords(maxRecords = 500): Promise<BitableRecord[]> {
  // 优先读 process.env（运行时 update_config 会更新它），其次读 config（模块加载时 dotenv 注入）
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN || config.feishu.bitable.appToken;
  const tableId  = process.env.FEISHU_BITABLE_TABLE_ID   || config.feishu.bitable.tableId;
  if (!appToken || !tableId) {
    throw new Error('未配置 FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID');
  }

  const token = await getTenantAccessToken();
  const records: BitableRecord[] = [];
  let pageToken: string | undefined;

  do {
    const res = await axios.get(
      `${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
      },
    );

    const data = res.data as {
      code: number;
      msg: string;
      data?: { items?: Array<{ record_id: string; fields: Record<string, unknown> }>; page_token?: string; has_more?: boolean };
    };
    if (data.code !== 0) {
      throw new Error(`飞书读取多维表格失败: ${data.msg}`);
    }

    for (const item of data.data?.items ?? []) {
      records.push({ recordId: item.record_id, fields: item.fields });
    }
    pageToken = data.data?.has_more ? data.data?.page_token : undefined;
  } while (pageToken && records.length < maxRecords);

  return records.slice(0, maxRecords);
}

/**
 * 把多维表格记录聚合成可注入 prompt 的进化上下文：
 * 自动识别"状态/阶段"类字段做分布统计，附最近记录样本。
 */
export async function buildEvolutionContext(maxRecords = 500): Promise<string> {
  const records = await fetchRecruitingRecords(maxRecords);
  if (records.length === 0) return '飞书多维表格暂无记录。';

  // 找出取值集中度高的文本字段（疑似状态/渠道/来源类），做分布统计
  const fieldValues = new Map<string, Map<string, number>>();
  for (const r of records) {
    for (const [key, val] of Object.entries(r.fields)) {
      const text = typeof val === 'string' ? val : Array.isArray(val) ? val.map(v => (typeof v === 'object' && v && 'text' in v ? (v as { text: string }).text : String(v))).join(',') : null;
      if (!text || text.length > 30) continue;
      if (!fieldValues.has(key)) fieldValues.set(key, new Map());
      const m = fieldValues.get(key)!;
      m.set(text, (m.get(text) ?? 0) + 1);
    }
  }

  const lines: string[] = [`## 飞书招聘数据（共 ${records.length} 条记录）`];

  for (const [field, dist] of fieldValues) {
    // 只统计"枚举感"强的字段：取值种类 ≤ 12 且覆盖大部分记录
    const total = Array.from(dist.values()).reduce((a, b) => a + b, 0);
    if (dist.size > 12 || total < records.length * 0.3) continue;
    const top = Array.from(dist.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v}: ${n}（${Math.round((n / total) * 100)}%）`)
      .join('，');
    lines.push(`- ${field} 分布：${top}`);
  }

  return lines.join('\n');
}

export async function sendReport(report: {
  channel: string;
  contacted: number;
  skipped: number;
  summary: string;
  durationSec: number;
}): Promise<void> {
  const channelLabel: Record<string, string> = {
    boss: 'BOSS直聘',
    maimai: '脉脉',
    linkedin: 'LinkedIn',
  };

  const lines = [
    `🦞 HireSeek 执行完成`,
    `渠道：${channelLabel[report.channel] ?? report.channel}`,
    `触达：${report.contacted} 人`,
    `跳过：${report.skipped} 人`,
    `耗时：${report.durationSec}s`,
    `──────────────`,
    report.summary || '（无摘要）',
  ];

  await sendMessage(lines.join('\n'));
}
