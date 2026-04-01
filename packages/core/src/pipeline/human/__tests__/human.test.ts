// @hireclaw/core/pipeline/human — Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { HumanInLoop } from '../HumanInLoop.js';
import type { Candidate, EvaluationResult } from '../../../types.js';

function createMockCandidate(overrides?: Partial<Candidate>): Candidate {
  return {
    id: 'cand_001',
    name: '张三',
    platform: 'boss',
    profile: {
      education: [{ school: '清华大学', degree: '硕士', major: 'CS', endYear: 2023 }],
      experience: [{ company: '字节跳动', title: '高级工程师', startDate: '2021' }],
      skills: ['Python', 'Go'],
      ext: {},
    },
    source: { url: 'https://www.zhipin.com/job_abc' },
    ...overrides,
  };
}

function createMockEvaluation(score = 85): EvaluationResult {
  return {
    score,
    passed: score >= 80,
    threshold: 80,
    dimensions: [
      { name: 'education', score: 90, weight: 0.15, weightedScore: 14, notes: '顶尖' },
      { name: 'experience', score: 85, weight: 0.25, weightedScore: 21, notes: '良好' },
      { name: 'skills', score: 80, weight: 0.25, weightedScore: 20, notes: 'OK' },
      { name: 'company', score: 85, weight: 0.15, weightedScore: 13, notes: '大厂' },
      { name: 'growth', score: 80, weight: 0.10, weightedScore: 8, notes: '正常' },
      { name: 'personality', score: 75, weight: 0.10, weightedScore: 8, notes: '一般' },
    ],
    vetoed: [],
    bonuses: [],
    priority: 'high',
    summary: '综合评分 85，推荐',
  };
}

describe('HumanInLoop', () => {
  let hil: HumanInLoop;

  beforeEach(() => {
    hil = new HumanInLoop({ defaultOrdinal: 0 });
  });

  describe('constructor', () => {
    it('should use default ordinal of 0', () => {
      expect(hil).toBeDefined();
      const pending = hil.getPendingRequests();
      expect(pending).toEqual([]);
    });
  });

  describe('registerTrigger', () => {
    it('should register a trigger', () => {
      hil.registerTrigger({
        triggerId: 'test',
        type: 'manual_override',
        ordinal: 1,
        description: 'Test trigger',
        condition: () => true,
      });

      const triggers = hil.getTriggers();
      expect(triggers.length).toBeGreaterThan(0);
    });

    it('should allow removing a trigger', () => {
      hil.registerTrigger({
        triggerId: 'test',
        type: 'manual_override',
        ordinal: 1,
        description: 'Test',
        condition: () => true,
      });

      hil.removeTrigger('test');
      const triggers = hil.getTriggers();
      expect(triggers.some(t => t.triggerId === 'test')).toBe(false);
    });
  });

  describe('checkTriggers', () => {
    it('should return null for default ordinal 0 with no matching triggers', () => {
      const candidate = createMockCandidate();
      const evaluation = createMockEvaluation(85);

      const request = hil.checkTriggers(candidate, evaluation, 'outreach');
      expect(request).toBeNull();
    });

    it('should create request when trigger matches (high_score)', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });

      const candidate = createMockCandidate();
      const evaluation = createMockEvaluation(95); // score >= 95 triggers high_score

      const request = hil.checkTriggers(candidate, evaluation, 'outreach');
      expect(request).not.toBeNull();
      expect(request!.ordinal).toBe(1);
      expect(request!.status).toBe('pending');
    });

    it('should trigger on executive titles (Ordinal 2)', () => {
      hil = new HumanInLoop({ defaultOrdinal: 0 });

      const executive = createMockCandidate({
        profile: {
          ...createMockCandidate().profile,
          experience: [{ company: '某公司', title: 'CTO', startDate: '2020' }],
          skills: [],
          education: [],
          ext: {},
        },
      });

      const request = hil.checkTriggers(executive, createMockEvaluation(90), 'outreach');
      expect(request).not.toBeNull();
      expect(request!.ordinal).toBe(2);
      expect(request!.description).toContain('高管');
    });
  });

  describe('approve/reject', () => {
    it('should approve a pending request', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });
      const candidate = createMockCandidate();
      const evaluation = createMockEvaluation(95); // score >= 95 triggers high_score

      const request = hil.checkTriggers(candidate, evaluation, 'outreach');
      expect(request).not.toBeNull();

      const result = hil.approve(request!.requestId, 'Kino');
      expect(result).toBe(true);

      const updated = hil.getRequest(request!.requestId);
      expect(updated!.status).toBe('approved');
      expect(updated!.approvedBy).toBe('Kino');
    });

    it('should reject a pending request', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });
      const candidate = createMockCandidate();
      const evaluation = createMockEvaluation(95);

      const request = hil.checkTriggers(candidate, evaluation, 'outreach');
      hil.reject(request!.requestId);

      const updated = hil.getRequest(request!.requestId);
      expect(updated!.status).toBe('rejected');
    });

    it('should not approve already approved request', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });
      const candidate = createMockCandidate();
      const evaluation = createMockEvaluation(95);

      const request = hil.checkTriggers(candidate, evaluation, 'outreach');
      hil.approve(request!.requestId, 'Kino');

      const result = hil.approve(request!.requestId, 'Kino2');
      expect(result).toBe(false);
    });
  });

  describe('getPendingRequests', () => {
    it('should return empty for no requests', () => {
      const pending = hil.getPendingRequests();
      expect(pending).toEqual([]);
    });

    it('should return all pending requests', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });

      hil.checkTriggers(createMockCandidate(), createMockEvaluation(95), 'outreach');
      hil.checkTriggers(createMockCandidate({ id: 'c2' }), createMockEvaluation(95), 'outreach');

      const pending = hil.getPendingRequests();
      expect(pending.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });

      const r1 = hil.checkTriggers(createMockCandidate(), createMockEvaluation(95), 'outreach');
      hil.approve(r1!.requestId, 'Kino');

      const r2 = hil.checkTriggers(createMockCandidate({ id: 'c2' }), createMockEvaluation(95), 'outreach');
      hil.reject(r2!.requestId);

      const stats = hil.getStats();
      expect(stats.approvedRequests).toBe(1);
      expect(stats.rejectedRequests).toBe(1);
      expect(stats.pendingRequests).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners on new request', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });
      let notified = false;

      hil.subscribe((req) => {
        notified = true;
        expect(req.ordinal).toBe(1);
      });

      hil.checkTriggers(createMockCandidate(), createMockEvaluation(95), 'outreach');
      expect(notified).toBe(true);
    });

    it('should return unsubscribe function', () => {
      hil = new HumanInLoop({ defaultOrdinal: 1 });
      let count = 0;
      const unsub = hil.subscribe(() => { count++; });

      hil.subscribe(() => { count++; });

      unsub(); // unsubscribe first listener
      hil.checkTriggers(createMockCandidate(), createMockEvaluation(95), 'outreach');
      expect(count).toBe(1); // only second listener called
    });
  });
});
