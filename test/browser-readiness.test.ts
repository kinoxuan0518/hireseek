import { describe, expect, it } from 'vitest';
import {
  assessBrowserReadiness,
  browserOpenTargetsForReadiness,
  formatBrowserReadiness,
  formatBrowserReadinessSummary,
  formatOpenMissingBrowserChannels,
  selectTabForChannel,
  tabMatchesChannel,
} from '../src/browser-readiness';

describe('browser readiness preflight', () => {
  it('selects the current platform tab without mutating browser state', () => {
    const tabs = [
      { title: 'Inbox', url: 'https://mail.example.com' },
      { title: '脉脉企业版 - 人才推荐', url: 'https://maimai.cn/ent/v41/recruit/talents?tab=1' },
    ];

    expect(tabMatchesChannel(tabs[1], 'maimai')).toBe(true);
    expect(selectTabForChannel(tabs, 'maimai')).toEqual(tabs[1]);
    expect(selectTabForChannel(tabs, 'boss')).toBeNull();
  });

  it('reports ready when the selected platform page is available and logged in', () => {
    const report = assessBrowserReadiness({
      channel: 'maimai',
      chromeRunning: true,
      tabFound: true,
      title: '脉脉企业版 - 人才推荐',
      url: 'https://maimai.cn/ent/v41/recruit/talents?tab=1',
      bodyText: '人才推荐 候选人 搜索 招呼',
    });

    expect(report.status).toBe('ready');
    expect(report.issues).toEqual([]);
    expect(report.nextSteps).toContain('可以继续运行：hireseek run maimai --here --dry-run');
  });

  it('reports not ready when the channel tab is missing', () => {
    const report = assessBrowserReadiness({
      channel: 'boss',
      chromeRunning: true,
      tabFound: false,
    });

    expect(report.status).toBe('not_ready');
    expect(report.issues).toEqual(['未找到 BOSS直聘 标签页']);
    expect(report.nextSteps[0]).toContain('https://www.zhipin.com/web/chat/index');
  });

  it('reports not ready when AppleScript cannot inspect the page', () => {
    const report = assessBrowserReadiness({
      channel: 'boss',
      chromeRunning: true,
      tabFound: true,
      title: '推荐牛人',
      url: 'https://www.zhipin.com/web/chat/index',
      jsPermissionIssue: 'Chrome 未允许 Apple 事件中的 JavaScript',
    });

    expect(report.status).toBe('not_ready');
    expect(report.issues).toContain('Chrome 未允许 Apple 事件中的 JavaScript');
    expect(report.nextSteps.join('\n')).toContain('允许 Apple 事件中的 JavaScript');
  });

  it('reports login or missing-resource pages as not ready', () => {
    const report = assessBrowserReadiness({
      channel: 'boss',
      chromeRunning: true,
      tabFound: true,
      title: 'BOSS直聘',
      url: 'https://www.zhipin.com/web/chat/index',
      bodyText: '访问的资源不存在 登录/注册 扫码登录',
    });

    expect(report.status).toBe('not_ready');
    expect(report.issues).toEqual(['BOSS直聘 页面看起来未登录或登录态不可用']);
  });

  it('formats the report for CLI display', () => {
    const output = formatBrowserReadiness({
      channel: 'linkedin',
      status: 'unavailable',
      issues: ['Google Chrome 未运行'],
      nextSteps: ['先打开已登录招聘平台的 Chrome。'],
    });

    expect(output).toContain('Browser readiness: UNAVAILABLE');
    expect(output).toContain('Channel: LinkedIn');
    expect(output).toContain('- Google Chrome 未运行');
  });

  it('formats a multi-channel readiness summary', () => {
    const output = formatBrowserReadinessSummary({
      ready: 1,
      notReady: 1,
      unavailable: 0,
      ok: false,
      reports: [
        {
          channel: 'boss',
          status: 'ready',
          url: 'https://www.zhipin.com/web/chat/index',
          issues: [],
          nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
        },
        {
          channel: 'maimai',
          status: 'not_ready',
          issues: ['未找到 脉脉 标签页'],
          nextSteps: ['在 Chrome 打开脉脉页面。'],
        },
      ],
    });

    expect(output).toContain('Browser readiness summary: NOT READY');
    expect(output).toContain('2 total, 1 ready, 1 not ready, 0 unavailable');
    expect(output).toContain('- BOSS直聘: READY');
    expect(output).toContain('- 脉脉: NOT READY — 未找到 脉脉 标签页');
  });

  it('plans opening only missing channel entry pages', () => {
    const targets = browserOpenTargetsForReadiness({
      ready: 1,
      notReady: 1,
      unavailable: 0,
      ok: false,
      reports: [
        {
          channel: 'boss',
          status: 'ready',
          url: 'https://www.zhipin.com/web/chat/index',
          issues: [],
          nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
        },
        {
          channel: 'maimai',
          status: 'not_ready',
          issues: ['未找到 脉脉 标签页'],
          nextSteps: ['在 Chrome 打开脉脉页面。'],
        },
      ],
    });

    expect(targets).toEqual([{
      channel: 'maimai',
      url: 'https://maimai.cn/ent/v41/recruit/talents?tab=1',
      reason: '未找到 脉脉 标签页',
    }]);
  });

  it('formats opened missing channel pages with login next steps', () => {
    const output = formatOpenMissingBrowserChannels({
      before: {
        ready: 1,
        notReady: 1,
        unavailable: 0,
        ok: false,
        reports: [
          {
            channel: 'boss',
            status: 'ready',
            url: 'https://www.zhipin.com/web/chat/index',
            issues: [],
            nextSteps: ['可以继续运行：hireseek run boss --here --dry-run'],
          },
          {
            channel: 'maimai',
            status: 'not_ready',
            issues: ['未找到 脉脉 标签页'],
            nextSteps: ['在 Chrome 打开脉脉页面。'],
          },
        ],
      },
      opened: [{
        channel: 'maimai',
        url: 'https://maimai.cn/ent/v41/recruit/talents?tab=1',
        reason: '未找到 脉脉 标签页',
      }],
      skipped: [],
    });

    expect(output).toContain('Opened 1 missing channel page(s):');
    expect(output).toContain('https://maimai.cn/ent/v41/recruit/talents?tab=1');
    expect(output).toContain('完成登录');
    expect(output).toContain('hireseek validate');
  });
});
