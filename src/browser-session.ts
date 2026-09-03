import type { Page } from 'playwright';

export interface BrowserAction {
  action: 'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'goto' | 'back' | 'wait';
  ref?: number;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  /** 通读整份简历时置 true：放宽正文截断上限，代价是这一份快照更贵。 */
  full?: boolean;
  /** Optional protocol stage marker, e.g. boss stage manifest id. */
  stage_id?: string;
  stageId?: string;
}

export interface SnapshotOptions {
  /** true = 取完整正文（深读简历用），false/缺省 = 常规摘要长度 */
  full?: boolean;
}

export interface RiskGuard {
  lastGreetingAt: number;
}

export interface BrowserLiveState {
  url: string;
  title?: string;
  /** true = the controlled tab is currently selected in its Chrome window. */
  active?: boolean;
}

export interface DomBrowserSession {
  kind: 'chrome-cdp' | 'chrome-applescript';
  label: string;
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  bodyText(): Promise<string>;
  liveState?(): Promise<BrowserLiveState>;
  snapshot(opts?: SnapshotOptions): Promise<string>;
  act(input: BrowserAction, guard: RiskGuard): Promise<string>;
}

export type BrowserTarget = Page | DomBrowserSession;

export function isDomBrowserSession(target: BrowserTarget): target is DomBrowserSession {
  return typeof (target as DomBrowserSession).snapshot === 'function' &&
    typeof (target as DomBrowserSession).act === 'function' &&
    typeof (target as DomBrowserSession).goto === 'function';
}
