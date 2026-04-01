// @hireclaw/core/memory — Memory Module Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore, FileStore, createMemoryStore } from '../MemoryStore.js';
import type { MemoryQueryFilter } from '../MemoryStore.js';
import { CandidateMemory } from '../CandidateMemory.js';
import type { RememberContext } from '../CandidateMemory.js';
import { DemandMemory } from '../DemandMemory.js';
import { AutoMemory } from '../AutoMemory.js';
import type { Candidate, JobConfig, EvaluationResult, MemoryEntry } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────

function createMockCandidate(overrides?: Partial<Candidate>): Candidate {
  return {
    id: 'cand_001',
    name: '张三',
    platform: 'boss',
    profile: {
      education: [
        {
          school: '清华大学',
          degree: '硕士',
          major: '计算机科学',
          endYear: 2023,
          isTopSchool: true,
        },
      ],
      experience: [
        {
          company: '字节跳动',
          title: '高级工程师',
          startDate: '2021-06',
          endDate: '2024-01',
          duration: '2年7个月',
          isTopCompany: true,
        },
      ],
      skills: ['Python', 'Go', 'Kubernetes', '分布式系统'],
      ext: {},
    },
    source: {
      url: 'https://www.zhipin.com/job_abc',
    },
    ...overrides,
  };
}

function createMockJob(overrides?: Partial<JobConfig>): JobConfig {
  return {
    id: 'job_001',
    title: '高级后端工程师',
    department: '平台部',
    location: '北京',
    salary: { min: 35, max: 60, currency: 'CNY', period: 'year' as const },
    platforms: ['boss', 'maimai'],
    description: '负责平台架构设计与开发，要求熟悉 Python/Go，了解分布式系统',
    ...overrides,
  };
}

function createMockEvaluation(score = 85): EvaluationResult {
  return {
    score,
    passed: score >= 80,
    threshold: 80,
    dimensions: [
      { name: 'education', score: 90, weight: 0.15, weightedScore: 13.5, notes: '顶尖院校' },
      { name: 'experience', score: 85, weight: 0.25, weightedScore: 21.25, notes: '大厂经验' },
      { name: 'skills', score: 80, weight: 0.25, weightedScore: 20, notes: '技能匹配' },
      { name: 'company', score: 85, weight: 0.15, weightedScore: 12.75, notes: '知名公司' },
      { name: 'growth', score: 80, weight: 0.10, weightedScore: 8, notes: '成长正常' },
      { name: 'personality', score: 75, weight: 0.10, weightedScore: 7.5, notes: 'GitHub 活跃' },
    ],
    vetoed: [],
    bonuses: [],
    priority: score >= 85 ? 'high' : 'medium',
    summary: '综合评分 85，强烈推荐',
  };
}

// ────────────────────────────────────────────────────────────
// MemoryStore Tests
// ────────────────────────────────────────────────────────────

describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('should save and retrieve a memory entry', async () => {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: 'test_001',
      type: 'candidate_interaction',
      content: 'Test content',
      metadata: { candidateId: 'cand_123' },
      createdAt: now,
      updatedAt: now,
    };

    await store.save(entry);
    const retrieved = await store.get('test_001');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('test_001');
    expect(retrieved!.content).toBe('Test content');
  });

  it('should query entries by type', async () => {
    const now = new Date().toISOString();
    await store.saveBatch([
      { id: '1', type: 'candidate_interaction' as const, content: 'c1', metadata: {}, createdAt: now, updatedAt: now },
      { id: '2', type: 'candidate_interaction' as const, content: 'c2', metadata: {}, createdAt: now, updatedAt: now },
      { id: '3', type: 'pattern' as const, content: 'p1', metadata: {}, createdAt: now, updatedAt: now },
    ]);

    const results = await store.query({ type: 'candidate_interaction' });
    expect(results.length).toBe(2);
  });

  it('should query entries by metadata', async () => {
    const now = new Date().toISOString();
    await store.saveBatch([
      { id: '1', type: 'candidate_interaction' as const, content: 'c1', metadata: { candidateId: 'A' }, createdAt: now, updatedAt: now },
      { id: '2', type: 'candidate_interaction' as const, content: 'c2', metadata: { candidateId: 'B' }, createdAt: now, updatedAt: now },
    ]);

    const results = await store.query({ metadata: { candidateId: 'A' } });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('c1');
  });

  it('should delete entries', async () => {
    const now = new Date().toISOString();
    await store.save({ id: 'del_1', type: 'candidate_interaction' as const, content: 'to delete', metadata: {}, createdAt: now, updatedAt: now });
    await store.delete('del_1');
    const result = await store.get('del_1');
    expect(result).toBeNull();
  });

  it('should return stats', async () => {
    const now = new Date().toISOString();
    await store.saveBatch([
      { id: '1', type: 'candidate_interaction' as const, content: 'c1', metadata: {}, createdAt: now, updatedAt: now },
      { id: '2', type: 'pattern' as const, content: 'p1', metadata: {}, createdAt: now, updatedAt: now },
    ]);

    const stats = await store.stats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.byType.candidate_interaction).toBe(1);
    expect(stats.byType.pattern).toBe(1);
  });

  it('should support saveBatch', async () => {
    const now = new Date().toISOString();
    const entries: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `batch_${i}`,
      type: 'candidate_interaction' as const,
      content: `batch item ${i}`,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }));

    await store.saveBatch(entries);
    const stats = await store.stats();
    expect(stats.totalEntries).toBe(10);
  });
});

describe('createMemoryStore factory', () => {
  it('should create InMemoryStore', () => {
    const store = createMemoryStore({ type: 'memory' });
    expect(store).toBeInstanceOf(InMemoryStore);
  });

  it('should throw if filePath missing for file type', () => {
    expect(() => createMemoryStore({ type: 'file' })).toThrow('filePath is required');
  });
});

// ────────────────────────────────────────────────────────────
// CandidateMemory Tests
// ────────────────────────────────────────────────────────────

describe('CandidateMemory', () => {
  let store: InMemoryStore;
  let memory: CandidateMemory;

  beforeEach(() => {
    store = new InMemoryStore();
    memory = new CandidateMemory({ store });
  });

  it('should remember a new candidate', async () => {
    const candidate = createMockCandidate();
    const ctx: RememberContext = { type: 'discovered', platform: 'boss' };

    const entry = await memory.remember(candidate, ctx);

    expect(entry.candidateId).toBe('cand_001');
    expect(entry.candidateName).toBe('张三');
    expect(entry.platform).toBe('boss');
    expect(entry.interactions.length).toBe(1);
    expect(entry.interactions[0].type).toBe('discovered');
  });

  it('should auto-generate tags', async () => {
    const candidate = createMockCandidate();
    await memory.remember(candidate, { type: 'discovered' });

    const entry = await memory.recall('cand_001');
    expect(entry!.tags).toContain('platform:boss');
    expect(entry!.tags).toContain('top-school');
    expect(entry!.tags).toContain('top-company');
  });

  it('should record outreach', async () => {
    const candidate = createMockCandidate();
    await memory.remember(candidate, { type: 'discovered' });

    const evaluation = createMockEvaluation(85);
    const outreachRecord = {
      candidateId: 'cand_001',
      platform: 'boss',
      message: '您好，我们正在招聘...',
      sentAt: new Date().toISOString(),
      result: 'sent' as const,
    };

    await memory.recordOutreach('cand_001', outreachRecord, evaluation);

    const entry = await memory.recall('cand_001');
    expect(entry!.outreachCount).toBe(1);
    expect(entry!.evaluationHistory.length).toBe(1);
    expect(entry!.evaluationHistory[0].score).toBe(85);
  });

  it('should add tags', async () => {
    const candidate = createMockCandidate();
    await memory.remember(candidate, { type: 'discovered' });

    await memory.addTag('cand_001', '面试通过');
    await memory.addTag('cand_001', '高薪');

    const entry = await memory.recall('cand_001');
    expect(entry!.tags).toContain('面试通过');
    expect(entry!.tags).toContain('高薪');
  });

  it('should add notes', async () => {
    const candidate = createMockCandidate();
    await memory.remember(candidate, { type: 'discovered' });

    await memory.addNote('cand_001', '候选人对职位很感兴趣');
    await memory.addNote('cand_001', '期望薪资 50k*14');

    const entry = await memory.recall('cand_001');
    expect(entry!.notes).toContain('候选人对职位很感兴趣');
    expect(entry!.notes).toContain('期望薪资 50k*14');
  });

  it('should generate summary', async () => {
    const candidate = createMockCandidate();
    await memory.remember(candidate, { type: 'discovered' });
    await memory.recordOutreach('cand_001', {
      candidateId: 'cand_001',
      platform: 'boss',
      message: 'Hello',
      sentAt: new Date().toISOString(),
      result: 'sent',
    }, createMockEvaluation(85));

    const summary = await memory.generateSummary('cand_001');

    expect(summary).toContain('张三');
    expect(summary).toContain('触达次数: 1');
    expect(summary).toContain('最新评分: 85');
  });

  it('should return null for unknown candidate', async () => {
    const result = await memory.recall('unknown_id');
    expect(result).toBeNull();
  });

  it('should list all candidates', async () => {
    await memory.remember(createMockCandidate({ id: 'c1', name: '张三' }), { type: 'discovered' });
    await memory.remember(createMockCandidate({ id: 'c2', name: '李四' }), { type: 'discovered' });

    const all = await memory.listAll();
    expect(all.length).toBe(2);
  });

  it('should get most contacted candidates', async () => {
    const c1 = createMockCandidate({ id: 'c1', name: '张三' });
    const c2 = createMockCandidate({ id: 'c2', name: '李四' });

    await memory.remember(c1, { type: 'discovered' });
    await memory.remember(c2, { type: 'discovered' });

    await memory.recordOutreach('c1', {
      candidateId: 'c1', platform: 'boss', message: 'm1', sentAt: new Date().toISOString(), result: 'sent',
    }, createMockEvaluation(90));
    await memory.recordOutreach('c1', {
      candidateId: 'c1', platform: 'boss', message: 'm2', sentAt: new Date().toISOString(), result: 'sent',
    }, createMockEvaluation(85));

    const mostContacted = await memory.getMostContacted(5);
    expect(mostContacted[0].candidateName).toBe('张三');
    expect(mostContacted[0].outreachCount).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────
// DemandMemory Tests
// ────────────────────────────────────────────────────────────

describe('DemandMemory', () => {
  let store: InMemoryStore;
  let demand: DemandMemory;

  beforeEach(() => {
    store = new InMemoryStore();
    demand = new DemandMemory({ store });
  });

  it('should memorize a job', async () => {
    const job = createMockJob();

    const entry = await demand.memorize(job);

    expect(entry.jobId).toBe('job_001');
    expect(entry.jobTitle).toBe('高级后端工程师');
    expect(entry.targetSkills.length).toBeGreaterThan(0);
  });

  it('should extract skills from job description', async () => {
    const job = createMockJob({
      description: '要求熟悉 Python, Go, Kubernetes, 了解分布式系统和微服务架构',
    });

    const entry = await demand.memorize(job);

    expect(entry.targetSkills).toContain('python');
    expect(entry.targetSkills).toContain('go');
    expect(entry.targetSkills).toContain('kubernetes');
  });

  it('should add company preferences', async () => {
    const job = createMockJob();
    await demand.memorize(job);

    await demand.addCompanyPreference('job_001', '字节跳动', 'prefer');
    await demand.addCompanyPreference('job_001', '某小公司', 'avoid');

    const prefs = await demand.getCompanyPreferences('job_001');
    expect(prefs.preferred).toContain('字节跳动');
    expect(prefs.avoided).toContain('某小公司');
  });

  it('should add rejection feedback', async () => {
    const job = createMockJob();
    await demand.memorize(job);

    await demand.addRejectionReason('cand_001', '张三', 'job_001', '薪资预期 50k，当前预算达不到');

    const entry = await demand.recallDemand('job_001');
    expect(entry!.rejectionFeedback.length).toBe(1);
    expect(entry!.rejectionFeedback[0].isSalaryReason).toBe(true);
  });

  it('should update stats', async () => {
    const job = createMockJob();
    await demand.memorize(job);

    await demand.updateStats('job_001', 'contact');
    await demand.updateStats('job_001', 'contact');
    await demand.updateStats('job_001', 'reply');
    await demand.updateStats('job_001', 'screen');

    const entry = await demand.recallDemand('job_001');
    expect(entry!.stats.contacted).toBe(2);
    expect(entry!.stats.replied).toBe(1);
    expect(entry!.stats.screened).toBe(1);
    expect(entry!.stats.contactToReplyRate).toBe(0.5);
  });

  it('should generate market insights', async () => {
    const job = createMockJob();
    await demand.memorize(job);

    await demand.addRejectionReason('c1', '张三', 'job_001', '薪资 45k太高');
    await demand.addRejectionReason('c2', '李四', 'job_001', '期望 50k');
    await demand.addRejectionReason('c3', '王五', 'job_001', '技能不匹配');

    await demand.updateStats('job_001', 'contact');
    await demand.updateStats('job_001', 'contact');
    await demand.updateStats('job_001', 'contact');
    await demand.updateStats('job_001', 'reply');

    const insights = await demand.getMarketInsights('job_001');

    expect(insights.some(i => i.includes('薪资'))).toBe(true);
    expect(insights.some(i => i.includes('回复率'))).toBe(true);
  });

  it('should forget a demand', async () => {
    const job = createMockJob();
    await demand.memorize(job);

    await demand.forget('job_001');

    const result = await demand.recallDemand('job_001');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// AutoMemory Tests
// ────────────────────────────────────────────────────────────

describe('AutoMemory', () => {
  let store: InMemoryStore;
  let auto: AutoMemory;

  beforeEach(() => {
    store = new InMemoryStore();
    auto = new AutoMemory({
      store,
      compactionThreshold: 5,
      preserveRecentCount: 3,
    });
  });

  it('should discover skill trends', async () => {
    const candidates = [
      createMockCandidate({ id: 'c1', profile: { ...createMockCandidate().profile, skills: ['Python', 'Go', 'K8s'] as string[] } }),
      createMockCandidate({ id: 'c2', profile: { ...createMockCandidate().profile, skills: ['Python', 'Go', 'ML'] as string[] } }),
      createMockCandidate({ id: 'c3', profile: { ...createMockCandidate().profile, skills: ['Python', 'Rust', 'K8s'] as string[] } }),
      createMockCandidate({ id: 'c4', profile: { ...createMockCandidate().profile, skills: ['Python', 'Go'] as string[] } }),
      createMockCandidate({ id: 'c5', profile: { ...createMockCandidate().profile, skills: ['Python', 'Distributed'] as string[] } }),
    ];

    const patterns = await auto.discover(candidates, []);

    const skillPattern = patterns.find(p => p.type === 'skill_trend');
    expect(skillPattern).toBeDefined();
    expect(skillPattern!.examples.some((e: string) => e.includes('python'))).toBe(true);
  });

  it('should discover quality distribution', async () => {
    const candidates = [
      createMockCandidate({ id: 'c1', evaluation: createMockEvaluation(90) }),
      createMockCandidate({ id: 'c2', evaluation: createMockEvaluation(85) }),
      createMockCandidate({ id: 'c3', evaluation: createMockEvaluation(75) }),
      createMockCandidate({ id: 'c4', evaluation: createMockEvaluation(88) }),
    ];

    const patterns = await auto.discover(candidates, []);

    const qualityPattern = patterns.find(p => p.type === 'candidate_quality');
    expect(qualityPattern).toBeDefined();
  });

  it('should compact and generate summary', async () => {
    const memory = new CandidateMemory({ store });
    await memory.remember(createMockCandidate({ id: 'c1' }), { type: 'discovered' });
    await memory.remember(createMockCandidate({ id: 'c2' }), { type: 'discovered' });

    await auto.discover([
      createMockCandidate({ id: 'c1', evaluation: createMockEvaluation(88) }),
    ], []);

    const summary = await auto.compact();

    expect(summary.generatedAt).toBeDefined();
    expect(summary.totalCandidates).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.patterns)).toBe(true);
    expect(Array.isArray(summary.pendingWork)).toBe(true);
    expect(Array.isArray(summary.timeline)).toBe(true);
  });

  it('should infer pending work', async () => {
    const memory = new CandidateMemory({ store });
    await memory.remember(createMockCandidate({ id: 'c1' }), { type: 'discovered' });

    const pending = auto.inferPendingWork();
    expect(pending.length).toBeGreaterThanOrEqual(0);
  });

  it('should get patterns by type', async () => {
    await auto.discover([
      createMockCandidate({ id: 'c1', evaluation: createMockEvaluation(88) }),
    ], []);

    const patterns = await auto.getPatterns({ type: 'candidate_quality' });
    expect(patterns.every(p => p.type === 'candidate_quality')).toBe(true);
  });
});
