import type { Page } from 'playwright';

export interface BrowserAction {
  action: 'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'goto' | 'back' | 'wait';
  ref?: number;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
}

export interface RiskGuard {
  lastGreetingAt: number;
}

export interface DomBrowserSession {
  kind: 'chrome-cdp' | 'chrome-applescript';
  label: string;
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  bodyText(): Promise<string>;
  snapshot(): Promise<string>;
  act(input: BrowserAction, guard: RiskGuard): Promise<string>;
}

export type BrowserTarget = Page | DomBrowserSession;

export function isDomBrowserSession(target: BrowserTarget): target is DomBrowserSession {
  return typeof (target as DomBrowserSession).snapshot === 'function' &&
    typeof (target as DomBrowserSession).act === 'function' &&
    typeof (target as DomBrowserSession).goto === 'function';
}
