import './dsh-env';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEEP_READ_MODE,
  deepReadRequiredFor,
  describeDeepReadMode,
  resolveDeepReadMode,
} from '../src/deep-read';
import type { JobConfig } from '../src/skills/loader';

describe('深读分层开关', () => {
  it('默认只对「建议触达」要求通读简历', () => {
    expect(DEFAULT_DEEP_READ_MODE).toBe('contact');
    expect(resolveDeepReadMode(null, {})).toBe('contact');
    expect(deepReadRequiredFor('contact', 'contact')).toBe(true);
    expect(deepReadRequiredFor('contact', 'maybe')).toBe(false);
    expect(deepReadRequiredFor('contact', 'skip')).toBe(false);
  });

  it('全量模式下每个判断都要通读，关闭时都不要求', () => {
    for (const rec of ['contact', 'maybe', 'skip'] as const) {
      expect(deepReadRequiredFor('all', rec)).toBe(true);
      expect(deepReadRequiredFor('off', rec)).toBe(false);
    }
  });

  it('职位配置优先于环境变量——先对特定职位开就是这么表达的', () => {
    const job = { title: 'x', deep_read: 'all' } as JobConfig;
    expect(resolveDeepReadMode(job, { SEEYA_DEEP_READ: 'off' })).toBe('all');
    expect(resolveDeepReadMode(null, { SEEYA_DEEP_READ: 'all' })).toBe('all');
  });

  it('旧前缀仍然认，非法取值退回默认', () => {
    expect(resolveDeepReadMode(null, { HIRESEEK_DEEP_READ: 'off' })).toBe('off');
    expect(resolveDeepReadMode(null, { SEEYA_DEEP_READ: '随便读读' })).toBe('contact');
    expect(resolveDeepReadMode({ title: 'x', deep_read: '深读' } as JobConfig, {})).toBe('contact');
  });

  it('每种模式都有能塞进提示词的人话说明', () => {
    expect(describeDeepReadMode('contact')).toContain('必须先点进简历详情');
    expect(describeDeepReadMode('all')).toContain('每查看一个候选人');
    expect(describeDeepReadMode('off')).toContain('如实记录');
  });
});
