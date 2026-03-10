/**
 * 搜索模块：支持多种搜索 API，无 key 时降级到免费方案。
 */

import { config } from './config';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 用 Tavily API 搜索 */
async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
  const data = await res.json() as any;
  return (data.results || []).map((r: any) => ({
    title:   r.title,
    url:     r.url,
    snippet: r.content,
  }));
}

/** 用 Brave Search API 搜索 */
async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave error: ${res.status}`);
  const data = await res.json() as any;
  return (data.web?.results || []).map((r: any) => ({
    title:   r.title,
    url:     r.url,
    snippet: r.description,
  }));
}

/** DuckDuckGo 免费搜索（无需 key，结果有限） */
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HireClaw/1.0' } });
  if (!res.ok) throw new Error(`DDG error: ${res.status}`);
  const data = await res.json() as any;

  const results: SearchResult[] = [];

  // Abstract（摘要）
  if (data.AbstractText) {
    results.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText });
  }

  // RelatedTopics
  for (const topic of (data.RelatedTopics || []).slice(0, 4)) {
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.slice(0, 60), url: topic.FirstURL, snippet: topic.Text });
    }
  }

  return results;
}

/**
 * 主搜索入口：按配置优先级依次尝试。
 * 返回格式化结果字符串，供 LLM 直接阅读。
 */
export async function webSearch(query: string): Promise<string> {
  let results: SearchResult[] = [];
  let provider = '未知';

  try {
    const key      = config.search?.apiKey;
    const prov     = config.search?.provider?.toLowerCase() ?? '';

    if (key && prov === 'tavily') {
      results  = await searchTavily(query, key);
      provider = 'Tavily';
    } else if (key && prov === 'brave') {
      results  = await searchBrave(query, key);
      provider = 'Brave';
    } else {
      // 无 key，降级到 DuckDuckGo
      results  = await searchDuckDuckGo(query);
      provider = 'DuckDuckGo（免费，结果有限）';
    }
  } catch (err: any) {
    return `搜索失败：${err.message}`;
  }

  if (results.length === 0) return `搜索"${query}"无结果`;

  const formatted = results.map((r, i) =>
    `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`
  ).join('\n\n');

  return `搜索来源：${provider}\n\n${formatted}`;
}
