import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { contractNameForChannel } from '../src/contracts';
import { formatPlatformProtocols, getPlatformProtocol } from '../src/platform-protocols';
import {
  bossBrowserActionPolicy,
  bossProcessRules,
  buildBossSystemContext,
  buildBossTaskPrompt,
} from '../src/platform-protocols/boss';
import { loadSkill } from '../src/skills/loader';

describe('boss platform protocol middle layer', () => {
  it('tells the runner to switch jobs inside BOSS instead of asking the user', () => {
    const prompt = buildBossTaskPrompt({ channelLabel: 'BOSS直聘', fromCurrent: true });

    expect(prompt).toContain('切到目标岗位');
    expect(prompt).toContain('站内');
    expect(prompt).toContain('不要把“当前职位不匹配”当成任务结束');
    expect(prompt).toContain('真实 Chrome');
    expect(prompt).toContain('职位名匹配要做归一化');
    expect(prompt).toContain('筛选面板是强制前置步骤');
    expect(prompt).toContain('筛选组合必须来自当前职位 facts / effective_prefilter');
    expect(prompt).toContain('DOM 选择器探测');
    expect(prompt).toContain('禁止跨会话复用旧选择器');
    expect(prompt).toContain('≥5 秒');
    expect(prompt).toContain('pool_refill_exhausted');
    expect(prompt).toContain('推荐 -> 最新');
  });

  it('blocks direct URL navigation while allowing normal page operations', () => {
    const denied = bossBrowserActionPolicy(
      { action: 'goto', url: 'https://www.zhipin.com/web/chat/recommend' },
      {},
    );
    const allowedClick = bossBrowserActionPolicy({ action: 'click', ref: 12 }, {});
    const allowedSnapshot = bossBrowserActionPolicy({ action: 'snapshot' }, {});
    const allowedScroll = bossBrowserActionPolicy({ action: 'scroll', direction: 'down' }, {});

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('直接跳转 URL');
    expect(allowedClick.allowed).toBe(true);
    expect(allowedSnapshot.allowed).toBe(true);
    expect(allowedScroll.allowed).toBe(true);
  });

  it('keeps BOSS process rules in the protocol layer', () => {
    const rules = bossProcessRules();

    expect(rules).toContain('当前页面职位与目标岗位不一致');
    expect(rules).toContain('页面内 click/type/press/scroll');
    expect(rules).toContain('标题归一化');
    expect(rules).toContain('筛选面板');
    expect(rules).toContain('DOM 探测');
    expect(rules).toContain('≥5 秒');
    expect(rules).toContain('人工接管期间必须零动作');
    expect(rules).toContain('record_contacted');
  });

  it('registers BOSS protocol as the channel contract owner', () => {
    const protocol = getPlatformProtocol('boss');

    expect(protocol?.name).toBe('boss-platform.v1');
    expect(protocol?.contractName).toBe('boss-greeting.v1');
    expect(contractNameForChannel('boss')).toBe('boss-greeting.v1');
    expect(protocol?.buildSystemContext?.()).toContain('优先级高于外部 skill 资产');
    expect(formatPlatformProtocols()).toContain('boss-platform.v1');
    expect(formatPlatformProtocols()).toContain('产品中层协议');
  });

  it('keeps legacy skill assets below product protocols', () => {
    const systemContext = buildBossSystemContext();
    const skill = loadSkill('boss');
    const fallback = fs.readFileSync(path.join(process.cwd(), 'workspace', 'skills', 'boss.md'), 'utf-8');

    expect(systemContext).toContain('代码层风控');
    expect(systemContext).toContain('人工接管前必须强停');
    expect(systemContext).toContain('26年后毕业');
    expect(systemContext).toContain('parse_quality');
    expect(skill).toContain('Skill 资产兼容层');
    expect(skill).toContain('HireSeek 产品中层协议');
    expect(fallback).toContain('如果当前职位不是目标岗位，应优先站内切到目标岗位');
    expect(fallback).not.toContain('禁止 `goto`、禁止切职位');
  });
});
