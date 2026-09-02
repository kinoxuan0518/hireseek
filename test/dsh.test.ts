import './dsh-env';
import { afterEach, describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { Context } from '../src/dsh/context';
import { Session, sessionPlugin, type SessionService } from '../src/dsh/session';
import { promptPlugin, type PromptService } from '../src/dsh/prompt';
import { toolsPlugin, type ToolService } from '../src/dsh/tools';
import { llmPlugin, type LLMService } from '../src/dsh/llm';
import { loopPlugin, type AgentLoop } from '../src/dsh/loop';
import { bootHarness, resetHarness } from '../src/runtime';
import { createToolRegistry } from '../src/agent-core/tool-registry';
import type { LLMResponse } from '../src/dsh/types';

afterEach(() => {
  resetHarness();
});

describe('dsh kernel', () => {
  it('unloads plugin effects when the context is disposed', () => {
    const ctx = new Context();
    ctx.plugin({
      name: 'probe',
      apply: inner => {
        inner.provide('probe', { ok: true });
        inner.on('ping', () => undefined);
      },
    });
    expect(ctx.get<{ ok: boolean }>('probe').ok).toBe(true);
    ctx.dispose();
    expect(() => ctx.get('probe')).toThrow(/not registered/);
  });

  it('runs waterfall interceptors in registration order and can short-circuit', async () => {
    const ctx = new Context();
    const order: string[] = [];
    ctx.on('tools/pre-execute', async (payload: { n: number; blocked?: boolean }, next) => {
      order.push('outer');
      payload.n += 1;
      return next(payload);
    });
    ctx.on('tools/pre-execute', async (payload: { n: number; blocked?: boolean }, _next) => {
      order.push('deny');
      payload.blocked = true;
      return payload;
    });
    ctx.on('tools/pre-execute', async (payload: { n: number }, next) => {
      order.push('should-not-run');
      return next(payload);
    });
    const result = await ctx.waterfall('tools/pre-execute', { n: 0 });
    expect(order).toEqual(['outer', 'deny']);
    expect(result).toEqual({ n: 1, blocked: true });
  });

  it('projects model history from the session log and keeps system/tool pairing', () => {
    const ctx = new Context();
    ctx.plugin({ name: 'sessions', apply: sessionPlugin });
    const sessions = ctx.get<SessionService>('sessions');
    const session = sessions.create({ id: 's1', source: 'test' });
    session.ensureSystem('you are hireseek');
    session.append('user/message', { content: '找候选人' });
    session.append('assistant/message', {
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_funnel', arguments: '{}' } }],
    });
    session.append('tool/result', { tool_call_id: 'c1', content: '漏斗空', name: 'get_funnel' });
    session.append('assistant/message', { content: '今天还没触达' });

    const messages = session.deriveMessages();
    expect(messages[0]).toEqual({ role: 'system', content: 'you are hireseek' });
    expect(messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
    expect((messages[3] as { tool_call_id: string }).tool_call_id).toBe('c1');
  });

  it('assembles prompt sections by priority', () => {
    const ctx = new Context();
    ctx.plugin({ name: 'prompt', apply: promptPlugin });
    const prompt = ctx.get<PromptService>('systemPrompt');
    prompt.register({ id: 'b', priority: 20, render: () => 'beta' });
    prompt.register({ id: 'a', priority: 10, render: () => 'alpha' });
    prompt.register({ id: 'skip', priority: 15, render: () => '' });
    expect(prompt.assemble()).toBe('alpha\n\n---\n\nbeta');
  });
});

describe('dsh agent loop', () => {
  function mockTools() {
    return createToolRegistry([
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'echo',
          parameters: { type: 'object', properties: { text: { type: 'string' } } },
        },
      },
    ], { echo: { category: 'other', sideEffect: false } });
  }

  it('runs a tool step then a final answer from the same loop', async () => {
    const ctx = new Context();
    ctx.plugin({ name: 'sessions', apply: sessionPlugin });
    ctx.plugin({ name: 'prompt', apply: promptPlugin });
    ctx.plugin({ name: 'tools', apply: toolsPlugin });
    ctx.plugin({ name: 'llm', apply: llmPlugin });
    ctx.plugin({ name: 'loop', apply: loopPlugin });

    const calls: string[] = [];
    const tools = ctx.get<ToolService>('tools');
    tools.bind({
      registry: mockTools(),
      execute: async (name, args) => {
        calls.push(name);
        return `echo:${String(args.text ?? '')}`;
      },
      schemas: mockTools().list().map(t => t.schema),
    });

    let round = 0;
    ctx.get<LLMService>('llm').register({
      id: 'mock',
      async complete(): Promise<LLMResponse> {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'echo', arguments: '{"text":"hi"}' },
            } as OpenAI.Chat.Completions.ChatCompletionMessageToolCall],
          };
        }
        return { content: 'done:echo:hi' };
      },
    });
    ctx.get<LLMService>('llm').setDefaultModel('mock');

    const session = ctx.get<SessionService>('sessions').create({ source: 'test' });
    session.ensureSystem('sys');
    const result = await ctx.get<AgentLoop>('agentLoop').runTurn({
      session,
      input: 'go',
      preserveSystem: true,
    });

    expect(calls).toEqual(['echo']);
    expect(result.stopped).toBe('complete');
    expect(result.steps).toBe(2);
    expect(result.text).toBe('done:echo:hi');
    const types = session.list().map(event => event.type);
    expect(types).toContain('turn/start');
    expect(types).toContain('tool/result');
    expect(types[types.length - 1]).toBe('turn/end');
    expect(session.deriveMessages().some(m => m.role === 'tool' && String((m as { content?: string }).content).includes('echo:hi'))).toBe(true);
  });

  it('blocks unknown tools without throwing and still closes the turn', async () => {
    const ctx = new Context();
    ctx.plugin({ name: 'sessions', apply: sessionPlugin });
    ctx.plugin({ name: 'tools', apply: toolsPlugin });
    ctx.plugin({ name: 'llm', apply: llmPlugin });
    ctx.plugin({ name: 'loop', apply: loopPlugin });
    ctx.get<ToolService>('tools').bind({
      registry: mockTools(),
      execute: async () => 'should-not-run',
    });

    let round = 0;
    ctx.get<LLMService>('llm').register({
      id: 'mock',
      async complete(): Promise<LLMResponse> {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            tool_calls: [{
              id: 'call_x',
              type: 'function',
              function: { name: 'not_a_tool', arguments: '{}' },
            } as OpenAI.Chat.Completions.ChatCompletionMessageToolCall],
          };
        }
        return { content: 'unknown handled' };
      },
    });
    ctx.get<LLMService>('llm').setDefaultModel('mock');

    const session = ctx.get<SessionService>('sessions').create({ source: 'test' });
    const result = await ctx.get<AgentLoop>('agentLoop').runTurn({
      session,
      input: 'x',
      preserveSystem: true,
    });
    expect(result.text).toBe('unknown handled');
    const toolMsg = session.deriveMessages().find(m => m.role === 'tool') as { content: string };
    expect(JSON.parse(toolMsg.content).error.code).toBe('unknown_tool');
  });
});

describe('hireseek dsh runtime', () => {
  it('boots the chat profile with prompt sections and a replaceable loop', () => {
    const harness = bootHarness('chat');
    expect(harness.inspect()).toContain('profile: chat');
    expect(harness.inspect()).toContain('hireseek/permission');
    expect(harness.systemPrompt.list().map(s => s.id)).toEqual(expect.arrayContaining([
      'soul',
      'chat-guide',
      'harness-assembly',
    ]));
    harness.dispose();
  });

  it('does not mount hireseek prompt sections on the subagent profile', () => {
    const harness = bootHarness('subagent');
    expect(harness.systemPrompt.list()).toEqual([]);
    expect(harness.inspect()).not.toContain('hireseek/prompt');
    harness.dispose();
  });
});

describe('session hydrate', () => {
  it('round-trips existing OpenAI messages into the event log', () => {
    const ctx = new Context();
    const session = new Session(ctx, { id: 'hydrate' });
    session.hydrate([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      } as OpenAI.ChatCompletionAssistantMessageParam,
      { role: 'tool', tool_call_id: 't1', content: 'ok' },
    ]);
    const messages = session.deriveMessages();
    expect(messages).toHaveLength(4);
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: 'ok' });
  });
});
