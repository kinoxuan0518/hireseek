/**
 * Chat 模式的第一方浏览器会话
 *
 * 让对话中的 DeepSeek 直接用 browser_* 工具操控浏览器（一次调用 = 一个动作），
 * 替代"写 AppleScript 文件 → osascript"的低效路径。
 *
 * 连接优先级（macOS 上无需任何配置即可接管真实 Chrome）：
 *   1. CDP（调试端口恰好开着时最快）
 *   2. AppleScript 直接接管用户正在用的真实 Chrome —— 无需调试端口、无需重启，
 *      登录态/Cookie/浏览器指纹原生继承，风控风险最低（macOS 主路）
 *   3. 回退：Playwright 自有浏览器（browser-runner，带 storage state）
 *
 * 风控与 DOM Runner 同源：打招呼节流 / 每日上限硬终止 / 频率退避。
 */

import { chromium, Browser, Page } from 'playwright';
import {
  takeDomSnapshot,
  executeDomAction,
  GREETING_PATTERN,
  GREETING_MIN_INTERVAL_MS,
  DAILY_LIMIT_PATTERN,
  FREQUENCY_PATTERN,
} from './runners/dom-runner';
import type { BrowserAction, RiskGuard } from './runners/dom-runner';
import type { ChromeTab } from './chrome-applescript';

const CDP_URL = process.env.HIRESEEK_CDP_URL || 'http://127.0.0.1:9222';

interface ChatBrowserState {
  cdpBrowser: Browser | null;
  page: Page | null;
  /** AppleScript 模式选中的标签页 */
  asTab: ChromeTab | null;
  /** 连接方式，用于状态汇报 */
  mode: 'cdp' | 'applescript' | 'playwright' | null;
  guard: RiskGuard;
  /** 检测到每日上限后锁死打招呼 */
  dailyLimitHit: boolean;
}

const state: ChatBrowserState = {
  cdpBrowser: null,
  page: null,
  asTab: null,
  mode: null,
  guard: { lastGreetingAt: 0 },
  dailyLimitHit: false,
};

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** 尝试 CDP 接管用户 Chrome */
async function tryConnectCDP(): Promise<Browser | null> {
  try {
    return await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
  } catch {
    return null;
  }
}

/** 列出可用标签页 */
export async function listTabs(): Promise<Array<{ index: number; title: string; url: string }>> {
  if (!state.cdpBrowser) {
    state.cdpBrowser = await tryConnectCDP();
  }
  if (!state.cdpBrowser) return [];

  const pages = state.cdpBrowser.contexts().flatMap(c => c.pages());
  const tabs: Array<{ index: number; title: string; url: string }> = [];
  for (let i = 0; i < pages.length; i++) {
    tabs.push({
      index: i,
      title: await pages[i].title().catch(() => '(无标题)'),
      url: pages[i].url(),
    });
  }
  return tabs;
}

/**
 * 连接浏览器并选定操作页。
 * urlHint：按 URL/标题关键词选 tab（如 "zhipin" / "maimai"），不传则选当前激活页。
 */
export async function connectBrowser(urlHint?: string): Promise<string> {
  // 1. CDP 接管用户 Chrome
  state.cdpBrowser = state.cdpBrowser ?? await tryConnectCDP();

  if (state.cdpBrowser) {
    const pages = state.cdpBrowser.contexts().flatMap(c => c.pages());
    if (pages.length > 0) {
      let target = pages[pages.length - 1];
      if (urlHint) {
        const hint = urlHint.toLowerCase();
        const matched = await Promise.all(pages.map(async p => ({
          page: p,
          hit: p.url().toLowerCase().includes(hint) ||
            (await p.title().catch(() => '')).toLowerCase().includes(hint),
        })));
        const found = matched.find(m => m.hit);
        if (found) target = found.page;
      }
      state.page = target;
      state.mode = 'cdp';
      await target.bringToFront().catch(() => {});
      return `已接管你的 Chrome（${pages.length} 个标签页），当前操作页：${await target.title().catch(() => '')} | ${target.url()}`;
    }
  }

  // 2. AppleScript 直接接管真实 Chrome（macOS 主路：无需端口、无需重启）
  if (process.platform === 'darwin') {
    try {
      const as = await import('./chrome-applescript');
      if (as.chromeRunning()) {
        const tabs = as.listChromeTabs();
        if (tabs.length > 0) {
          let target = tabs[0];
          if (urlHint) {
            const hint = urlHint.toLowerCase();
            const found = tabs.find(t =>
              t.url.toLowerCase().includes(hint) || t.title.toLowerCase().includes(hint));
            if (found) target = found;
          }

          const permissionIssue = as.probeJsPermission(target);
          if (permissionIssue === null) {
            state.asTab = target;
            state.mode = 'applescript';
            as.activateTab(target);
            return `✓ 已直接接管你正在用的 Chrome（AppleScript，无需调试端口，登录态原生继承）。` +
              `共 ${tabs.length} 个标签页，当前操作页：${target.title} | ${target.url}`;
          }
          // 权限未开：明确指引，不静默掉到自有浏览器（那会丢登录态）
          return `检测到你的 Chrome 正在运行，但无法注入操作。${permissionIssue}`;
        }
      }
    } catch { /* AppleScript 不可用则继续向下回退 */ }
  }

  // 3. 回退 Playwright 自有浏览器
  const { getPage } = await import('./browser-runner');
  state.page = await getPage();
  state.mode = 'playwright';
  return `未检测到正在运行的 Chrome，已启动 HireSeek 自有浏览器（无你的登录态）。` +
    `建议先打开你的 Chrome 并登录 BOSS/脉脉，再让我重新连接。`;
}

async function ensurePage(): Promise<Page> {
  if (state.page && !state.page.isClosed()) return state.page;
  await connectBrowser();
  if (!state.page) throw new Error('浏览器连接失败');
  return state.page;
}

/** 获取当前页面快照（含风控检测） */
export async function snapshot(): Promise<string> {
  if (state.mode === 'applescript' && state.asTab) {
    const as = await import('./chrome-applescript');
    return applyRiskChecks(as.takeSnapshot(state.asTab));
  }
  const page = await ensurePage();
  const snap = await takeDomSnapshot(page);
  return applyRiskChecks(snap);
}

/** AppleScript 模式下执行动作（风控节流与 DOM Runner 同源） */
async function actViaAppleScript(input: BrowserAction): Promise<string> {
  const as = await import('./chrome-applescript');
  const tab = state.asTab!;

  switch (input.action) {
    case 'snapshot':
      break;
    case 'click': {
      if (input.ref == null) throw new Error('click 需要 ref 参数');
      const text = as.refText(tab, input.ref);
      if (GREETING_PATTERN.test(text)) {
        if (state.dailyLimitHit) {
          return '⛔ 今日打招呼权益已达上限（已锁定）。不要再尝试打招呼，请直接进入收尾总结。';
        }
        // 打招呼强制最小间隔（代码层节流）
        const elapsed = Date.now() - state.guard.lastGreetingAt;
        if (elapsed < GREETING_MIN_INTERVAL_MS) await sleep(GREETING_MIN_INTERVAL_MS - elapsed);
        state.guard.lastGreetingAt = Date.now();
      }
      as.clickRef(tab, input.ref);
      break;
    }
    case 'type':
      if (input.ref == null) throw new Error('type 需要 ref 参数');
      as.typeRef(tab, input.ref, input.text ?? '');
      break;
    case 'press':
      as.pressKey(tab, input.text || 'Enter');
      break;
    case 'scroll':
      as.scrollPage(tab, (input.amount ?? 600) * (input.direction === 'up' ? -1 : 1));
      break;
    case 'goto':
      if (!input.url) throw new Error('goto 需要 url 参数');
      as.gotoUrl(tab, input.url);
      await sleep(2500);
      break;
    case 'back':
      as.goBack(tab);
      await sleep(1500);
      break;
    case 'wait':
      await sleep(Math.min(input.amount ?? 1500, 10000));
      break;
  }

  if (input.action !== 'snapshot' && input.action !== 'wait') await sleep(800);
  return applyRiskChecks(as.takeSnapshot(tab));
}

/** 执行单个浏览器动作，返回执行后快照 */
export async function act(input: BrowserAction): Promise<string> {
  if (state.mode === 'applescript' && state.asTab) {
    try {
      return await actViaAppleScript(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const as = await import('./chrome-applescript');
      const snap = (() => { try { return as.takeSnapshot(state.asTab!); } catch { return '[快照获取失败]'; } })();
      return `[动作执行失败] ${message}\n请根据下方快照调整策略（不要重复同一动作超过 2 次）。\n\n${applyRiskChecks(snap)}`;
    }
  }

  const page = await ensurePage();

  // 每日上限锁：拒绝继续点打招呼类按钮
  if (state.dailyLimitHit && input.action === 'click' && input.ref != null) {
    const text = await page
      .locator(`[data-hs-ref="${input.ref}"]`).first()
      .textContent({ timeout: 3000 }).catch(() => '');
    if (text && GREETING_PATTERN.test(text)) {
      return '⛔ 今日打招呼权益已达上限（已锁定）。不要再尝试打招呼，请直接进入收尾总结。';
    }
  }

  try {
    await executeDomAction(page, input, state.guard);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const snap = await takeDomSnapshot(page).catch(() => '[快照获取失败]');
    return `[动作执行失败] ${message}\n请根据下方快照调整策略（不要重复同一动作超过 2 次）。\n\n${applyRiskChecks(snap)}`;
  }

  const snap = await takeDomSnapshot(page);
  return applyRiskChecks(snap);
}

/** 风控检测：上限硬终止 / 频率软退避提示 */
function applyRiskChecks(snap: string): string {
  if (DAILY_LIMIT_PATTERN.test(snap)) {
    state.dailyLimitHit = true;
    return `⛔【风控硬终止】页面出现每日沟通上限提示。打招呼功能已锁定，立即停止触达，进入收尾总结。\n\n${snap}`;
  }
  if (FREQUENCY_PATTERN.test(snap)) {
    return `⚠️【风控提示】页面出现频率告警。接下来 30 秒内不要执行点击，先 wait 再继续。\n\n${snap}`;
  }
  return snap;
}

/** 当前浏览器状态（供 /status 与模型自检） */
export function browserStatus(): string {
  if (!state.page && !state.asTab) return '未连接';
  const labels: Record<string, string> = {
    cdp: '已接管你的 Chrome（CDP）',
    applescript: '已接管你的 Chrome（AppleScript 直连）',
    playwright: 'HireSeek 自有浏览器',
  };
  const modeLabel = labels[state.mode ?? ''] ?? '未连接';
  return `${modeLabel}${state.dailyLimitHit ? '（今日打招呼已锁定）' : ''}`;
}
