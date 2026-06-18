import { describe, expect, it } from 'vitest';
import {
  buildRecruitingCapabilityContext,
  formatRecruitingCapabilities,
  listRecruitingCapabilities,
} from '../src/capabilities';

describe('recruiting capability middle layer', () => {
  it('registers shared recruiting capabilities independently from skills', () => {
    const all = listRecruitingCapabilities();
    const ids = all.map(c => c.id);

    expect(ids).toContain('candidate-evaluation.v1');
    expect(ids).toContain('outreach-voice.v1');
    expect(ids).toContain('talent-sourcing-strategy.v1');
    expect(formatRecruitingCapabilities()).toContain('HireSeek 中层招聘能力');
  });

  it('builds BOSS context from shared evaluation and outreach without maimai search playbook', () => {
    const context = buildRecruitingCapabilityContext({
      channel: 'boss',
      includeKinds: ['principles', 'evaluation', 'outreach', 'search'],
    });

    expect(context).toContain('candidate-evaluation.v1');
    expect(context).toContain('outreach-voice.v1');
    expect(context).toContain('outreach-output.v1');
    expect(context).toContain('personalization_evidence');
    expect(context).toContain('让这个人感觉到他被真正看见了');
    expect(context).not.toContain('talent-sourcing-strategy.v1');
    expect(context).not.toContain('脉脉平台筛选器映射');
  });

  it('includes search strategy for channels where the capability applies', () => {
    const context = buildRecruitingCapabilityContext({
      channel: 'maimai',
      includeKinds: ['search'],
    });

    expect(context).toContain('talent-sourcing-strategy.v1');
    expect(context).toContain('关键词矩阵');
    expect(formatRecruitingCapabilities('maimai')).toContain('talent-sourcing-strategy.v1');
  });
});
