import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hireseek-agent-core-'));
process.env.HIRESEEK_DB_PATH = path.join(tmp, 'hireseek-test.db');
process.env.HIRECLAW_DB_PATH = process.env.HIRESEEK_DB_PATH;

describe('agent core lower layer', () => {
  beforeAll(async () => {
    await import('../src/agent-core/store');
  });

  it('keeps active-job file reads behind RuntimeContext', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const allowed = new Set([
      path.join(srcRoot, 'skills', 'loader.ts'),
      path.join(srcRoot, 'agent-core', 'runtime-context.ts'),
    ]);
    const violations: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(absolute);
        if (!entry.isFile() || !entry.name.endsWith('.ts') || allowed.has(absolute)) continue;
        if (/\bloadActiveJob\s*\(/.test(fs.readFileSync(absolute, 'utf8'))) {
          violations.push(path.relative(srcRoot, absolute));
        }
      }
    };
    visit(srcRoot);
    expect(violations).toEqual([]);
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

    const unclassified = createToolRegistry([{
      type: 'function',
      function: {
        name: 'unclassified_tool',
        description: 'missing explicit policy',
        parameters: { type: 'object', properties: {} },
      },
    }]);
    expect(unclassified.validate()).toEqual([
      expect.objectContaining({
        tool: 'unclassified_tool',
        problem: 'category and sideEffect must be explicitly declared',
      }),
    ]);
  });

  it('registers runner tools and blocks computer side effects in dry-run', async () => {
    const {
      DOM_RUNNER_TOOL_REGISTRY,
      detectExternalBrowserControl,
      userInterventionRequestsBrowserPause,
    } = await import('../src/runners/dom-runner');
    const { GENERIC_VISION_TOOL_REGISTRY } = await import('../src/runners/generic-vision');
    const {
      computerActionHasSideEffect,
      computerActionMode,
      dryRunBlocksComputerAction,
    } = await import('../src/agent-core/computer-actions');

    expect(DOM_RUNNER_TOOL_REGISTRY.validate()).toEqual([]);
    expect(DOM_RUNNER_TOOL_REGISTRY.get('browser')?.policy.supportsDryRun).toBe(true);
    expect(DOM_RUNNER_TOOL_REGISTRY.get('record_contacted')?.policy.sideEffect).toBe(false);
    expect(DOM_RUNNER_TOOL_REGISTRY.get('record_screened_candidate')?.policy.sideEffect).toBe(false);
    expect(GENERIC_VISION_TOOL_REGISTRY.validate()).toEqual([]);
    expect(GENERIC_VISION_TOOL_REGISTRY.get('computer')?.policy.sideEffect).toBe(true);
    expect(computerActionHasSideEffect('left_click')).toBe(true);
    expect(computerActionHasSideEffect('screenshot')).toBe(false);
    expect(dryRunBlocksComputerAction('type')).toBe(true);
    expect(dryRunBlocksComputerAction('scroll')).toBe(false);
    expect(computerActionMode('left_click', 'dry_run')).toBe('dry_run');

    const observed = 'URL: https://www.zhipin.com/web/chat/recommend\n标题: 推荐牛人\n\n## 页面正文';
    expect(detectExternalBrowserControl(observed, {
      url: 'https://www.zhipin.com/web/chat/recommend',
      title: '推荐牛人',
      active: true,
    }).suspected).toBe(false);
    expect(detectExternalBrowserControl(observed, {
      url: 'https://www.zhipin.com/web/chat/aiform',
      title: 'AI 搜索',
      active: true,
    }).suspected).toBe(true);
    expect(detectExternalBrowserControl(observed, {
      url: 'https://www.zhipin.com/web/chat/recommend',
      title: '推荐牛人',
      active: false,
    }).suspected).toBe(true);
    expect(userInterventionRequestsBrowserPause('是我在用，不要接管')).toBe(true);
    expect(userInterventionRequestsBrowserPause('只看上海')).toBe(false);
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

  it('stores the latest run state for continuation and pause recovery', async () => {
    const {
      formatRunStateForContext,
      formatRunStateDetail,
      formatRunStateList,
      latestPausedRunState,
      listPendingAgentRunStates,
      listAgentRunStates,
      loadAgentRunState,
      upsertAgentRunState,
    } = await import('../src/agent-core/run-state-store');
    const { db } = await import('../src/db');

    upsertAgentRunState({
      runId: 303,
      sessionId: 'run-state-session',
      status: 'running',
      phase: 'browser_action',
      stageId: 'prefilter',
      lastAction: 'click',
      lastUrl: 'https://www.zhipin.com/web/chat/recommend',
      snapshotSummary: 'URL: https://www.zhipin.com/web/chat/recommend\n标题: 推荐牛人',
    });
    expect(loadAgentRunState(303)).toMatchObject({
      runId: 303,
      sessionId: 'run-state-session',
      status: 'running',
      phase: 'browser_action',
      stageId: 'prefilter',
      lastAction: 'click',
    });

    upsertAgentRunState({
      runId: 303,
      status: 'paused',
      phase: 'external_control',
      lastAction: 'click',
      lastUrl: 'https://www.zhipin.com/web/chat/aiform',
      reason: 'user is using Chrome',
    });
    expect(loadAgentRunState(303)).toMatchObject({
      runId: 303,
      sessionId: 'run-state-session',
      status: 'paused',
      phase: 'external_control',
      reason: 'user is using Chrome',
    });

    db.prepare(`DELETE FROM task_runs WHERE id = ?`).run(304);
    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(304);
    db.prepare(`DELETE FROM agent_tool_calls WHERE run_id = ?`).run(304);
    db.prepare(`
      INSERT INTO task_runs (id, job_id, channel, mode, started_at, finished_at, status, contacted_count, skipped_count)
      VALUES (?, ?, ?, 'execute', datetime('now','localtime'), datetime('now','localtime'), 'paused', 0, 0)
    `).run(304, 'Agent工程师', 'boss');
    db.prepare(`
      INSERT INTO run_actions (run_id, job_id, channel, seq, action, target, detail, ok, stage_id, action_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(304, 'Agent工程师', 'boss', 1, 'click', 'ref=3', 'open candidate card', 0, 'candidate-screen', '[ref=3] <button> 候选人');
    db.prepare(`
      INSERT INTO agent_tool_calls (run_id, session_id, tool_call_id, tool_name, input_summary, output_summary, ok, error, side_effect, mode, stage_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(304, 'run-state-session', 'tool-304', 'browser', '{}', 'blocked', 0, 'user is using Chrome', 1, 'execute', 'candidate-screen');
    upsertAgentRunState({
      runId: 304,
      status: 'paused',
      phase: 'external_control',
      stageId: 'candidate-screen',
      lastAction: 'click',
      lastUrl: 'https://www.zhipin.com/web/chat/aiform',
      reason: 'user is using Chrome',
      snapshotSummary: 'URL: https://www.zhipin.com/web/chat/aiform\n标题: AI 搜索',
    });

    const latest = latestPausedRunState({ jobId: 'Agent工程师', channel: 'boss' });
    expect(latest?.runId).toBe(304);
    expect(formatRunStateForContext(latest!)).toContain('phase: external_control');
    expect(formatRunStateForContext(latest!)).toContain('channel: boss');
    expect(formatRunStateList([latest!], 'Pending')).toContain('next:');
    expect(formatRunStateDetail(loadAgentRunState(304))).toContain('HireSeek Run State #304');
    expect(formatRunStateDetail(loadAgentRunState(304))).toContain('channel: boss');
    expect(formatRunStateDetail(loadAgentRunState(304))).toContain('Next:');
    expect(formatRunStateDetail(loadAgentRunState(304))).toContain('Recent actions:');
    expect(formatRunStateDetail(loadAgentRunState(304))).toContain('open candidate card');
    expect(formatRunStateDetail(loadAgentRunState(304))).toContain('Recent tool failures:');
    expect(formatRunStateList([], 'All', '没有 run state。')).toContain('没有 run state。');
    expect(listPendingAgentRunStates(3).some(s => s.runId === 304)).toBe(true);
    expect(listAgentRunStates(2).some(s => s.runId === 304)).toBe(true);
  });

  it('tracks execution environment ownership separately from run state', async () => {
    const {
      formatExecutionEnvironmentLine,
      listExecutionEnvironments,
      loadExecutionEnvironment,
      upsertExecutionEnvironment,
    } = await import('../src/agent-core/environment-store');
    const { db } = await import('../src/db');

    db.prepare(`DELETE FROM agent_execution_environments WHERE id = ?`).run('browser:chrome-applescript');

    upsertExecutionEnvironment({
      id: 'browser:chrome-applescript',
      kind: 'browser',
      label: '真实 Chrome（AppleScript）',
      controller: 'hireseek',
      status: 'claimed',
      mode: 'execute',
      runId: 304,
      sessionId: 'run-state-session',
      url: 'https://www.zhipin.com/web/chat/recommend',
      title: '推荐牛人',
      active: true,
    });

    expect(loadExecutionEnvironment('browser:chrome-applescript')).toMatchObject({
      id: 'browser:chrome-applescript',
      kind: 'browser',
      controller: 'hireseek',
      status: 'claimed',
      runId: 304,
      active: true,
    });

    upsertExecutionEnvironment({
      id: 'browser:chrome-applescript',
      kind: 'browser',
      controller: 'user',
      status: 'blocked',
      mode: 'execute',
      active: false,
      reason: 'user is using Chrome',
    });

    const blocked = loadExecutionEnvironment('browser:chrome-applescript')!;
    expect(blocked).toMatchObject({
      controller: 'user',
      status: 'blocked',
      runId: 304,
      active: false,
      reason: 'user is using Chrome',
    });
    expect(formatExecutionEnvironmentLine(blocked)).toContain('browser:chrome-applescript');
    expect(formatExecutionEnvironmentLine(blocked)).toContain('blocked/user/execute');
    expect(listExecutionEnvironments(3).some(env => env.id === 'browser:chrome-applescript')).toBe(true);
  });

  it('classifies harness failures from tool trace and environment state', async () => {
    const {
      classifyHarnessFailure,
      collectHarnessFailureReport,
      collectHarnessFailureReview,
      formatHarnessFailureReport,
      formatHarnessFailureReview,
    } = await import('../src/agent-core/failure-classifier');
    const { db } = await import('../src/db');

    expect(classifyHarnessFailure({ toolName: 'not_a_tool', error: 'unknown tool: not_a_tool' }).code).toBe('unknown_tool');
    expect(classifyHarnessFailure({ toolName: 'browser', error: 'Expected property name' }).code).toBe('invalid_tool_arguments');
    expect(classifyHarnessFailure({ toolName: 'run_shell', error: 'approval denied' }).code).toBe('approval_denied');
    expect(classifyHarnessFailure({ toolName: 'browser', error: '[用户接管保护] user is using Chrome' }).code).toBe('external_control');

    db.prepare(`DELETE FROM agent_tool_calls WHERE session_id = ?`).run('failure-classifier');
    db.prepare(`DELETE FROM agent_execution_environments WHERE id = ?`).run('browser:classifier-test');
    db.prepare(`
      INSERT INTO agent_tool_calls (run_id, session_id, tool_call_id, tool_name, input_summary, output_summary, ok, error, side_effect, mode, stage_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(606, 'failure-classifier', 'tc-unknown', 'not_a_tool', '{}', 'unknown', 0, 'unknown tool: not_a_tool', 0, 'read', null);
    db.prepare(`
      INSERT INTO agent_tool_calls (run_id, session_id, tool_call_id, tool_name, input_summary, output_summary, ok, error, side_effect, mode, stage_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(606, 'failure-classifier', 'tc-external', 'browser', '{}', 'blocked', 0, 'user is using Chrome', 1, 'execute', 'candidate-screen');
    db.prepare(`
      INSERT INTO agent_execution_environments (id, kind, label, controller, status, mode, run_id, session_id, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('browser:classifier-test', 'browser', '真实 Chrome', 'user', 'blocked', 'execute', 606, 'failure-classifier', 'user is using Chrome');

    const report = collectHarnessFailureReport(6);
    expect(report.byCode.unknown_tool).toBeGreaterThanOrEqual(1);
    expect(report.byCode.external_control).toBeGreaterThanOrEqual(1);
    expect(formatHarnessFailureReport(report)).toContain('external_control');

    const review = collectHarnessFailureReview(6);
    expect(review.groups.some(group => group.code === 'unknown_tool' && group.layer === 'tool_registry')).toBe(true);
    expect(review.groups.some(group => group.code === 'external_control' && group.layer === 'execution_environment')).toBe(true);
    const reviewText = formatHarnessFailureReview(review);
    expect(reviewText).toContain('HireSeek Harness Failure Review');
    expect(reviewText).toContain('下一步');
    expect(reviewText).toContain('tool_registry');
  });

  it('records grounded context compaction events', async () => {
    const { autoCompress, estimateTokens } = await import('../src/context-compression');
    const { listContextCompactions } = await import('../src/agent-core/compaction-store');
    const { upsertAgentRunState } = await import('../src/agent-core/run-state-store');
    const { db } = await import('../src/db');

    db.prepare(`DELETE FROM agent_context_compactions WHERE session_id = ?`).run('compaction-session');
    db.prepare(`DELETE FROM agent_run_states WHERE run_id = ?`).run(707);
    db.prepare(`DELETE FROM agent_tool_calls WHERE session_id = ?`).run('compaction-session');

    upsertAgentRunState({
      runId: 707,
      sessionId: 'compaction-session',
      status: 'paused',
      phase: 'external_control',
      stageId: 'candidate-screen',
      lastAction: 'click',
      lastUrl: 'https://www.zhipin.com/web/chat/recommend',
      reason: 'user is using Chrome',
      snapshotSummary: 'URL: https://www.zhipin.com/web/chat/recommend\n标题: 推荐牛人',
    });
    db.prepare(`
      INSERT INTO agent_tool_calls (run_id, session_id, tool_call_id, tool_name, input_summary, output_summary, ok, error, side_effect, mode, stage_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(707, 'compaction-session', 'tc-compaction', 'browser', '{}', 'blocked', 0, 'user is using Chrome', 1, 'execute', 'candidate-screen');

    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '请继续 BOSS 任务。' },
      { role: 'assistant', content: '计划：先看当前页面，再处理候选人。' },
      { role: 'user', content: '候选人信息 ' + 'Agent '.repeat(400) },
      { role: 'assistant', content: '错误：Chrome 被用户接管，需要暂停。' },
      { role: 'user', content: '继续 ' + 'context '.repeat(400) },
    ] as any[];

    expect(estimateTokens(messages)).toBeGreaterThan(100);
    const result = autoCompress(messages, {
      maxTokens: 100,
      targetTokens: 50,
      preserveRecent: 1,
      sessionId: 'compaction-session',
      source: 'test',
    });

    expect(result.compressed).toBe(true);
    const records = listContextCompactions(5).filter(record => record.sessionId === 'compaction-session');
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].originalMessages).toBe(messages.length);
    expect(records[0].compressedMessages).toBe(result.messages.length);
    expect(records[0].summary).toContain('下层运行事实');
    expect(records[0].summary).toContain('external_control');
  });

  it('offloads large tool outputs to private runtime storage', async () => {
    const { offloadToolOutput, offloadToolResultForContext } = await import('../src/agent-core/tool-output-store');

    const short = offloadToolOutput({
      content: 'small output',
      toolName: 'browser',
      inlineLimit: 100,
    });
    expect(short.offloaded).toBe(false);
    expect(short.content).toBe('small output');

    const largeText = `URL: https://example.test\n${'candidate snapshot '.repeat(300)}`;
    const large = offloadToolOutput({
      content: largeText,
      toolName: 'browser',
      runId: 9001,
      sessionId: 's-output',
      kind: 'snapshot',
      inlineLimit: 200,
    });

    expect(large.offloaded).toBe(true);
    expect(large.path).toBeTruthy();
    expect(large.path?.startsWith(path.dirname(process.env.HIRESEEK_DB_PATH!))).toBe(true);
    expect(large.content).toContain('[工具输出已卸载]');
    expect(large.content).toContain('## head');
    expect(large.content).toContain('## tail');
    expect(fs.readFileSync(large.path!, 'utf8')).toContain(largeText);

    const largeToolResult = offloadToolResultForContext({
      content: 'tool result '.repeat(900),
      toolName: 'read_file',
      sessionId: 's-output',
      toolCallId: 'call-output-1',
    });
    expect(largeToolResult.offloaded).toBe(true);
    expect(largeToolResult.path).toContain('call-output-1');
    expect(largeToolResult.content).toContain('[工具输出已卸载]');
    expect(fs.readFileSync(largeToolResult.path!, 'utf8')).toContain('tool_call_id: call-output-1');

    const alreadyOffloaded = offloadToolResultForContext({
      content: largeToolResult.content,
      toolName: 'read_file',
      sessionId: 's-output',
      toolCallId: 'call-output-1',
    });
    expect(alreadyOffloaded.offloaded).toBe(false);
    expect(alreadyOffloaded.content).toBe(largeToolResult.content);
  });

  it('routes chat tool results through generic output offload', () => {
    const files = [
      'src/chat.ts',
      'src/agent-session.ts',
      'src/sub-agent.ts',
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
      expect(source).toContain('offloadToolResultForContext');
    }
  });

  it('persists run trace stage markers for compliance coverage', async () => {
    const { inspectStageCoverage, summarizeStageCoverage } = await import('../src/compliance');
    const { loadRunTrace, saveRunTrace } = await import('../src/agent-core/run-trace-store');
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
        actionLabel: '[ref=11] <button> 筛选 scope="iframe-1" rect="20,120,80x32"',
      },
    ]);

    const row = db.prepare(`
      SELECT stage_id, action_label FROM run_actions WHERE run_id = ? ORDER BY id DESC LIMIT 1
    `).get(runId) as { stage_id: string | null; action_label: string | null };
    expect(row.stage_id).toBe('prefilter');
    expect(row.action_label).toContain('scope="iframe-1"');
    expect(loadRunTrace(runId)).toEqual([
      expect.objectContaining({ seq: 1, action: 'click', stageId: 'prefilter', ok: true, actionLabel: expect.stringContaining('rect=') }),
    ]);

    const coverage = summarizeStageCoverage('boss', runId, [
      { seq: 1, action: 'click', target: 'ref=11', ok: true, stageId: 'prefilter' },
    ]);
    expect(coverage).toContain('prefilter');
    expect(coverage).toContain('已观测 browser=1');
    expect(coverage).toContain('single-contact');

    const audit = inspectStageCoverage('boss', runId, [
      { seq: 1, action: 'click', target: 'ref=11', ok: true, stageId: 'prefilter' },
    ]);
    expect(audit.declared).toBe(7);
    expect(audit.instrumented).toBe(true);
    expect(audit.stages.find(s => s.id === 'prefilter')?.browserActions).toBe(1);
    expect(audit.violations).toHaveLength(0);
  });

  it('mechanically flags contact without prefilter stage evidence', async () => {
    const { inspectStageCoverage } = await import('../src/compliance');
    const { recordToolCall } = await import('../src/agent-core/trace');
    const { db } = await import('../src/db');
    const runId = 506;

    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM agent_tool_calls WHERE run_id = ?`).run(runId);

    recordToolCall({
      runId,
      sessionId: 'stage-missing-prefilter',
      toolCallId: 'tc-contact',
      toolName: 'record_contacted',
      input: { name: 'Candidate' },
      output: 'ok',
      ok: true,
      sideEffect: false,
      mode: 'execute',
      stageId: 'single-contact',
    });

    const audit = inspectStageCoverage('boss', runId, [
      { seq: 1, action: 'click', target: 'ref=88', ok: true, stageId: 'candidate-screen' },
    ]);
    expect(audit.stages.find(s => s.id === 'single-contact')?.toolCalls).toBe(1);
    expect(audit.violations.some(v => v.severity === 'high' && v.rule.includes('筛选前置'))).toBe(true);
  });

  it('classifies dry-run browser actions without allowing side effects', async () => {
    const {
      browserActionHasSideEffect,
      browserActionMode,
      dryRunBlocksBrowserAction,
      screenBlocksBrowserAction,
    } = await import('../src/runners/dom-runner');

    expect(dryRunBlocksBrowserAction({ action: 'click', ref: 1 })).toBe(true);
    expect(dryRunBlocksBrowserAction({ action: 'type', ref: 1, text: 'hello' })).toBe(true);
    expect(dryRunBlocksBrowserAction({ action: 'goto', url: 'https://example.com' })).toBe(true);
    expect(dryRunBlocksBrowserAction({ action: 'snapshot' })).toBe(false);
    expect(dryRunBlocksBrowserAction({ action: 'scroll', direction: 'down' })).toBe(false);
    expect(screenBlocksBrowserAction({ action: 'type', ref: 1, text: 'hello' })).toBe(true);
    expect(screenBlocksBrowserAction({ action: 'press', text: 'Enter' })).toBe(true);
    expect(screenBlocksBrowserAction({ action: 'goto', url: 'https://example.com' })).toBe(true);
    expect(screenBlocksBrowserAction({ action: 'click', ref: 1 })).toBe(false);
    expect(screenBlocksBrowserAction({ action: 'back' })).toBe(false);

    expect(browserActionMode({ action: 'click', ref: 1 }, 'dry_run')).toBe('dry_run');
    expect(browserActionMode({ action: 'click', ref: 1 }, 'prepare')).toBe('prepare');
    expect(browserActionMode({ action: 'click', ref: 1 }, 'screen')).toBe('screen');
    expect(browserActionHasSideEffect({ action: 'scroll', direction: 'down' }, 'dry_run')).toBe(false);
    expect(browserActionHasSideEffect({ action: 'scroll', direction: 'down' }, 'prepare')).toBe(false);
    expect(browserActionHasSideEffect({ action: 'scroll', direction: 'down' }, 'screen')).toBe(false);
    expect(browserActionHasSideEffect({ action: 'click', ref: 1 }, 'dry_run')).toBe(true);
    expect(browserActionHasSideEffect({ action: 'click', ref: 1 }, 'prepare')).toBe(true);
    expect(browserActionHasSideEffect({ action: 'click', ref: 1 }, 'screen')).toBe(true);
  });

  it('does not treat failed or blocked actions as completed protocol stages', async () => {
    const { successfulStageIds } = await import('../src/runners/dom-runner');

    expect(successfulStageIds([
      { seq: 1, action: 'snapshot', ok: true, stageId: 'session-precheck' },
      { seq: 2, action: 'click', ok: false, stageId: 'job-positioning' },
      { seq: 3, action: 'click', ok: true, stageId: 'prefilter' },
    ])).toEqual(['session-precheck', 'prefilter']);
  });

  it('binds a greeting click to a prepared candidate and matching record token', async () => {
    const { DomRunner } = await import('../src/runners/dom-runner');
    const { bossBrowserActionPolicy, bossRunCompletionPolicy } = await import('../src/platform-protocols/boss');
    const runner = new DomRunner('https://example.invalid', 'test-key', 'test-model') as any;
    const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      }],
    });
    const prepared = {
      name: '测试候选人',
      company: '示例公司',
      title: 'Agent工程师',
      evidence: '页面显示 2 年 Agent 平台经验',
      personalization_evidence: '2 年 Agent 平台经验',
      message_intent: '讨论 Agent 工程化挑战',
      greeting_text: '您好，看到您有 Agent 平台经验，想和您聊聊工程化方向。',
      fit_score: 86,
    };
    const responses = [
      toolCall('tc-job', 'browser', { action: 'snapshot', stage_id: 'job-positioning' }),
      toolCall('tc-filter', 'browser', { action: 'snapshot', stage_id: 'prefilter' }),
      toolCall('tc-probe', 'browser', { action: 'snapshot', stage_id: 'dom-probe' }),
      toolCall('tc-screen', 'browser', { action: 'click', ref: 1, stage_id: 'candidate-screen' }),
      toolCall('tc-prepare', 'prepare_contact', prepared),
      toolCall('tc-greet', 'browser', { action: 'click', ref: 2, stage_id: 'single-contact' }),
      toolCall('tc-record', 'record_contacted', {
        ...prepared,
        greeting_sent: true,
        contact_token: 'contact-900-1',
      }),
      { role: 'assistant', content: '触达人数: 1\n跳过人数: 0\n候选人摘要: 已完成单人握手' },
    ];
    const create = vi.fn(async () => ({ choices: [{ message: responses.shift() }] }));
    runner.client = { chat: { completions: { create } } };

    let snapshot = [
      'URL: https://www.zhipin.com/web/chat/recommend',
      '[ref=1] <div> 测试候选人 2年 Agent 平台经验 class="candidate-card" pointer=true',
      'Agent 开发工程师',
    ].join('\n');
    const actions: Array<{ action: string; ref?: number; stage_id?: string }> = [];
    const session = {
      kind: 'chrome-applescript' as const,
      label: 'fake BOSS session',
      async goto() {},
      async url() { return 'https://www.zhipin.com/web/chat/recommend'; },
      async bodyText() { return snapshot; },
      async snapshot() { return snapshot; },
      async act(input: { action: string; ref?: number; stage_id?: string }) {
        actions.push(input);
        if (input.action === 'click' && input.ref === 1) {
          snapshot = [
            'URL: https://www.zhipin.com/web/chat/recommend',
            '[ref=2] <button> 打招呼 class="btn" context="测试候选人 2年 Agent 平台经验"',
            'Agent 开发工程师',
          ].join('\n');
        } else if (input.action === 'click' && input.ref === 2) {
          snapshot = [
            'URL: https://www.zhipin.com/web/chat/recommend',
            '[ref=2] <button> 继续沟通 class="btn" context="测试候选人"',
            'Agent 开发工程师',
          ].join('\n');
        }
        return snapshot;
      },
    };

    const result = await runner.runSkill(session, 'system', 'task', undefined, {
      executionMode: 'execute',
      runId: 900,
      sessionId: 'contact-handshake-test',
      initialStageId: 'session-precheck',
      requiredStagesBeforeContact: ['prefilter', 'dom-probe', 'candidate-screen'],
      browserActionPolicy: bossBrowserActionPolicy,
      completionPolicy: bossRunCompletionPolicy,
      targetJobTitle: 'Agent工程师',
    });

    expect(actions.filter(action => action.action === 'click')).toEqual([
      { action: 'click', ref: 1, stage_id: 'candidate-screen' },
      { action: 'click', ref: 2, stage_id: 'single-contact' },
    ]);
    expect(result.contacted).toBe(1);
    expect(result.contactedList).toEqual([
      expect.objectContaining({
        name: '测试候选人',
        greetingSent: true,
        score: 86,
        evidence: '页面显示 2 年 Agent 平台经验',
      }),
    ]);
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'prepare_contact', ok: true, stageId: 'candidate-screen' }),
      expect.objectContaining({ action: 'click', target: 'ref=2', ok: true, stageId: 'single-contact' }),
    ]));
  });

  it('keeps browser snapshots carrying parent element context for action policies', () => {
    const domRunnerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'runners', 'dom-runner.ts'), 'utf8');
    const appleScriptSource = fs.readFileSync(path.join(process.cwd(), 'src', 'chrome-applescript.ts'), 'utf8');

    expect(domRunnerSource).toContain('elementContext');
    expect(domRunnerSource).toContain('context="${context}"');
    expect(domRunnerSource).toContain('scope="main"');
    expect(domRunnerSource).toContain('rect="${elementRect');
    expect(domRunnerSource).toContain('role="${el.getAttribute');
    expect(domRunnerSource).toContain('tabindex="${el.getAttribute');
    expect(appleScriptSource).toContain('function elementContext');
    expect(appleScriptSource).toContain('scope="');
    expect(appleScriptSource).toContain('rect="');
    expect(appleScriptSource).toContain('context="');
    expect(appleScriptSource).toContain('role="');
    expect(appleScriptSource).toContain('tabindex="');
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

  it('audits stored session history before resume', async () => {
    const { saveAgentSessionMessages } = await import('../src/agent-core/session-store');
    const {
      collectSessionIntegrityReport,
      formatSessionIntegrityReport,
    } = await import('../src/agent-core/session-integrity');
    const { db } = await import('../src/db');

    saveAgentSessionMessages({
      sessionId: 'session-integrity-good',
      title: 'good session',
      source: 'test',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });

    db.prepare(`
      INSERT INTO agent_sessions (id, title, source, created_at, updated_at, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('session-integrity-bad', 'bad session', 'test', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z', 2);
    db.prepare(`
      INSERT INTO agent_messages (session_id, seq, role, content, raw_json)
      VALUES (?, ?, ?, ?, ?)
    `).run('session-integrity-bad', 1, 'assistant', '', JSON.stringify({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'missing-tool-result',
          type: 'function',
          function: { name: 'run_sourcing', arguments: '{}' },
        },
      ],
    }));

    const report = collectSessionIntegrityReport(50);
    expect(report.resumableSessions).toBeGreaterThan(0);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'session-integrity-bad',
        problem: 'message_count_mismatch',
      }),
      expect.objectContaining({
        sessionId: 'session-integrity-bad',
        problem: 'tool_history_needs_repair',
      }),
    ]));
    expect(formatSessionIntegrityReport(report)).toContain('Session integrity');
  });

  it('builds chat memory across enabled recruiting channels', async () => {
    const { buildChatMemoryContext } = await import('../src/memory');

    const context = buildChatMemoryContext({
      jobId: 'Agent工程师',
      channels: ['boss', 'maimai'],
    });

    expect(context).toContain('多渠道记忆上下文');
    expect(context).toContain('当前 active job 启用渠道：boss, maimai');
    expect(context).toContain('今日进度（boss）');
    expect(context).toContain('今日进度（maimai）');
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

  it('detects and reconciles stale running task runs without deleting trace data', async () => {
    const { db } = await import('../src/db');
    const {
      listInconsistentRunStates,
      listStaleExecutionEnvironments,
      formatStaleTaskRuns,
      reconcileInconsistentRunStates,
      reconcileStaleExecutionEnvironments,
      listStaleTaskRuns,
      reconcileStaleTaskRuns,
    } = await import('../src/agent-core/task-run-lifecycle');

    const oldStartedAt = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const recentStartedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const insert = db.prepare(`
      INSERT INTO task_runs (job_id, channel, mode, started_at, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    const staleId = Number(insert.run('Agent工程师', 'boss', 'screen', oldStartedAt, 'running').lastInsertRowid);
    const recentId = Number(insert.run('Agent工程师', 'boss', 'screen', recentStartedAt, 'running').lastInsertRowid);
    const closedId = Number(insert.run('Agent工程师', 'boss', 'screen', oldStartedAt, 'abandoned').lastInsertRowid);
    db.prepare(`
      INSERT INTO agent_run_states (run_id, status, phase)
      VALUES (?, ?, ?)
    `).run(staleId, 'running', 'browser_action');
    db.prepare(`
      INSERT INTO agent_run_states (run_id, status, phase)
      VALUES (?, ?, ?)
    `).run(closedId, 'running', 'browser_action');
    db.prepare(`
      INSERT INTO agent_execution_environments
        (id, kind, label, controller, status, mode, run_id, active, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`env-closed-${closedId}`, 'browser', 'test chrome', 'hireseek', 'claimed', 'screen', closedId, 1, 'still claimed');
    db.prepare(`
      INSERT INTO agent_tool_calls (run_id, tool_call_id, tool_name, input_summary, output_summary, ok, side_effect, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staleId, 'call-stale', 'browser', '{}', '{}', 1, 1, 'screen');

    const staleRuns = listStaleTaskRuns(360);
    expect(staleRuns.map(run => run.id)).toContain(staleId);
    expect(staleRuns.map(run => run.id)).not.toContain(recentId);
    expect(formatStaleTaskRuns({ staleRuns, applied: false, updated: 0, runStatesUpdated: 0 })).toContain('预览');

    const result = reconcileStaleTaskRuns({
      maxAgeMinutes: 360,
      apply: true,
      nowIso: '2026-06-30T00:00:00.000Z',
    });
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(result.runStatesUpdated).toBeGreaterThanOrEqual(1);

    const staleRow = db.prepare(`SELECT status, finished_at, error FROM task_runs WHERE id = ?`).get(staleId) as {
      status: string;
      finished_at: string;
      error: string;
    };
    const staleRunState = db.prepare(`SELECT status, phase FROM agent_run_states WHERE run_id = ?`).get(staleId) as {
      status: string;
      phase: string;
    };
    const recentRow = db.prepare(`SELECT status FROM task_runs WHERE id = ?`).get(recentId) as { status: string };
    const traceCount = (db.prepare(`SELECT COUNT(*) AS n FROM agent_tool_calls WHERE run_id = ?`).get(staleId) as { n: number }).n;

    expect(staleRow.status).toBe('abandoned');
    expect(staleRow.finished_at).toBe('2026-06-30T00:00:00.000Z');
    expect(staleRow.error).toContain('abandoned_after_');
    expect(staleRunState.status).toBe('abandoned');
    expect(staleRunState.phase).toBe('task_run_abandoned');
    expect(recentRow.status).toBe('running');
    expect(traceCount).toBe(1);

    expect(listInconsistentRunStates(20).map(row => row.runId)).toContain(closedId);
    const fixed = reconcileInconsistentRunStates({ apply: true });
    expect(fixed.updated).toBeGreaterThanOrEqual(1);
    const closedRunState = db.prepare(`SELECT status, phase FROM agent_run_states WHERE run_id = ?`).get(closedId) as {
      status: string;
      phase: string;
    };
    expect(closedRunState.status).toBe('abandoned');
    expect(closedRunState.phase).toBe('task_run_reconciled');

    expect(listStaleExecutionEnvironments(20).map(env => env.id)).toContain(`env-closed-${closedId}`);
    const released = reconcileStaleExecutionEnvironments({ apply: true });
    expect(released.updated).toBeGreaterThanOrEqual(1);
    const envRow = db.prepare(`SELECT status, active, reason FROM agent_execution_environments WHERE id = ?`).get(`env-closed-${closedId}`) as {
      status: string;
      active: number;
      reason: string;
    };
    expect(envRow.status).toBe('released');
    expect(envRow.active).toBe(0);
    expect(envRow.reason).toContain('environment_released_after_task_status=abandoned');
  });

  it('stores raw, episodic, and semantic memory without strategy interpretation', async () => {
    const {
      archiveMemory,
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
    const archivedRawId = writeRawMemory({
      source: 'governance-test',
      content: 'archived raw event',
      visibility: 'private',
    });
    const expiredEpisodeId = writeEpisodicMemory({
      userId: 'u1',
      source: 'governance-test',
      visibility: 'private',
      summary: 'expired episode',
      content: 'expired memory should not be active',
      expiresAt: '2000-01-01T00:00:00Z',
    });
    upsertSemanticFact({
      key: 'policy.hidden',
      value: 'not for prompt injection',
      source: 'governance-test',
      visibility: 'private',
      injectAllowed: false,
    });
    expect(archiveMemory('raw', archivedRawId)).toBe(true);

    expect(rawId).toBeGreaterThan(0);
    expect(duplicatedRawId).toBe(rawId);
    expect(episodeId).toBeGreaterThan(0);
    expect(duplicatedEpisodeId).toBe(episodeId);
    expect(expiredEpisodeId).toBeGreaterThan(0);
    expect(listRawMemory({ source: 'test', visibility: 'private' })[0]).toMatchObject({
      source: 'test',
      visibility: 'private',
      version: 1,
      inject_allowed: 1,
    });
    expect(searchEpisodicMemory({ userId: 'u1', query: 'remote', visibility: 'private' })).toHaveLength(1);
    expect(getSemanticFacts({ key: 'company.name', visibility: 'private' })[0]).toMatchObject({
      fact_value: 'BlackLake',
      visibility: 'private',
      version: 1,
      inject_allowed: 1,
    });
    expect(listRawMemory({ source: 'governance-test' })).toHaveLength(0);
    expect(listRawMemory({ source: 'governance-test', includeInactive: true })[0].archived_at).toBeTruthy();
    expect(searchEpisodicMemory({ source: 'governance-test', query: 'expired' })).toHaveLength(0);
    expect(searchEpisodicMemory({ source: 'governance-test', query: 'expired', includeInactive: true })[0].expires_at).toBeTruthy();
    expect(getSemanticFacts({ key: 'policy.hidden', injectAllowed: true })).toHaveLength(0);
    expect(getSemanticFacts({ key: 'policy.hidden', injectAllowed: false })[0]).toMatchObject({
      fact_value: 'not for prompt injection',
      inject_allowed: 0,
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

  it('keeps dry-run candidate text out of outreach persistence', async () => {
    const { normalizeResultForRunMode, persistRunResult } = await import('../src/orchestrator');
    const { db } = await import('../src/db');
    const runId = 304;

    db.prepare(`DELETE FROM interaction_log WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM run_candidates WHERE run_id = ?`).run(runId);

    const result = normalizeResultForRunMode({
      contacted: 1,
      skipped: 0,
      candidates: [],
      summary: 'dry-run report with a candidate bullet',
      contactedList: [{ name: 'Observed Candidate', greetingSent: true }],
      trace: [{ seq: 1, action: 'wait', ok: true, stageId: 'session-precheck', mode: 'dry_run' }],
    }, 'dry_run');

    persistRunResult(runId, 'Agent工程师', 'boss', result, { mode: 'dry_run' });

    expect(result.contacted).toBe(0);
    expect(result.contactedList?.[0]?.greetingSent).toBe(false);
    expect((db.prepare(`SELECT COUNT(*) n FROM run_candidates WHERE run_id = ?`).get(runId) as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM interaction_log WHERE run_id = ?`).get(runId) as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM run_actions WHERE run_id = ?`).get(runId) as { n: number }).n).toBe(1);

    const prepareRunId = 305;
    db.prepare(`DELETE FROM interaction_log WHERE run_id = ?`).run(prepareRunId);
    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(prepareRunId);
    db.prepare(`DELETE FROM run_candidates WHERE run_id = ?`).run(prepareRunId);
    const prepareResult = normalizeResultForRunMode({
      contacted: 1,
      skipped: 0,
      candidates: [],
      summary: 'prepare report',
      contactedList: [{ name: 'Prepare Candidate', greetingSent: true }],
      trace: [{ seq: 1, action: 'click', ok: true, stageId: 'prefilter', mode: 'prepare' }],
    }, 'prepare');
    persistRunResult(prepareRunId, 'Agent工程师', 'boss', prepareResult, { mode: 'prepare' });
    expect(prepareResult.contacted).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM run_candidates WHERE run_id = ?`).get(prepareRunId) as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM interaction_log WHERE run_id = ?`).get(prepareRunId) as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM run_actions WHERE run_id = ?`).get(prepareRunId) as { n: number }).n).toBe(1);

    const screenRunId = 306;
    db.prepare(`DELETE FROM interaction_log WHERE run_id = ?`).run(screenRunId);
    db.prepare(`DELETE FROM run_actions WHERE run_id = ?`).run(screenRunId);
    db.prepare(`DELETE FROM run_candidates WHERE run_id = ?`).run(screenRunId);
    db.prepare(`DELETE FROM screen_candidates WHERE run_id = ?`).run(screenRunId);
    const screenResult = normalizeResultForRunMode({
      contacted: 1,
      skipped: 1,
      candidates: [],
      summary: 'screen report',
      contactedList: [{ name: 'Screen Candidate', greetingSent: true }],
      screenedList: [{
        name: 'Screen Candidate',
        company: 'ExampleAI',
        recommendation: 'contact',
        score: 81,
        evidence: '2 years Agent platform work',
        fitTags: ['Agent'],
      }],
      trace: [{ seq: 1, action: 'click', ok: true, stageId: 'candidate-screen', mode: 'screen' }],
    }, 'screen');
    persistRunResult(screenRunId, 'Agent工程师', 'boss', screenResult, { mode: 'screen' });
    expect(screenResult.contacted).toBe(0);
    expect(screenResult.contactedList?.[0]?.greetingSent).toBe(false);
    expect((db.prepare(`SELECT COUNT(*) n FROM run_candidates WHERE run_id = ?`).get(screenRunId) as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM interaction_log WHERE run_id = ?`).get(screenRunId) as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM screen_candidates WHERE run_id = ?`).get(screenRunId) as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) n FROM run_actions WHERE run_id = ?`).get(screenRunId) as { n: number }).n).toBe(1);
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

  it('does not treat non-execute task runs as formal outreach contract failures', async () => {
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

    const prepareInserted = taskRunOps.start.run({
      job_id: 'Agent工程师',
      channel: 'boss',
      mode: 'prepare',
      started_at: new Date().toISOString(),
    });
    const prepareRunId = Number(prepareInserted.lastInsertRowid);
    taskRunOps.complete.run({
      id: prepareRunId,
      finished_at: new Date().toISOString(),
      status: 'completed',
      contacted_count: 0,
      skipped_count: 0,
      error: null,
    });
    const prepareCheck = await complianceCheck({ runId: prepareRunId });
    expect(prepareCheck.verdict).toBe('skip');
    expect(prepareCheck.violations).toHaveLength(0);

    const pausedInserted = taskRunOps.start.run({
      job_id: 'Agent工程师',
      channel: 'boss',
      mode: 'execute',
      started_at: new Date().toISOString(),
    });
    const pausedRunId = Number(pausedInserted.lastInsertRowid);
    taskRunOps.complete.run({
      id: pausedRunId,
      finished_at: new Date().toISOString(),
      status: 'paused',
      contacted_count: 0,
      skipped_count: 0,
      error: 'user is using Chrome',
    });
    const pausedCheck = await complianceCheck({ runId: pausedRunId });
    expect(pausedCheck.verdict).toBe('skip');
    expect(pausedCheck.summary).toContain('已暂停');
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
    expect(text).toContain('Run states:');
    expect(text).toContain('Execution environments:');
    expect(text).toContain('Harness failures:');
    expect(text).toContain('Context compactions:');
    expect(text).toContain('Memory:');
  });

  it('persists run assembly snapshots without storing prompt bodies', async () => {
    const { db } = await import('../src/db');
    const { buildHarnessRunAssembly } = await import('../src/harness/run-assembly');
    const {
      saveRunAssemblySnapshot,
      loadRunAssemblySnapshot,
    } = await import('../src/agent-core/run-assembly-store');
    const runId = 17101;
    const systemPrompt = '系统提示里包含岗位事实和私人上下文';
    const taskPrompt = '任务提示里包含候选人操作要求';

    db.prepare(`DELETE FROM agent_run_assemblies WHERE run_id = ?`).run(runId);
    saveRunAssemblySnapshot({
      runId,
      jobId: 'agent-engineer',
      channel: 'boss',
      mode: 'screen',
      assembly: buildHarnessRunAssembly('boss', 'screen'),
      systemPrompt,
      taskPrompt,
      environments: [{
        id: 'browser:chrome-applescript',
        kind: 'browser',
        label: '真实 Chrome',
        controller: 'hireseek',
        status: 'claimed',
        mode: 'screen',
        runId,
        sessionId: null,
        url: 'https://www.zhipin.com/web/chat/recommend',
        title: '推荐牛人',
        active: true,
      }],
    });

    const snapshot = loadRunAssemblySnapshot(runId);
    expect(snapshot).toMatchObject({
      runId,
      jobId: 'agent-engineer',
      channel: 'boss',
      mode: 'screen',
      platformProtocol: 'boss-platform.v1',
      contractName: 'boss-greeting.v1',
      skillAssetMode: 'productized-fallback-only',
      systemPromptChars: systemPrompt.length,
      taskPromptChars: taskPrompt.length,
    });
    expect(snapshot?.tools.some(tool => tool.name === 'record_screened_candidate' && tool.declaredToModel)).toBe(true);
    expect(snapshot?.boundaries).toContain('trace-every-tool-call');
    expect(snapshot?.environments[0]).toMatchObject({
      kind: 'browser',
      status: 'claimed',
      mode: 'screen',
    });

    const raw = db.prepare(`
      SELECT context_blocks_json, tools_json, system_prompt_hash, task_prompt_hash
      FROM agent_run_assemblies
      WHERE run_id = ?
    `).get(runId) as {
      context_blocks_json: string;
      tools_json: string;
      system_prompt_hash: string;
      task_prompt_hash: string;
    };
    expect(raw.context_blocks_json).toContain('runtime-context');
    expect(raw.tools_json).toContain('record_screened_candidate');
    expect(raw.system_prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.task_prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(raw)).not.toContain(systemPrompt);
    expect(JSON.stringify(raw)).not.toContain(taskPrompt);
  });

  it('records early browser environment failures under a task run', async () => {
    const { config } = await import('../src/config');
    const { db } = await import('../src/db');
    const originalBrowserControl = config.browser.control;
    config.browser.control = 'invalid-for-test';
    try {
      const { runChannel } = await import('../src/orchestrator');
      const runId = await runChannel('boss', 'agent-engineer', { dryRun: true, progress: () => {} });

      const run = db.prepare(`
        SELECT status, error, mode
        FROM task_runs
        WHERE id = ?
      `).get(runId) as { status: string; error: string; mode: string };
      expect(run).toMatchObject({
        status: 'failed',
        mode: 'dry_run',
      });
      expect(run.error).toContain('不支持的 HIRESEEK_BROWSER_CONTROL');

      const assembly = db.prepare(`
        SELECT provider, mode, system_prompt_hash, task_prompt_hash
        FROM agent_run_assemblies
        WHERE run_id = ?
      `).get(runId) as {
        provider: string;
        mode: string;
        system_prompt_hash: string;
        task_prompt_hash: string;
      };
      expect(assembly.mode).toBe('dry_run');
      expect(assembly.system_prompt_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(assembly.task_prompt_hash).toMatch(/^[a-f0-9]{64}$/);

      const env = db.prepare(`
        SELECT run_id, status, mode, reason
        FROM agent_execution_environments
        WHERE run_id = ? AND status = 'error'
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(runId) as { run_id: number; status: string; mode: string; reason: string };
      expect(env).toMatchObject({
        run_id: runId,
        status: 'error',
        mode: 'dry_run',
      });
      expect(env.reason).toContain('不支持的 HIRESEEK_BROWSER_CONTROL');
    } finally {
      config.browser.control = originalBrowserControl;
    }
  });

  it('formats product doctor report without executing live browser workflows', async () => {
    const { collectDoctorReport, formatDoctorReport } = await import('../src/doctor');
    const { createToolRegistry } = await import('../src/agent-core/tool-registry');
    const { upsertAgentRunState } = await import('../src/agent-core/run-state-store');

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
          name: 'product_doctor',
          description: 'doctor',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'platform_protocols',
          description: 'protocols',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'recruiting_capabilities',
          description: 'capabilities',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_sourcing',
          description: 'run',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
    upsertAgentRunState({
      runId: 909,
      status: 'paused',
      phase: 'external_control',
      stageId: 'candidate-screen',
      lastAction: 'click',
      reason: 'user is using Chrome',
    });

    const report = collectDoctorReport(registry);
    const text = formatDoctorReport(report);

    expect(text).toContain('HireSeek Doctor');
    expect(text).toContain('下层 Agent Core');
    expect(text).toContain('BOSS protocol wiring');
    expect(text).toContain('Recruiting capabilities');
    expect(text).toContain('Live BOSS run');
    expect(text).toContain('Live BOSS prepare');
    expect(text).toContain('Live BOSS screen');
    expect(text).toContain('Pending run states');
    expect(text).toContain('Task run lifecycle');
    expect(text).toContain('Context compaction ledger');
    expect(text).toContain('Run assembly ledger');
    expect(text).toContain('Memory governance columns');
    expect(text).toContain('Harness failure classifier');
    expect(text).toContain('Harness run assembly');
    expect(text).toContain('Chat harness assembly');
    expect(text).toContain('Chat memory assembly');
    expect(text).toContain('Session history integrity');
    expect(text).toContain('Platform protocol manifest');
    expect(text).toContain('Capability manifest');
    expect(text).toContain('Skill asset manifest');
    expect(report.checks.some(c => c.name === 'Tool registry' && c.status === 'pass')).toBe(true);
    expect(report.checks.some(c => c.name === 'Runner tool registry' && c.status === 'pass')).toBe(true);
    expect(report.checks.some(c => c.name === 'Pending run states' && c.status === 'warn')).toBe(true);
  });
});
