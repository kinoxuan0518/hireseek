import './dsh-env';
import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomRunner } from '../src/runners/dom-runner';
import type { BrowserAction, DomBrowserSession, RiskGuard, SnapshotOptions } from '../src/browser-session';

const LIST_SNAPSHOT = `URL: https://www.zhipin.com/web/geek/recommend
标题: 推荐牛人

## 可交互元素（共 1 个）
[ref=1] <div> 王小明 5年 供应链算法

## 页面正文
王小明 5年 供应链算法`;

const DETAIL_SNAPSHOT = `URL: https://www.zhipin.com/web/geek/detail
标题: 候选人详情

## 可交互元素（共 1 个）
[ref=9] <button> 打招呼

## 页面正文
王小明，本科物流工程。三段经历都在做履约调度，最近一段主导了全量切换。`;

/** 记录 runner 到底有没有要「完整正文」 */
const snapshotCalls: SnapshotOptions[] = [];
let onDetailPage = false;

const fakeSession: DomBrowserSession = {
  kind: 'chrome-cdp',
  label: 'fake',
  async goto() { /* 测试里不跳转 */ },
  async url() { return onDetailPage ? 'https://www.zhipin.com/web/geek/detail' : 'https://www.zhipin.com/web/geek/recommend'; },
  async bodyText() { return onDetailPage ? DETAIL_SNAPSHOT : LIST_SNAPSHOT; },
  async snapshot(opts: SnapshotOptions = {}) {
    snapshotCalls.push(opts);
    return onDetailPage ? DETAIL_SNAPSHOT : LIST_SNAPSHOT;
  },
  async act(input: BrowserAction, _guard: RiskGuard) {
    snapshotCalls.push({ full: input.full });
    if (input.action === 'click') onDetailPage = true;
    return onDetailPage ? DETAIL_SNAPSHOT : LIST_SNAPSHOT;
  },
};

function toolCall(id: string, name: string, args: unknown) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** 脚本化的假模型：先只看卡片就想推进（应被拒），再点进详情通读后重记 */
const SCRIPT: Array<{ content: string | null; tool_calls?: unknown[] }> = [
  {
    content: null,
    tool_calls: [toolCall('c1', 'record_screened_candidate', {
      name: '王小明',
      company: '某物流公司',
      recommendation: 'contact',
      evidence: '卡片显示 5 年供应链算法经验。',
    })],
  },
  {
    content: null,
    tool_calls: [toolCall('c2', 'browser', { action: 'click', ref: 1, stage_id: 'candidate-screen' })],
  },
  {
    content: null,
    tool_calls: [toolCall('c3', 'browser', { action: 'snapshot', full: true, stage_id: 'candidate-screen' })],
  },
  {
    content: null,
    tool_calls: [toolCall('c4', 'record_screened_candidate', {
      name: '王小明',
      company: '某物流公司',
      recommendation: 'contact',
      evidence: '简历三段经历都在履约调度，最近一段主导全量切换。',
      reading_depth: 'detail',
      resume_digest: '本科物流工程，三段经历都在做履约调度，最近一段主导了全量切换。',
      coherence_verdict: 'aligned',
      coherence_note: '每次跳槽都往更靠近履约核心的方向走。',
      fit_score: 84,
    })],
  },
  { content: '触达人数: 0\n跳过人数: 0\n已触达候选人清单：无' },
];

let server: http.Server;
let baseURL = '';
let round = 0;
const toolOutputs: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      for (const m of payload.messages ?? []) {
        if (m.role === 'tool' && typeof m.content === 'string') toolOutputs.push(m.content);
      }
      const message = SCRIPT[Math.min(round, SCRIPT.length - 1)];
      round += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock',
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('深读门禁：只看卡片不能建议触达', () => {
  it('先拒后收——通读简历前的 contact 被挡下，读完再记就通过', async () => {
    const runner = new DomRunner(baseURL, 'sk-test', 'mock');
    const result = await runner.runSkill(fakeSession, '你是招聘 agent', '筛选候选人', undefined, {
      executionMode: 'screen',
      deepReadMode: 'contact',
    });

    const rejection = toolOutputs.find(o => o.includes('screen_candidate_rejected'));
    expect(rejection).toBeDefined();
    expect(rejection).toContain('本轮要求先通读简历');
    expect(rejection).toContain('full=true');

    // 被拒那次不能落进结果，通读后那次才算数
    expect(result.screenedList).toHaveLength(1);
    expect(result.screenedList![0].readingDepth).toBe('detail');
    expect(result.screenedList![0].coherenceVerdict).toBe('aligned');
    expect(result.screenedList![0].resumeDigest).toContain('履约调度');

    // 模型确实要了完整正文
    expect(snapshotCalls.some(c => c.full === true)).toBe(true);
  }, 30_000);
});
