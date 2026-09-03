/**
 * 模型即插头：按任务选 provider，而不是绑死一家默认大脑。
 *
 * chat    — 对话 / 心跳
 * driver  — 寻源开车（默认仍是 DOM 动手；视觉模型也可以当这个脑）
 * vision  — 读图（简历截图、二维码）；主模型不能看时再换能看的
 */

import dotenv from 'dotenv';
import OpenAI from 'openai';
import { productEnv, type EnvMap as ProductEnvMap } from '../product';

dotenv.config();

export type ProviderId =
  | 'deepseek'
  | 'kimi'
  | 'glm'
  | 'claude'
  | 'openai'
  | 'minimax'
  | 'custom';

export type BrowserActuator = 'dom' | 'vision' | 'claude-cu' | 'openai-cu';
export type LlmRole = 'chat' | 'driver' | 'vision';
export type ReasoningEffort = 'low' | 'high' | 'max';

export interface ProviderSpec {
  id: ProviderId;
  aliases: string[];
  label: string;
  defaultModel: string;
  apiKeyEnv: string[];
  baseUrlEnv: string[];
  defaultBaseUrl?: string;
  openaiCompat: boolean;
  /** 默认模型本身能不能吃图 */
  vision: boolean;
  /** 该 provider 上 DeepSeek 式的视觉专用模型（主模型不能看时用） */
  visionModel?: string;
  defaultActuator: BrowserActuator;
  /** 多轮必须回传 reasoning_content */
  preserveReasoning: boolean;
  /** 思考关不掉；乱传 temperature 会 400 */
  alwaysThinking: boolean;
  /** 寻源循环默认推理强度（可用 SEEYA_REASONING_EFFORT / HIRESEEK_REASONING_EFFORT 覆盖） */
  defaultDriverEffort?: ReasoningEffort;
  visionImages: 'none' | 'url-or-base64' | 'base64-only';
}

export interface CompatChatOptions {
  extras?: Record<string, unknown>;
  preserveAssistantMessage?: boolean;
  omitSampling?: boolean;
}

export interface ResolvedEndpoint {
  role: LlmRole;
  provider: ProviderId;
  spec: ProviderSpec;
  apiKey: string;
  baseUrl: string | undefined;
  model: string;
  extras: Record<string, unknown>;
  actuator: BrowserActuator;
  compat: CompatChatOptions;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  deepseek: {
    id: 'deepseek',
    aliases: ['ds'],
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
    baseUrlEnv: ['DEEPSEEK_BASE_URL'],
    defaultBaseUrl: 'https://api.deepseek.com',
    openaiCompat: true,
    vision: false,
    visionModel: 'deepseek-v4-flash-vision-exp',
    defaultActuator: 'dom',
    preserveReasoning: false,
    alwaysThinking: false,
    visionImages: 'url-or-base64',
  },
  kimi: {
    id: 'kimi',
    aliases: ['moonshot', 'moonshot-ai'],
    label: 'Kimi',
    defaultModel: 'kimi-k3',
    apiKeyEnv: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    baseUrlEnv: ['MOONSHOT_BASE_URL', 'KIMI_BASE_URL'],
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    openaiCompat: true,
    vision: true,
    defaultActuator: 'dom',
    preserveReasoning: true,
    alwaysThinking: true,
    defaultDriverEffort: 'low',
    visionImages: 'base64-only',
  },
  glm: {
    id: 'glm',
    aliases: ['zhipu', 'z.ai', 'zai', 'bigmodel'],
    label: 'GLM',
    defaultModel: 'glm-5.3-flash',
    apiKeyEnv: ['ZHIPU_API_KEY', 'BIGMODEL_API_KEY', 'GLM_API_KEY'],
    baseUrlEnv: ['ZHIPU_BASE_URL', 'BIGMODEL_BASE_URL', 'GLM_BASE_URL'],
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    openaiCompat: true,
    vision: true,
    defaultActuator: 'dom',
    preserveReasoning: true,
    alwaysThinking: true,
    defaultDriverEffort: 'low',
    visionImages: 'url-or-base64',
  },
  claude: {
    id: 'claude',
    aliases: ['anthropic'],
    label: 'Claude',
    defaultModel: 'claude-opus-4-6',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    baseUrlEnv: ['ANTHROPIC_BASE_URL'],
    openaiCompat: false,
    vision: true,
    defaultActuator: 'claude-cu',
    preserveReasoning: false,
    alwaysThinking: false,
    visionImages: 'url-or-base64',
  },
  openai: {
    id: 'openai',
    aliases: [],
    label: 'OpenAI',
    defaultModel: 'computer-use-preview',
    apiKeyEnv: ['OPENAI_API_KEY'],
    baseUrlEnv: ['OPENAI_BASE_URL'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    openaiCompat: false,
    vision: true,
    defaultActuator: 'openai-cu',
    preserveReasoning: false,
    alwaysThinking: false,
    visionImages: 'url-or-base64',
  },
  minimax: {
    id: 'minimax',
    aliases: [],
    label: 'MiniMax',
    defaultModel: 'MiniMax-Text-01',
    apiKeyEnv: ['MINIMAX_API_KEY'],
    baseUrlEnv: ['MINIMAX_BASE_URL'],
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    openaiCompat: true,
    vision: true,
    defaultActuator: 'vision',
    preserveReasoning: false,
    alwaysThinking: false,
    visionImages: 'url-or-base64',
  },
  custom: {
    id: 'custom',
    aliases: [],
    label: 'Custom',
    defaultModel: '',
    apiKeyEnv: ['CUSTOM_API_KEY'],
    baseUrlEnv: ['CUSTOM_BASE_URL'],
    openaiCompat: true,
    vision: true,
    defaultActuator: 'vision',
    preserveReasoning: false,
    alwaysThinking: false,
    visionImages: 'url-or-base64',
  },
};

export const DEFAULT_MODELS: Record<string, string> = Object.fromEntries(
  Object.values(PROVIDERS).map(spec => [spec.id, spec.defaultModel]),
);

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

type EnvMap = ProductEnvMap;

function envValue(env: EnvMap, names: string[]): string {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

export function normalizeProviderId(raw?: string | null): ProviderId {
  const key = (raw ?? 'deepseek').trim().toLowerCase();
  if (key in PROVIDERS) return key as ProviderId;
  for (const spec of Object.values(PROVIDERS)) {
    if (spec.aliases.includes(key)) return spec.id;
  }
  throw new Error(
    `不支持的 LLM_PROVIDER: "${raw}"。可选: ${PROVIDER_IDS.join(' | ')}（kimi 可用 moonshot，glm 可用 zhipu）`,
  );
}

export function specFor(id: ProviderId): ProviderSpec {
  return PROVIDERS[id];
}

export function listedProviders(): string {
  return PROVIDER_IDS.join(' | ');
}

export function firstApiKey(spec: ProviderSpec, env: EnvMap = process.env): string {
  return envValue(env, spec.apiKeyEnv);
}

export function hasAnyApiKey(env: EnvMap = process.env): boolean {
  return Object.values(PROVIDERS).some(spec => Boolean(firstApiKey(spec, env)));
}

export function parseBrowserMode(raw?: string | null): 'auto' | 'dom' | 'vision' {
  const key = (raw ?? 'auto').trim().toLowerCase();
  if (key === 'dom' || key === 'vision') return key;
  return 'auto';
}

export function parseReasoningEffort(raw?: string | null): ReasoningEffort | undefined {
  const key = (raw ?? '').trim().toLowerCase();
  if (key === 'low' || key === 'high' || key === 'max') return key;
  return undefined;
}

function completionExtras(spec: ProviderSpec, effort?: ReasoningEffort): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (spec.id === 'kimi' && effort) extras.reasoning_effort = effort;
  if (spec.id === 'glm') {
    extras.thinking = { type: 'enabled', clear_thinking: false };
    if (effort) extras.reasoning_effort = effort;
  }
  return extras;
}

function resolveEffort(role: LlmRole, spec: ProviderSpec, env: EnvMap): ReasoningEffort | undefined {
  const explicit = parseReasoningEffort(productEnv('REASONING_EFFORT', env));
  if (explicit) return explicit;
  if (role === 'driver') return spec.defaultDriverEffort;
  if (role === 'chat' && spec.alwaysThinking) return 'high';
  return spec.defaultDriverEffort;
}

function modelLooksVisual(model: string): boolean {
  return /vision|kimi-k3|glm-5\.3-flash|gpt-4o|gpt-4\.1|claude|computer-use/i.test(model);
}

function pickActuator(spec: ProviderSpec, env: EnvMap): BrowserActuator {
  const mode = parseBrowserMode(productEnv('BROWSER_MODE', env) || 'auto');
  if (mode === 'dom' && spec.openaiCompat) return 'dom';
  if (mode === 'vision' && spec.openaiCompat) return 'vision';
  return spec.defaultActuator;
}

function resolveBase(spec: ProviderSpec, env: EnvMap): string | undefined {
  return envValue(env, spec.baseUrlEnv) || spec.defaultBaseUrl;
}

function endpointFor(
  role: LlmRole,
  provider: ProviderId,
  env: EnvMap,
  modelOverride?: string,
): ResolvedEndpoint {
  const spec = PROVIDERS[provider];
  const model = (modelOverride || '').trim() || spec.defaultModel;
  const extras = completionExtras(spec, resolveEffort(role, spec, env));
  const compat: CompatChatOptions = {
    extras,
    preserveAssistantMessage: spec.preserveReasoning,
    omitSampling: spec.alwaysThinking,
  };
  return {
    role,
    provider,
    spec,
    apiKey: firstApiKey(spec, env),
    baseUrl: resolveBase(spec, env),
    model,
    extras,
    actuator: pickActuator(spec, env),
    compat,
  };
}

export function resolveEndpoint(role: LlmRole = 'chat', env: EnvMap = process.env): ResolvedEndpoint {
  if (role === 'vision') return resolveVisionEndpoint(env);
  if (role === 'driver') {
    const provider = normalizeProviderId(env.DRIVER_PROVIDER || env.LLM_PROVIDER || 'deepseek');
    const spec = PROVIDERS[provider];
    const model = env.DRIVER_MODEL
      || (env.DRIVER_PROVIDER ? spec.defaultModel : (env.LLM_MODEL || spec.defaultModel));
    return endpointFor('driver', provider, env, model);
  }

  const provider = normalizeProviderId(env.LLM_PROVIDER || 'deepseek');
  const spec = PROVIDERS[provider];
  const model = env.LLM_MODEL || spec.defaultModel;
  return endpointFor('chat', provider, env, model);
}

function resolveVisionEndpoint(env: EnvMap): ResolvedEndpoint {
  if (env.VISION_PROVIDER || env.VISION_MODEL) {
    const provider = normalizeProviderId(env.VISION_PROVIDER || env.DRIVER_PROVIDER || env.LLM_PROVIDER || 'deepseek');
    const spec = PROVIDERS[provider];
    const model = env.VISION_MODEL || spec.visionModel || spec.defaultModel;
    return endpointFor('vision', provider, env, model);
  }

  const driver = resolveEndpoint('driver', env);
  if (driver.spec.vision || modelLooksVisual(driver.model)) {
    return { ...driver, role: 'vision' };
  }
  if (driver.provider === 'deepseek' && driver.apiKey && driver.spec.visionModel) {
    return endpointFor('vision', 'deepseek', env, driver.spec.visionModel);
  }

  for (const candidate of ['kimi', 'glm'] as ProviderId[]) {
    const spec = PROVIDERS[candidate];
    if (firstApiKey(spec, env)) return endpointFor('vision', candidate, env, spec.defaultModel);
  }

  if (driver.apiKey && driver.spec.visionModel) {
    return endpointFor('vision', driver.provider, env, driver.spec.visionModel);
  }
  return { ...driver, role: 'vision' };
}

export function openaiClient(endpoint: ResolvedEndpoint): OpenAI {
  return new OpenAI({ apiKey: endpoint.apiKey, baseURL: endpoint.baseUrl });
}

export function mergeChatParams(
  endpoint: Pick<ResolvedEndpoint, 'model' | 'extras' | 'spec' | 'compat'>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...params,
    model: params.model ?? endpoint.model,
    ...endpoint.extras,
  };
  if (endpoint.compat.omitSampling || endpoint.spec.alwaysThinking) {
    delete merged.temperature;
    delete merged.top_p;
    delete merged.presence_penalty;
    delete merged.frequency_penalty;
    delete merged.n;
  }
  return merged;
}

export function cloneAssistantMessage<T>(msg: T): T {
  return JSON.parse(JSON.stringify(msg)) as T;
}

export function missingKeyHint(endpoint: ResolvedEndpoint): string {
  return `${endpoint.spec.label} 未配置 API Key（${endpoint.spec.apiKeyEnv.join(' / ')}）`;
}
