import './dsh-env';
import { describe, expect, it } from 'vitest';
import { bossBrowserActionPolicy } from '../src/platform-protocols/boss';
import { GREETING_PATTERN } from '../src/runners/dom-runner';

const baseContext = {
  observedStageIds: ['session-precheck', 'job-positioning', 'prefilter', 'dom-probe'],
  targetJobTitle: '游戏发行负责人',
};

function clickWith(label: string, executionMode: 'execute' | 'screen' | 'prepare' | 'dry_run') {
  return bossBrowserActionPolicy(
    { action: 'click', ref: 12, stage_id: 'candidate-screen' },
    { ...baseContext, executionMode, actionLabel: label },
  );
}

describe('详情弹层右侧按钮：会写到平台上的动作', () => {
  it('screen 模式禁止点「不合适」——那是标记到 BOSS 上，不是本地跳过', () => {
    const decision = clickWith('[ref=12] <div> 不合适 class="btn-unfit"', 'screen');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('不合适');
    expect(decision.recovery).toContain('record_screened_candidate');
  });

  it('screen 模式同样禁止收藏与转发牛人', () => {
    expect(clickWith('[ref=13] <div> 收藏', 'screen').allowed).toBe(false);
    expect(clickWith('[ref=14] <div> 转发牛人', 'screen').allowed).toBe(false);
  });

  it('举报任何模式都不允许，包括 execute', () => {
    for (const mode of ['execute', 'screen', 'prepare', 'dry_run'] as const) {
      const decision = clickWith('[ref=15] <div> 举报', mode);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('举报');
    }
  });

  it('正常的候选人卡片点击不受影响', () => {
    const decision = clickWith('[ref=41] <div> 陈曦 35岁 10年以上 本科 class="geek-item" pointer=true', 'screen');
    expect(decision.allowed).toBe(true);
  });
});

describe('「帮我联系」是触达入口，不能漏', () => {
  it('screen 模式下和打招呼一样被拦', () => {
    const decision = clickWith('[ref=20] <button> 帮我联系', 'screen');
    expect(decision.allowed).toBe(false);
  });

  it('计入触达节流的按钮特征，避免绕过 5 秒间隔与每日上限统计', () => {
    expect(GREETING_PATTERN.test('帮我联系')).toBe(true);
    expect(GREETING_PATTERN.test('打招呼')).toBe(true);
    expect(GREETING_PATTERN.test('经历概览')).toBe(false);
  });
});
