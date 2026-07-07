import type { Channel } from './types';

export type BrowserReadinessStatus = 'ready' | 'not_ready' | 'unavailable';

export interface BrowserReadinessInput {
  channel: Channel;
  url?: string;
  title?: string;
  bodyText?: string;
  jsPermissionIssue?: string | null;
  chromeRunning?: boolean;
  tabFound?: boolean;
}

export interface BrowserReadinessReport {
  channel: Channel;
  status: BrowserReadinessStatus;
  url?: string;
  title?: string;
  issues: string[];
  nextSteps: string[];
}

export interface BrowserReadinessSummary {
  reports: BrowserReadinessReport[];
  ready: number;
  notReady: number;
  unavailable: number;
  ok: boolean;
}

interface TabLike {
  title: string;
  url: string;
}

const CHANNEL_HINT: Partial<Record<Channel, string>> = {
  boss: 'zhipin',
  maimai: 'maimai',
  linkedin: 'linkedin',
  followup: 'zhipin',
};

const CHANNEL_LABEL: Record<Channel, string> = {
  boss: 'BOSS直聘',
  maimai: '脉脉',
  linkedin: 'LinkedIn',
  followup: '跟进未回复',
};

const CHANNEL_URL: Partial<Record<Channel, string>> = {
  boss: 'https://www.zhipin.com/web/chat/index',
  maimai: 'https://maimai.cn/ent/v41/recruit/talents?tab=1',
  linkedin: 'https://www.linkedin.com/talent/hire',
  followup: 'https://www.zhipin.com/web/chat/index',
};

const LOGIN_OR_MISSING_PATTERNS: Partial<Record<Channel, RegExp>> = {
  boss: /访问的资源不存在|登录\/注册|扫码登录|密码登录|请登录|我要招聘/,
  maimai: /扫码登录|验证码登录|手机登录|请输入手机号|获取验证码|密码登录/,
  linkedin: /Sign in|Join LinkedIn|登录/,
};

export function tabMatchesChannel(tab: TabLike, channel: Channel): boolean {
  const hint = CHANNEL_HINT[channel]?.toLowerCase();
  if (!hint) return false;
  return tab.url.toLowerCase().includes(hint) || tab.title.toLowerCase().includes(hint);
}

export function selectTabForChannel<T extends TabLike>(tabs: T[], channel: Channel): T | null {
  return tabs.find(tab => tabMatchesChannel(tab, channel)) ?? null;
}

export function assessBrowserReadiness(input: BrowserReadinessInput): BrowserReadinessReport {
  const issues: string[] = [];
  const nextSteps: string[] = [];
  const label = CHANNEL_LABEL[input.channel];
  const targetUrl = CHANNEL_URL[input.channel];

  if (input.chromeRunning === false) {
    return {
      channel: input.channel,
      status: 'unavailable',
      issues: ['Google Chrome 未运行'],
      nextSteps: ['先打开已登录招聘平台的 Chrome。'],
    };
  }

  if (input.tabFound === false) {
    return {
      channel: input.channel,
      status: 'not_ready',
      issues: [`未找到 ${label} 标签页`],
      nextSteps: targetUrl
        ? [`在 Chrome 打开 ${targetUrl} 并完成登录，再运行 readiness 预检。`]
        : [`在 Chrome 打开 ${label} 页面并完成登录，再运行 readiness 预检。`],
    };
  }

  if (input.jsPermissionIssue) {
    issues.push(input.jsPermissionIssue);
    nextSteps.push('开启 Chrome 菜单「视图 > 开发者 > 允许 Apple 事件中的 JavaScript」后重试。');
  }

  const body = input.bodyText ?? '';
  const pattern = LOGIN_OR_MISSING_PATTERNS[input.channel];
  if (pattern && pattern.test(body)) {
    issues.push(`${label} 页面看起来未登录或登录态不可用`);
    nextSteps.push(`在当前 Chrome 标签页完成 ${label} 登录后，再运行 readiness 预检。`);
  }

  if (!input.url || !tabMatchesChannel({ url: input.url, title: input.title ?? '' }, input.channel)) {
    issues.push(`当前标签页不像 ${label} 页面`);
    if (targetUrl) nextSteps.push(`切到 ${label} 页面，建议入口：${targetUrl}`);
  }

  if (issues.length === 0) {
    nextSteps.push(`可以继续运行：hireseek run ${input.channel} --here --dry-run`);
  }

  return {
    channel: input.channel,
    status: issues.length === 0 ? 'ready' : 'not_ready',
    url: input.url,
    title: input.title,
    issues,
    nextSteps,
  };
}

export async function probeBrowserReadiness(channel: Channel): Promise<BrowserReadinessReport> {
  if (process.platform !== 'darwin') {
    return {
      channel,
      status: 'unavailable',
      issues: ['真实 Chrome 预检目前只支持 macOS AppleScript'],
      nextSteps: ['在 macOS Chrome 中运行 readiness，或补充当前系统的浏览器连接器。'],
    };
  }

  const chrome = await import('./chrome-applescript');
  if (!chrome.chromeRunning()) {
    return assessBrowserReadiness({ channel, chromeRunning: false, tabFound: false });
  }

  let tabs: ReturnType<typeof chrome.listChromeTabs>;
  try {
    tabs = chrome.listChromeTabs();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      channel,
      status: 'unavailable',
      issues: [`无法读取 Chrome 标签页：${message.slice(0, 160)}`],
      nextSteps: ['确认 Chrome 正在运行，并允许 HireSeek 通过 AppleScript 读取标签页后重试。'],
    };
  }
  const tab = selectTabForChannel(tabs, channel);
  if (!tab) {
    return assessBrowserReadiness({ channel, chromeRunning: true, tabFound: false });
  }

  const jsPermissionIssue = chrome.probeJsPermission(tab);
  const state = chrome.tabState(tab);
  let bodyText = '';
  let bodyReadIssue = jsPermissionIssue;
  if (!jsPermissionIssue) {
    try {
      bodyText = chrome.execJS(tab, "(document.body ? document.body.innerText : '').slice(0, 8000)");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bodyReadIssue = `无法读取页面正文：${message.slice(0, 160)}`;
    }
  }

  return assessBrowserReadiness({
    channel,
    chromeRunning: true,
    tabFound: true,
    url: state.url,
    title: state.title,
    bodyText,
    jsPermissionIssue: bodyReadIssue,
  });
}

export async function probeBrowserReadinessMany(channels: Channel[]): Promise<BrowserReadinessSummary> {
  const reports: BrowserReadinessReport[] = [];
  for (const channel of channels) {
    reports.push(await probeBrowserReadiness(channel));
  }
  const ready = reports.filter(report => report.status === 'ready').length;
  const notReady = reports.filter(report => report.status === 'not_ready').length;
  const unavailable = reports.filter(report => report.status === 'unavailable').length;
  return {
    reports,
    ready,
    notReady,
    unavailable,
    ok: reports.length > 0 && reports.every(report => report.status === 'ready'),
  };
}

export function formatBrowserReadiness(report: BrowserReadinessReport): string {
  const statusLabel = report.status === 'ready' ? 'READY' : report.status === 'not_ready' ? 'NOT READY' : 'UNAVAILABLE';
  const lines = [
    `Browser readiness: ${statusLabel}`,
    `Channel: ${CHANNEL_LABEL[report.channel]}`,
  ];
  if (report.title) lines.push(`Title: ${report.title}`);
  if (report.url) lines.push(`URL: ${report.url}`);
  lines.push('');
  if (report.issues.length > 0) {
    lines.push('Issues:');
    lines.push(...report.issues.map(issue => `- ${issue}`));
    lines.push('');
  }
  lines.push('Next steps:');
  lines.push(...report.nextSteps.map(step => `- ${step}`));
  return lines.join('\n');
}

export function formatBrowserReadinessSummary(summary: BrowserReadinessSummary): string {
  const lines = [
    `Browser readiness summary: ${summary.ok ? 'READY' : 'NOT READY'}`,
    `Channels: ${summary.reports.length} total, ${summary.ready} ready, ${summary.notReady} not ready, ${summary.unavailable} unavailable`,
    '',
  ];
  for (const report of summary.reports) {
    const statusLabel = report.status === 'ready' ? 'READY' : report.status === 'not_ready' ? 'NOT READY' : 'UNAVAILABLE';
    const issue = report.issues[0] ? ` — ${report.issues[0]}` : '';
    lines.push(`- ${CHANNEL_LABEL[report.channel]}: ${statusLabel}${issue}`);
    if (report.url) lines.push(`  URL: ${report.url}`);
    const firstStep = report.nextSteps[0];
    if (firstStep) lines.push(`  Next: ${firstStep}`);
  }
  return lines.join('\n');
}
