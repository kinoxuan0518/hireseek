import { chromium, Browser, Page } from 'playwright';
import type { BrowserAction, BrowserLiveState, DomBrowserSession, RiskGuard } from './browser-session';
import {
  executeDomAction,
  GREETING_MIN_INTERVAL_MS,
  GREETING_PATTERN,
  takeDomSnapshot,
} from './runners/dom-runner';
import { upsertExecutionEnvironment } from './agent-core/environment-store';

const CDP_URL = process.env.HIRESEEK_CDP_URL || 'http://127.0.0.1:9222';

let cdpBrowser: Browser | null = null;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function tryConnectCDP(): Promise<Browser | null> {
  try {
    if (!cdpBrowser || !cdpBrowser.isConnected()) {
      cdpBrowser = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
    }
    return cdpBrowser;
  } catch {
    return null;
  }
}

async function pageBodyText(page: Page): Promise<string> {
  return await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

function wrapPlaywrightPage(page: Page): DomBrowserSession {
  return {
    kind: 'chrome-cdp',
    label: '真实 Chrome（CDP）',
    async goto(url: string) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    },
    async url() {
      return page.url();
    },
    async bodyText() {
      return await pageBodyText(page);
    },
    async liveState(): Promise<BrowserLiveState> {
      return {
        url: page.url(),
        title: await page.title().catch(() => ''),
        active: true,
      };
    },
    async snapshot() {
      return await takeDomSnapshot(page);
    },
    async act(input: BrowserAction, guard: RiskGuard) {
      await executeDomAction(page, input, guard);
      return await takeDomSnapshot(page);
    },
  };
}

async function connectViaCDP(urlHint?: string): Promise<DomBrowserSession | null> {
  const browser = await tryConnectCDP();
  if (!browser) return null;

  const pages = browser.contexts().flatMap(c => c.pages()).filter(p => !p.isClosed());
  if (pages.length === 0) return null;

  let target = pages[pages.length - 1];
  if (urlHint) {
    const hint = urlHint.toLowerCase();
    const candidates = await Promise.all(pages.map(async page => ({
      page,
      hit: page.url().toLowerCase().includes(hint) ||
        (await page.title().catch(() => '')).toLowerCase().includes(hint),
    })));
    target = candidates.find(c => c.hit)?.page ?? target;
  }

  await target.bringToFront().catch(() => {});
  return wrapPlaywrightPage(target);
}

function appleScriptHint(channelHint?: string): string | undefined {
  if (channelHint === 'boss') return 'zhipin';
  if (channelHint === 'maimai') return 'maimai';
  if (channelHint === 'linkedin') return 'linkedin';
  return channelHint;
}

async function connectViaAppleScript(urlHint?: string): Promise<DomBrowserSession> {
  if (process.platform !== 'darwin') {
    throw new Error('真实 Chrome 直连目前只支持 macOS AppleScript 或已开启 CDP 的 Chrome。');
  }

  const chrome = await import('./chrome-applescript');
  if (!chrome.chromeRunning()) {
    throw new Error('没有检测到正在运行的 Google Chrome。请先打开你已登录 BOSS 的 Chrome 窗口。');
  }

  const tabs = chrome.listChromeTabs();
  if (tabs.length === 0) {
    throw new Error('Chrome 没有可接管的标签页。请先打开一个 BOSS/普通网页标签页。');
  }

  let tab = tabs[0];
  if (urlHint) {
    const hint = urlHint.toLowerCase();
    tab = tabs.find(t =>
      t.url.toLowerCase().includes(hint) || t.title.toLowerCase().includes(hint)
    ) ?? tab;
  }

  const permissionIssue = chrome.probeJsPermission(tab);
  if (permissionIssue) {
    throw new Error(permissionIssue);
  }

  chrome.activateTab(tab);

  return {
    kind: 'chrome-applescript',
    label: '真实 Chrome（AppleScript）',
    async goto(url: string) {
      chrome.gotoUrl(tab, url);
      await sleep(2500);
    },
    async url() {
      return chrome.execJS(tab, 'location.href');
    },
    async bodyText() {
      return chrome.execJS(tab, "(document.body ? document.body.innerText : '').slice(0, 8000)");
    },
    async liveState() {
      const state = chrome.tabState(tab);
      return {
        url: state.url,
        title: state.title,
        active: state.active,
      };
    },
    async snapshot() {
      return chrome.takeSnapshot(tab);
    },
    async act(input: BrowserAction, guard: RiskGuard) {
      switch (input.action) {
        case 'snapshot':
          break;
        case 'click': {
          if (input.ref == null) throw new Error('click 需要 ref 参数');
          const text = chrome.refText(tab, input.ref);
          if (GREETING_PATTERN.test(text)) {
            const elapsed = Date.now() - guard.lastGreetingAt;
            if (elapsed < GREETING_MIN_INTERVAL_MS) await sleep(GREETING_MIN_INTERVAL_MS - elapsed);
            guard.lastGreetingAt = Date.now();
          }
          chrome.clickRef(tab, input.ref);
          break;
        }
        case 'type':
          if (input.ref == null) throw new Error('type 需要 ref 参数');
          chrome.typeRef(tab, input.ref, input.text ?? '');
          break;
        case 'press':
          chrome.pressKey(tab, input.text || 'Enter');
          break;
        case 'scroll':
          chrome.scrollPage(tab, (input.amount ?? 600) * (input.direction === 'up' ? -1 : 1));
          break;
        case 'goto':
          if (!input.url) throw new Error('goto 需要 url 参数');
          chrome.gotoUrl(tab, input.url);
          await sleep(2500);
          break;
        case 'back':
          chrome.goBack(tab);
          await sleep(1500);
          break;
        case 'wait':
          await sleep(Math.min(input.amount ?? 1500, 10000));
          break;
        default:
          throw new Error(`未知动作: ${(input as { action: string }).action}`);
      }

      if (input.action !== 'snapshot' && input.action !== 'wait') await sleep(800);
      return chrome.takeSnapshot(tab);
    },
  };
}

async function recordConnectedEnvironment(session: DomBrowserSession): Promise<void> {
  try {
    const live = await session.liveState?.();
    upsertExecutionEnvironment({
      id: `browser:${session.kind}`,
      kind: 'browser',
      label: session.label,
      controller: 'hireseek',
      status: 'claimed',
      mode: 'execute',
      url: live?.url,
      title: live?.title,
      active: live?.active,
    });
  } catch {
    // 环境状态是观测层，失败不能阻断浏览器接管。
  }
}

function recordConnectionError(reason: string): void {
  try {
    upsertExecutionEnvironment({
      id: 'browser:real-chrome',
      kind: 'browser',
      label: '真实 Chrome',
      controller: 'unknown',
      status: 'error',
      mode: 'read',
      reason,
    });
  } catch {
    // 环境状态是观测层，失败不能覆盖真实错误。
  }
}

export async function connectRealChrome(channelHint?: string): Promise<DomBrowserSession> {
  try {
    const hint = appleScriptHint(channelHint);
    const cdp = await connectViaCDP(hint);
    if (cdp) {
      await recordConnectedEnvironment(cdp);
      console.log(`[Browser] 已接管${cdp.label}`);
      return cdp;
    }

    const session = await connectViaAppleScript(hint);
    await recordConnectedEnvironment(session);
    console.log(`[Browser] 已接管${session.label}`);
    return session;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordConnectionError(reason);
    throw err;
  }
}
