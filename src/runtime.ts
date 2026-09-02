/**
 * Seeya 运行时：按 DSH profile 装配插件树。
 *
 * 一切皆插件——模型适配器、工具管线、会话日志、系统提示、Agent Loop
 * 都挂在同一个 Context 上，入口（chat / 飞书 / 指挥台 / sub-agent）共用这一套驱动。
 */

import { Context } from './dsh/context';
import { sessionPlugin, type SessionService } from './dsh/session';
import { promptPlugin, type PromptService } from './dsh/prompt';
import { toolsPlugin, type ToolExecutor, type ToolService } from './dsh/tools';
import { llmPlugin, type LLMService } from './dsh/llm';
import { loopPlugin, type AgentLoop } from './dsh/loop';
import { permissionPlugin } from './plugins/permission';
import { tracePlugin } from './plugins/trace';
import { offloadPlugin } from './plugins/offload';
import { persistPlugin } from './plugins/persist';
import { llmOpenAIPlugin } from './plugins/llm-openai';
import { promptHireSeekPlugin } from './plugins/prompt-hireseek';
import type { ProfileName } from './dsh/types';
import type { ToolRegistry } from './agent-core/tool-registry';
import type OpenAI from 'openai';

export interface Harness {
  ctx: Context;
  profile: ProfileName;
  sessions: SessionService;
  systemPrompt: PromptService;
  tools: ToolService;
  llm: LLMService;
  loop: AgentLoop;
  inspect(): string;
  dispose(): void;
}

const PROFILE_PLUGINS: Record<ProfileName, Array<{ name: string; apply: (ctx: Context) => void }>> = {
  chat: [
    { name: 'dsh/session', apply: sessionPlugin },
    { name: 'dsh/prompt', apply: promptPlugin },
    { name: 'dsh/tools', apply: toolsPlugin },
    { name: 'dsh/llm', apply: llmPlugin },
    { name: 'dsh/loop', apply: loopPlugin },
    { name: 'hireseek/prompt', apply: promptHireSeekPlugin },
    { name: 'hireseek/llm-openai', apply: llmOpenAIPlugin },
    { name: 'hireseek/permission', apply: permissionPlugin },
    { name: 'hireseek/offload', apply: offloadPlugin },
    { name: 'hireseek/trace', apply: tracePlugin },
    { name: 'hireseek/persist', apply: persistPlugin },
  ],
  headless: [
    { name: 'dsh/session', apply: sessionPlugin },
    { name: 'dsh/prompt', apply: promptPlugin },
    { name: 'dsh/tools', apply: toolsPlugin },
    { name: 'dsh/llm', apply: llmPlugin },
    { name: 'dsh/loop', apply: loopPlugin },
    { name: 'hireseek/prompt', apply: promptHireSeekPlugin },
    { name: 'hireseek/llm-openai', apply: llmOpenAIPlugin },
    { name: 'hireseek/permission', apply: permissionPlugin },
    { name: 'hireseek/offload', apply: offloadPlugin },
    { name: 'hireseek/trace', apply: tracePlugin },
    { name: 'hireseek/persist', apply: persistPlugin },
  ],
  subagent: [
    { name: 'dsh/session', apply: sessionPlugin },
    { name: 'dsh/prompt', apply: promptPlugin },
    { name: 'dsh/tools', apply: toolsPlugin },
    { name: 'dsh/llm', apply: llmPlugin },
    { name: 'dsh/loop', apply: loopPlugin },
    { name: 'hireseek/llm-openai', apply: llmOpenAIPlugin },
    { name: 'hireseek/permission', apply: permissionPlugin },
    { name: 'hireseek/offload', apply: offloadPlugin },
    { name: 'hireseek/trace', apply: tracePlugin },
    { name: 'hireseek/persist', apply: persistPlugin },
  ],
};

let singleton: Harness | null = null;

export function bootHarness(profile: ProfileName = 'chat'): Harness {
  const ctx = new Context();
  for (const plugin of PROFILE_PLUGINS[profile]) {
    ctx.plugin(plugin);
  }
  const harness: Harness = {
    ctx,
    profile,
    sessions: ctx.get('sessions'),
    systemPrompt: ctx.get('systemPrompt'),
    tools: ctx.get('tools'),
    llm: ctx.get('llm'),
    loop: ctx.get('agentLoop'),
    inspect: () => [
      'Seeya DSH runtime',
      `profile: ${profile}`,
      `plugins: ${PROFILE_PLUGINS[profile].map(p => p.name).join(', ')}`,
      `prompt sections: ${ctx.get<PromptService>('systemPrompt').list().map(s => s.id).join(', ') || '(none)'}`,
      `llm: ${ctx.get<LLMService>('llm').current().id}`,
      `tools bound: ${ctx.get<ToolService>('tools').bound() ? 'yes' : 'no'}`,
    ].join('\n'),
    dispose: () => ctx.dispose(),
  };
  return harness;
}

export function getHarness(profile: ProfileName = 'chat'): Harness {
  if (!singleton) singleton = bootHarness(profile);
  return singleton;
}

export function resetHarness(): void {
  singleton?.dispose();
  singleton = null;
}

export function bindHireSeekChatRuntime(input: {
  registry: ToolRegistry;
  execute: ToolExecutor;
  schemas?: OpenAI.ChatCompletionTool[];
  describe?: (name: string, args: Record<string, unknown>) => string;
}): void {
  getHarness().tools.bind(input);
}

export function dumpHarnessConfig(profile: ProfileName = 'chat'): string {
  const harness = bootHarness(profile);
  try {
    return harness.inspect();
  } finally {
    harness.dispose();
  }
}
