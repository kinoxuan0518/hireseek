import { describe, expect, it } from 'vitest';
import { getEnabledChannels, type JobConfig } from '../src/skills/loader';

describe('active job channels', () => {
  it('reads the canonical map form', () => {
    const job: JobConfig = {
      title: '供应链算法工程师',
      channels: {
        boss: { enabled: true, accounts: 2 },
        maimai: { enabled: false, accounts: 1 },
        linkedin: { enabled: true, accounts: 0 },
      },
    };
    expect(getEnabledChannels(job)).toEqual([{ channel: 'boss', accounts: 2 }]);
  });

  it('still enables channels written as a plain list by the setup wizard', () => {
    const job = { title: 'x', channels: ['boss', 'maimai'] } as unknown as JobConfig;
    expect(getEnabledChannels(job)).toEqual([
      { channel: 'boss', accounts: 1 },
      { channel: 'maimai', accounts: 1 },
    ]);
  });

  it('ignores unknown channel names and missing config', () => {
    const job = { title: 'x', channels: ['boss', 'weibo'] } as unknown as JobConfig;
    expect(getEnabledChannels(job)).toEqual([{ channel: 'boss', accounts: 1 }]);
    expect(getEnabledChannels({ title: 'x' })).toEqual([]);
  });
});
