import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import type OpenAI from 'openai';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hireseek-agent-core-'));
process.env.HIRESEEK_DB_PATH = path.join(tmp, 'hireseek-test.db');
process.env.HIRECLAW_DB_PATH = process.env.HIRESEEK_DB_PATH;

describe('agent core lower layer', () => {
  beforeAll(async () => {
    await import('../src/agent-core/store');
  });

  it('registers tools with schemas and side-effect policy', async () => {
    const { createToolRegistry } = await import('../src/agent-core/tool-registry');
    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'browser_act',
          description: 'act',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'read',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const registry = createToolRegistry(tools);

    expect(registry.validate()).toEqual([]);
    expect(registry.get('browser_act')?.policy.sideEffect).toBe(true);
    expect(registry.get('read_file')?.policy.sideEffect).toBe(false);
  });

  it('returns structured unknown-tool errors without throwing', async () => {
    const { executeTool } = await import('../src/chat');
    const out = await executeTool('not_a_tool', { x: 1 }, { sessionId: 's-unknown', toolCallId: 'tc-1' });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown_tool');

    const { db } = await import('../src/db');
    const row = db.prepare(`
      SELECT tool_name, ok, error FROM agent_tool_calls WHERE session_id = ? AND tool_call_id = ?
    `).get('s-unknown', 'tc-1') as { tool_name: string; ok: number; error: string };
    expect(row.tool_name).toBe('not_a_tool');
    expect(row.ok).toBe(0);
    expect(row.error).toContain('unknown tool');
  });

  it('records rejected tool calls with registry side-effect policy', async () => {
    const { createToolRegistry } = await import('../src/agent-core/tool-registry');
    const { recordRejectedToolCall } = await import('../src/agent-core/trace');
    const { db } = await import('../src/db');
    const registry = createToolRegistry([
      {
        type: 'function',
        function: {
          name: 'browser_act',
          description: 'act',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);

    recordRejectedToolCall({
      registry,
      runId: 77,
      sessionId: 's-rejected',
      toolCallId: 'tc-rejected',
      toolName: 'browser_act',
      input: '{bad json',
      output: '工具参数解析失败',
      error: 'Expected property name',
    });

    const row = db.prepare(`
      SELECT ok, error, side_effect, mode FROM agent_tool_calls
      WHERE session_id = ? AND tool_call_id = ?
    `).get('s-rejected', 'tc-rejected') as { ok: number; error: string; side_effect: number; mode: string };

    expect(row.ok).toBe(0);
    expect(row.error).toContain('Expected property name');
    expect(row.side_effect).toBe(1);
    expect(row.mode).toBe('execute');
  });

  it('records tool trace with run isolation and side-effect mode', async () => {
    const { recordToolCall } = await import('../src/agent-core/trace');
    const { db } = await import('../src/db');

    recordToolCall({
      runId: 101,
      sessionId: 's-trace',
      toolCallId: 'tc-101',
      toolName: 'browser_act',
      input: { action: 'click', ref: 3 },
      output: 'ok',
      ok: true,
      sideEffect: true,
      mode: 'execute',
      stageId: 'prefilter',
    });
    recordToolCall({
      runId: 202,
      sessionId: 's-trace',
      toolCallId: 'tc-202',
      toolName: 'read_file',
      input: { filename: 'x' },
      output: 'missing',
      ok: false,
      error: 'missing',
      sideEffect: false,
      mode: 'read',
    });

    const rows = db.prepare(`
      SELECT run_id, tool_name, ok, side_effect, mode, stage_id FROM agent_tool_calls WHERE run_id = ? ORDER BY id
    `).all(101) as Array<{ run_id: number; tool_name: string; ok: number; side_effect: number; mode: string; stage_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run_id: 101, tool_name: 'browser_act', ok: 1, side_effect: 1, mode: 'execute', stage_id: 'prefilter' });
  });

  it('persists run trace stage markers for compliance coverage', async () => {
    const { saveRunTrace, summarizeStageCoverage } = await import('../src/compliance');
    const { db } = await import('../src/db');
    const runId = 505;

    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM agent_tool_calls WHERE run_id = ?`).run(runId);

    saveRunTrace(runId, 'Agent工程师', 'boss', [
      {
        seq: 1,
        action: 'click',
        target: 'ref=11',
        detail: 'open filter panel',
        ok: true,
        stageId: 'prefilter',
      },
    ]);

    const row = db.prepare(`
      SELECT stage_id FROM run_actions WHERE run_id = ? ORDER BY id DESC LIMIT 1
    `).get(runId) as { stage_id: string | null };
    expect(row.stage_id).toBe('prefilter');

    const coverage = summarizeStageCoverage('boss', runId, [
      { seq: 1, action: 'click', target: 'ref=11', ok: true, stageId: 'prefilter' },
    ]);
    expect(coverage).toContain('prefilter');
    expect(coverage).toContain('已观测 browser=1');
    expect(coverage).toContain('single-contact');
  });

  it('classifies dry-run browser actions without allowing side effects', async () => {
    const {
      browserActionHasSideEffect,
      browserActionMode,
      dryRunBlocksBrowserAction,
    } = await import('../src/runners/dom-runner');

    expect(dryRunBlocksBrowserAction({ action: 'click', ref: 1 })).toBe(true);
    expect(dryRunBlocksBrowserAction({ action: 'type', ref: 1, text: 'hello' })).toBe(true);
    expect(dryRunBlocksBrowserAction({ action: 'goto', url: 'https://example.com' })).toBe(true);
    expect(dryRunBlocksBrowserAction({ action: 'snapshot' })).toBe(false);
    expect(dryRunBlocksBrowserAction({ action: 'scroll', direction: 'down' })).toBe(false);

    expect(browserActionMode({ action: 'click', ref: 1 }, 'dry_run')).toBe('dry_run');
    expect(browserActionHasSideEffect({ action: 'scroll', direction: 'down' }, 'dry_run')).toBe(false);
    expect(browserActionHasSideEffect({ action: 'click', ref: 1 }, 'dry_run')).toBe(true);
  });

  it('saves repaired session message history', async () => {
    const { saveAgentSessionMessages, loadAgentSessionMessages } = await import('../src/agent-core/session-store');
    const { db } = await import('../src/db');

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'unknown_tool', arguments: '{}' },
          },
        ],
      } as OpenAI.ChatCompletionAssistantMessageParam,
    ];

    saveAgentSessionMessages({
      sessionId: 'session-repair',
      title: 'repair',
      source: 'test',
      messages,
    });

    const loaded = loadAgentSessionMessages('session-repair');
    expect(loaded.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);

    const row = db.prepare(`SELECT message_count FROM agent_sessions WHERE id = ?`).get('session-repair') as { message_count: number };
    expect(row.message_count).toBe(4);
  });

  it('lists and resumes agent-core-only sessions', async () => {
    const { saveAgentSessionMessages } = await import('../src/agent-core/session-store');
    const { listSessions, loadSession } = await import('../src/remote-session');

    saveAgentSessionMessages({
      sessionId: 'db-only-session',
      title: 'DB only session',
      source: 'agent-session',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: '继续上一轮' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_resume_1',
              type: 'function',
              function: { name: 'run_sourcing', arguments: '{"channel":"boss"}' },
            },
          ],
        } as OpenAI.ChatCompletionAssistantMessageParam,
      ],
    });

    const listed = listSessions().find(s => s.id === 'db-only-session');
    expect(listed?.title).toBe('DB only session');
    expect(listed?.source).toBe('agent-session');
    expect(listed?.conversationMessageCount).toBe(3);

    const loaded = loadSession('db-only-session');
    expect(loaded?.title).toBe('DB only session');
    expect(loaded?.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect((loaded?.messages[3] as OpenAI.ChatCompletionToolMessageParam).tool_call_id).toBe('call_resume_1');
  });

  it('stores raw, episodic, and semantic memory without strategy interpretation', async () => {
    const {
      getSemanticFacts,
      listRawMemory,
      searchEpisodicMemory,
      upsertSemanticFact,
      writeEpisodicMemory,
      writeRawMemory,
    } = await import('../src/agent-core/memory-store');

    const rawId = writeRawMemory({
      source: 'test',
      content: 'raw event',
      visibility: 'private',
      metadata: { kind: 'event' },
    });
    const duplicatedRawId = writeRawMemory({
      source: 'test',
      content: 'raw event',
      visibility: 'private',
      metadata: { kind: 'event' },
    });
    const episodeId = writeEpisodicMemory({
      userId: 'u1',
      source: 'chat',
      visibility: 'private',
      summary: 'talked about candidate A',
      content: 'candidate A prefers remote',
    });
    const duplicatedEpisodeId = writeEpisodicMemory({
      userId: 'u1',
      source: 'chat',
      visibility: 'private',
      summary: 'talked about candidate A',
      content: 'candidate A prefers remote',
    });
    upsertSemanticFact({
      key: 'company.name',
      value: 'BlackLake',
      source: 'profile',
      visibility: 'private',
      version: 1,
    });

    expect(rawId).toBeGreaterThan(0);
    expect(duplicatedRawId).toBe(rawId);
    expect(episodeId).toBeGreaterThan(0);
    expect(duplicatedEpisodeId).toBe(episodeId);
    expect(listRawMemory({ source: 'test', visibility: 'private' })[0]).toMatchObject({
      source: 'test',
      visibility: 'private',
      version: 1,
    });
    expect(searchEpisodicMemory({ userId: 'u1', query: 'remote', visibility: 'private' })).toHaveLength(1);
    expect(getSemanticFacts({ key: 'company.name', visibility: 'private' })[0]).toMatchObject({
      fact_value: 'BlackLake',
      visibility: 'private',
      version: 1,
    });
  });

  it('persists outreach output protocol fields for contacted candidates', async () => {
    const { persistRunResult } = await import('../src/orchestrator');
    const { db } = await import('../src/db');

    persistRunResult(303, 'Agent工程师', 'boss', {
      contacted: 1,
      skipped: 0,
      candidates: [],
      summary: 'done',
      contactedList: [
        {
          name: '张三',
          company: 'ExampleAI',
          evidence: '做过 Agent 平台落地',
          personalizationEvidence: 'ExampleAI Agent 平台',
          messageIntent: '强调真实 Agent 工程挑战',
          riskFlags: ['unclear_years'],
          fitTags: ['Agent', '平台工程'],
          score: 82,
          greetingSent: true,
          greetingText: '看到你在 ExampleAI 做过 Agent 平台落地，我们这边也在做真实工业场景的 Agent 工程化，想和你聊聊。',
        },
      ],
    });

    const row = db.prepare(`
      SELECT evidence, personalization_evidence, message_intent, risk_flags, fit_tags, greeting_text
      FROM run_candidates WHERE run_id = ?
    `).get(303) as {
      evidence: string;
      personalization_evidence: string;
      message_intent: string;
      risk_flags: string;
      fit_tags: string;
      greeting_text: string;
    };

    expect(row.evidence).toContain('Agent 平台');
    expect(row.personalization_evidence).toBe('ExampleAI Agent 平台');
    expect(row.message_intent).toContain('工程挑战');
    expect(JSON.parse(row.risk_flags)).toEqual(['unclear_years']);
    expect(JSON.parse(row.fit_tags)).toEqual(['Agent', '平台工程']);
    expect(row.greeting_text).toContain('ExampleAI');
  });

  it('fails compliance when contacted candidates miss outreach output fields', async () => {
    const { complianceCheck } = await import('../src/compliance');
    const { db } = await import('../src/db');
    const runId = 404;

    db.prepare(`DELETE FROM compliance_checks WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM interaction_log WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM run_candidates WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM task_runs WHERE id = ?`).run(runId);

    db.prepare(`
      INSERT INTO task_runs (id, job_id, channel, started_at, finished_at, status, contacted_count, skipped_count)
      VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'), 'completed', 1, 0)
    `).run(runId, 'Agent工程师', 'boss');
    db.prepare(`
      INSERT INTO run_candidates
        (run_id, candidate_fingerprint, job_id, channel, score, evidence, personalization_evidence, message_intent, greeting_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, 'missing-outreach-fields', 'Agent工程师', 'boss', 80, '有 Agent 项目经历', '', '', '你好，想和你聊聊 Agent 工程机会。');
    db.prepare(`
      INSERT INTO interaction_log (run_id, candidate_fingerprint, action, note)
      VALUES (?, ?, 'greeted', 'missing outreach output fields')
    `).run(runId, 'missing-outreach-fields');

    const result = await complianceCheck({ runId });

    expect(result.verdict).toBe('fail');
    expect(result.violations.some(v => v.rule.includes('outreach-output.v1'))).toBe(true);

    const saved = db.prepare(`
      SELECT verdict, violation_count, detail FROM compliance_checks WHERE run_id = ? ORDER BY id DESC LIMIT 1
    `).get(runId) as { verdict: string; violation_count: number; detail: string };
    expect(saved.verdict).toBe('fail');
    expect(saved.violation_count).toBeGreaterThan(0);
    expect(saved.detail).toContain('outreach-output.v1');
  });

  it('does not treat dry-run task runs as formal outreach contract failures', async () => {
    const { complianceCheck } = await import('../src/compliance');
    const { db, taskRunOps } = await import('../src/db');

    const inserted = taskRunOps.start.run({
      job_id: 'Agent工程师',
      channel: 'boss',
      mode: 'dry_run',
      started_at: new Date().toISOString(),
    });
    const runId = Number(inserted.lastInsertRowid);
    taskRunOps.complete.run({
      id: runId,
      finished_at: new Date().toISOString(),
      status: 'completed',
      contacted_count: 0,
      skipped_count: 0,
      error: null,
    });

    const row = db.prepare(`SELECT mode FROM task_runs WHERE id = ?`).get(runId) as { mode: string };
    expect(row.mode).toBe('dry_run');

    const result = await complianceCheck({ runId });
    expect(result.verdict).toBe('skip');
    expect(result.violations).toHaveLength(0);
  });

  it('formats read-only core status for observability', async () => {
    const { collectCoreStatus, formatCoreStatus } = await import('../src/agent-core/core-status');
    const { createToolRegistry } = await import('../src/agent-core/tool-registry');

    const registry = createToolRegistry([
      {
        type: 'function',
        function: {
          name: 'core_status',
          description: 'core',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_act',
          description: 'browser',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);

    const status = collectCoreStatus(registry);
    const text = formatCoreStatus(status);

    expect(status.tools.total).toBe(2);
    expect(status.tools.sideEffect).toBe(1);
    expect(text).toContain('HireSeek Agent Core');
    expect(text).toContain('Trace:');
    expect(text).toContain('Memory:');
  });
});
