/**
 * 记忆模块：从数据库提取历史上下文，注入到每次任务的 prompt 中。
 * 让 agent 知道：之前做了什么、效果怎样、今天还需要做什么。
 */

import { db, reflectionOps, conversationOps } from './db';
import type { Channel } from './types';

interface ChannelStat {
  channel: string;
  total: number;
  replied: number;
  converted: number;
}

interface RecentRun {
  channel: string;
  started_at: string;
  contacted_count: number;
  skipped_count: number;
  status: string;
}

/** 生成注入 prompt 的记忆摘要 */
export function buildMemoryContext(channel: Channel, jobId: string): string {
  const sections: string[] = [];

  // 1. 今日进度
  const todayContacted = db.prepare(`
    SELECT COUNT(*) as count FROM candidates
    WHERE channel = ? AND job_id = ? AND date(contacted_at) = date('now')
  `).get(channel, jobId) as { count: number };

  sections.push(`## 今日进度（${channel}）\n已触达：${todayContacted.count} 人`);

  // 2. 近 7 天渠道效果
  const channelStats = db.prepare(`
    SELECT
      channel,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'replied'   THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted
    FROM candidates
    WHERE job_id = ? AND contacted_at >= datetime('now', '-7 days')
    GROUP BY channel
  `).all(jobId) as ChannelStat[];

  if (channelStats.length > 0) {
    const rows = channelStats.map(s =>
      `- ${s.channel}：触达 ${s.total} 人，回复 ${s.replied} 人（${Math.round(s.replied / s.total * 100)}%），转化 ${s.converted} 人`
    );
    sections.push(`## 近 7 天渠道效果\n${rows.join('\n')}`);
  }

  // 3. 最近一次该渠道的执行摘要
  const lastRun = db.prepare(`
    SELECT * FROM task_runs
    WHERE channel = ? AND job_id = ? AND status = 'completed'
    ORDER BY started_at DESC LIMIT 1
  `).get(channel, jobId) as RecentRun | undefined;

  if (lastRun) {
    const date = lastRun.started_at.slice(0, 10);
    sections.push(`## 上次执行（${date}）\n触达 ${lastRun.contacted_count} 人，跳过 ${lastRun.skipped_count} 人`);
  } else {
    sections.push(`## 上次执行\n暂无记录，这是第一次在此渠道执行`);
  }

  // 4. 已联系过的候选人（防止重复触达）
  const recentContacts = db.prepare(`
    SELECT name, company, status FROM candidates
    WHERE channel = ? AND job_id = ?
    ORDER BY contacted_at DESC LIMIT 30
  `).all(channel, jobId) as { name: string; company: string; status: string }[];

  if (recentContacts.length > 0) {
    const list = recentContacts.map(c => `- ${c.name}（${c.company || '未知'}）：${c.status}`);
    sections.push(`## 已联系候选人（勿重复触达）\n${list.join('\n')}`);
  }

  // 5. 历史反思（最近 3 次）
  const pastReflections = reflectionOps.recent.all(channel, jobId) as { content: string; created_at: string }[];
  if (pastReflections.length > 0) {
    const entries = pastReflections.map(r =>
      `【${r.created_at.slice(0, 10)}】\n${r.content}`
    ).join('\n\n---\n\n');
    sections.push(`## 历史反思（供参考，请在此基础上改进）\n\n${entries}`);
  }

  return `# 记忆上下文\n\n${sections.join('\n\n')}`;
}

/** 注入历史对话记忆，让 HireClaw 跨会话记住和用户的交流 */
export function buildConversationMemory(jobId: string): string {
  const rows = conversationOps.recent.all(jobId) as {
    summary: string;
    highlights: string;
    excerpt: string;
    created_at: string;
  }[];
  if (rows.length === 0) return '';

  const sections: string[] = [];

  // 最近一次：给原文片段（保留细节）
  const latest = rows[0];
  const latestDate = latest.created_at.slice(0, 10);
  let latestBlock = `### 上次对话（${latestDate}）\n${latest.summary}`;
  if (latest.highlights) latestBlock += `\n${latest.highlights}`;
  if (latest.excerpt)    latestBlock += `\n\n对话片段：\n${latest.excerpt}`;
  sections.push(latestBlock);

  // 更早的：只给摘要
  if (rows.length > 1) {
    const older = rows.slice(1).map(r => {
      const date = r.created_at.slice(0, 10);
      const hl = r.highlights ? `（${r.highlights}）` : '';
      return `- 【${date}】${r.summary}${hl}`;
    }).join('\n');
    sections.push(`### 更早记录\n${older}`);
  }

  return `## 历史对话记忆\n\n${sections.join('\n\n')}`;
}

/** 生成反思 prompt，任务结束后调用 */
export function buildReflectionPrompt(
  channel: string,
  contacted: number,
  skipped: number,
  summary: string
): string {
  return `
你刚完成了一次 ${channel} 的招聘 sourcing 任务。
触达：${contacted} 人，跳过：${skipped} 人。

执行摘要：
${summary}

现在请写一份给自己看的反思，不超过 200 字。要回答：
1. 今天的判断有没有什么值得怀疑的地方？
2. 话术或策略上有没有可以改进的？
3. 下次执行，你会做哪一件不一样的事？

直接写反思内容，不需要标题。
`.trim();
}
