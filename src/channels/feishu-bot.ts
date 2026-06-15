/**
 * 飞书双向 Bot —— 对话即指挥 HireSeek
 *
 * 用长连接（WebSocket）事件订阅接收飞书消息，无需公网回调地址、无需内网穿透：
 *
 *   飞书用户发消息 → 长连接推 im.message.receive_v1 事件 → 复用 chat.ts 的
 *   CHAT_TOOLS / executeTool 跑无头 agent 循环 → 回复经 IM 接口发回飞书
 *
 * 这样 HR 不必守在电脑前的终端——在手机飞书上一句"今天 BOSS 进展怎么样"、
 * "把做供应链的候选人列出来"、"派个后台任务调研一下熊文韬"，HireSeek 就在
 * 常驻守护进程里执行并回话。心跳/后台任务/调度的主动通知也优先经此 Bot 推送。
 *
 * 需要：FEISHU_APP_ID / FEISHU_APP_SECRET（自建应用，开启"长连接"事件订阅，
 * 订阅 im.message.receive_v1，授予 im:message、im:message:send_as_bot 权限），
 * 并设置 FEISHU_BOT_ENABLED=true。
 */

import * as lark from '@larksuiteoapi/node-sdk';
import OpenAI from 'openai';
import { config } from '../config';
import { setHeadless } from '../permissions';
import { buildSystemPrompt, CHAT_TOOLS, executeTool } from '../chat';

// ── LLM 客户端解析（与 chat 主循环同源，DeepSeek 优先）─────────────────
function resolveLLM(): { client: OpenAI; model: string } {
  const usingDeepseek =
    Boolean(process.env.DEEPSEEK_API_KEY || config.deepseek.apiKey) &&
    !process.env.CUSTOM_API_KEY;

  const apiKey =
    process.env.DEEPSEEK_API_KEY ||
    process.env.CUSTOM_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    config.deepseek.apiKey ||
    config.custom.apiKey ||
    config.anthropic.apiKey;

  const baseURL = usingDeepseek
    ? config.deepseek.baseUrl
    : process.env.CUSTOM_BASE_URL ||
      process.env.ANTHROPIC_BASE_URL ||
      config.custom.baseUrl ||
      config.anthropic.baseUrl ||
      undefined;

  const model = process.env.LLM_MODEL || config.llm.model;
  return { client: new OpenAI({ apiKey, baseURL }), model };
}

// ── 每个飞书会话维护独立的对话历史 ─────────────────────────────────────
const MAX_HISTORY = 24;       // 系统提示之外保留的最近消息条数
const MAX_ROUNDS = 30;        // 单次回复内最多 tool-call 轮数

interface Session {
  messages: OpenAI.ChatCompletionMessageParam[];
  busy: boolean;
}
const sessions = new Map<string, Session>();

function getSession(chatId: string): Session {
  let s = sessions.get(chatId);
  if (!s) {
    s = {
      messages: [{ role: 'system', content: buildSystemPrompt() }],
      busy: false,
    };
    sessions.set(chatId, s);
  }
  return s;
}

function pruneHistory(s: Session): void {
  if (s.messages.length <= MAX_HISTORY + 1) return;
  const system = s.messages[0];
  const recent = s.messages.slice(-MAX_HISTORY);
  s.messages = [system, { role: 'user', content: '[较早的对话已折叠]' }, ...recent];
}

// ── IM 发送 ───────────────────────────────────────────────────────────
let imClient: lark.Client | null = null;

function getImClient(): lark.Client {
  if (!imClient) {
    imClient = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
    });
  }
  return imClient;
}

async function sendText(chatId: string, text: string): Promise<void> {
  // 飞书单条文本上限约 30KB，做个保守截断
  const body = text.length > 4000 ? text.slice(0, 4000) + '\n…（内容过长已截断）' : text;
  try {
    await getImClient().im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: body }),
      },
    });
  } catch (err) {
    console.error('[飞书Bot] 发送失败:', err instanceof Error ? err.message : err);
  }
}

/** 供心跳 / 调度 / 后台任务主动推送（落到配置的通知 chat） */
export async function pushToBot(text: string): Promise<boolean> {
  const chatId = config.feishu.bot.notifyChatId;
  if (!chatId || !config.feishu.bot.enabled) return false;
  await sendText(chatId, text);
  return true;
}

// ── agent 回合：跑一轮含 tool-call 的对话，产出给用户的文字回复 ──────────
async function runAgentTurn(session: Session, userText: string): Promise<string> {
  const { client, model } = resolveLLM();
  const tools = CHAT_TOOLS;

  session.messages.push({ role: 'user', content: userText });
  pruneHistory(session);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.chat.completions.create({
      model,
      messages: session.messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4096,
    });

    const msg = res.choices[0].message;
    session.messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? '（没有可回复的内容）';
    }

    for (const call of msg.tool_calls) {
      let output: string;
      try {
        output = await executeTool(call.function.name, JSON.parse(call.function.arguments || '{}'));
      } catch (err) {
        output = `工具执行失败：${err instanceof Error ? err.message : err}`;
      }
      session.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }

  return `这件事调用了很多步还没收尾（已达 ${MAX_ROUNDS} 轮上限），我先停一下。要不要把任务拆细一点再让我继续？`;
}

// ── 消息事件去重（飞书可能重投同一事件）─────────────────────────────────
const seenEvents = new Set<string>();
function isDuplicate(eventId: string): boolean {
  if (!eventId) return false;
  if (seenEvents.has(eventId)) return true;
  seenEvents.add(eventId);
  if (seenEvents.size > 500) {
    // 简单 LRU：清掉最早一半
    const arr = Array.from(seenEvents).slice(0, 250);
    arr.forEach(id => seenEvents.delete(id));
  }
  return false;
}

function extractText(messageContent: string, msgType: string): string {
  try {
    const parsed = JSON.parse(messageContent);
    if (msgType === 'text') return (parsed.text || '').replace(/@_user_\d+/g, '').trim();
    if (msgType === 'post') {
      // 富文本：拼接所有 text 段
      const blocks = parsed?.content?.flat?.() ?? [];
      return blocks.map((b: any) => b?.text ?? '').join('').trim();
    }
  } catch { /* 非 JSON 内容忽略 */ }
  return '';
}

// ── 启动长连接 Bot ─────────────────────────────────────────────────────
let started = false;

export async function startFeishuBot(): Promise<void> {
  if (started) return;
  const { appId, appSecret } = config.feishu;
  if (!appId || !appSecret) {
    console.log('[飞书Bot] 缺少 FEISHU_APP_ID / FEISHU_APP_SECRET，Bot 未启动');
    return;
  }

  // Bot 在无头环境运行，危险工具默认拒绝
  setHeadless(true);

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: any) => {
      const eventId = data?.event_id || data?.message?.message_id || '';
      if (isDuplicate(eventId)) return;

      const message = data.message;
      const chatId: string = message?.chat_id;
      const senderId: string = data?.sender?.sender_id?.open_id || '';
      const chatType: string = message?.chat_type; // p2p | group

      // 群聊里只在被 @ 时响应；单聊全部响应
      if (chatType === 'group') {
        const mentions = message?.mentions || [];
        const atMe = mentions.some((m: any) => m?.key && message.content?.includes(m.key));
        if (!atMe && mentions.length > 0) return;
      }

      // 用户白名单
      const allow = config.feishu.bot.allowUsers;
      if (allow.length > 0 && senderId && !allow.includes(senderId)) {
        await sendText(chatId, '抱歉，你没有使用此 HireSeek Bot 的权限。');
        return;
      }

      const userText = extractText(message?.content || '', message?.message_type || 'text');
      if (!userText) return;

      const session = getSession(chatId);

      // 内置快捷指令
      if (userText === '/clear' || userText === '清空') {
        sessions.delete(chatId);
        await sendText(chatId, '已清空当前会话上下文，我们重新开始。');
        return;
      }
      if (userText === '/help' || userText === '帮助') {
        await sendText(chatId,
          'HireSeek 在线。直接说人话指挥我：\n' +
          '· "今天 BOSS / 脉脉进展怎么样"\n' +
          '· "把做供应链的候选人列出来"\n' +
          '· "派个后台任务调研一下张三"\n' +
          '· "现在跑一轮 BOSS 寻源"\n' +
          '发「清空」可重置上下文。');
        return;
      }

      if (session.busy) {
        await sendText(chatId, '我还在处理上一条，稍等我回复你～');
        return;
      }

      session.busy = true;
      try {
        const reply = await runAgentTurn(session, userText);
        await sendText(chatId, reply);
      } catch (err) {
        await sendText(chatId, `处理时出错了：${err instanceof Error ? err.message : err}`);
      } finally {
        session.busy = false;
      }
    },
  });

  const wsClient = new lark.WSClient({ appId, appSecret });
  await wsClient.start({ eventDispatcher });
  started = true;
  console.log('[飞书Bot] 长连接已建立，开始监听消息事件');
}
