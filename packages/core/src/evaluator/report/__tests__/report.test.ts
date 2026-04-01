// @hireclaw/core/evaluator/report — Tests

import { describe, it, expect } from 'vitest';
import { ReportGenerator } from '../ReportGenerator.js';
import type { Candidate, JobConfig, EvaluationResult } from '../../../types.js';

function createMockCandidate(overrides?: Partial<Candidate>): Candidate {
  return {
    id: 'cand_001',
    name: '张三',
    platform: 'boss',
    profile: {
      education: [{ school: '清华大学', degree: '硕士', major: 'CS', endYear: 2023, isTopSchool: true }],
      experience: [{ company: '字节跳动', title: '高级工程师', startDate: '2021', endDate: '2024' }],
      skills: ['Python', 'Go', 'K8s'],
      ext: {},
    },
    source: { url: 'https://www.zhipin.com/job_abc' },
    ...overrides,
  };
}

function createMockResult(score = 85, passed = true): EvaluationResult {
  return {
    score,
    passed,
    threshold: 80,
    dimensions: [
      { name: 'education', score: 90, weight: 0.15, weightedScore: 14, notes: '顶尖院校' },
      { name: 'experience', score: 85, weight: 0.25, weightedScore: 21, notes: '大厂经验' },
      { name: 'skills', score: 80, weight: 0.25, weightedScore: 20, notes: '技能匹配' },
      { name: 'company', score: 85, weight: 0.15, weightedScore: 13, notes: '知名公司' },
      { name: 'growth', score: 80, weight: 0.10, weightedScore: 8, notes: '成长正常' },
      { name: 'personality', score: 75, weight: 0.10, weightedScore: 8, notes: 'GitHub 活跃' },
    ],
    vetoed: [],
    bonuses: [{ rule: '大厂+AI', points: 15 }],
    priority: score >= 85 ? 'high' : 'medium',
    summary: '综合评分 85，推荐',
  };
}

describe('ReportGenerator', () => {
  let generator: ReportGenerator;

  beforeEach(() => {
    generator = new ReportGenerator();
  });

  describe('generate', () => {
    it('should create a report with all fields', () => {
      const candidate = createMockCandidate();
      const result = createMockResult(85, true);

      const report = generator.generate(candidate, 'job_001', result);

      expect(report.reportId).toBeDefined();
      expect(report.generatedAt).toBeDefined();
      expect(report.candidate.name).toBe('张三');
      expect(report.totalScore).toBe(85);
      expect(report.passed).toBe(true);
      expect(report.dimensions.length).toBe(6);
      expect(report.bonuses.length).toBe(1);
    });

    it('should set correct totalLevel', () => {
      const candidate = createMockCandidate();

      const excellentReport = generator.generate(candidate, 'job_001', createMockResult(95, true));
      expect(excellentReport.totalLevel).toBe('excellent');

      const goodReport = generator.generate(candidate, 'job_001', createMockResult(85, true));
      expect(goodReport.totalLevel).toBe('good');

      const poorReport = generator.generate(candidate, 'job_001', createMockResult(50, false));
      expect(poorReport.totalLevel).toBe('poor');
    });
  });

  describe('generateBatch', () => {
    it('should rank candidates by score', () => {
      const candidates = [
        { candidate: createMockCandidate({ id: 'c1', name: '张三' }), result: createMockResult(90) },
        { candidate: createMockCandidate({ id: 'c2', name: '李四' }), result: createMockResult(75) },
        { candidate: createMockCandidate({ id: 'c3', name: '王五' }), result: createMockResult(85) },
      ];

      const report = generator.generateBatch(candidates, 'job_001', '高级工程师');

      expect(report.rankings.length).toBe(3);
      expect(report.rankings[0].rank).toBe(1);
      expect(report.rankings[0].candidate.name).toBe('张三');
      expect(report.rankings[1].rank).toBe(2);
      expect(report.rankings[2].rank).toBe(3);
    });

    it('should calculate distribution correctly', () => {
      const candidates = [
        { candidate: createMockCandidate({ id: 'c1' }), result: createMockResult(95) },
        { candidate: createMockCandidate({ id: 'c2' }), result: createMockResult(85) },
        { candidate: createMockCandidate({ id: 'c3' }), result: createMockResult(70) },
        { candidate: createMockCandidate({ id: 'c4' }), result: createMockResult(45) },
      ];

      const report = generator.generateBatch(candidates, 'job_001', '工程师');

      expect(report.distribution.excellent).toBe(1);
      expect(report.distribution.good).toBe(1);
      expect(report.distribution.acceptable).toBe(1);
      expect(report.distribution.poor).toBe(1);
    });

    it('should calculate platform stats', () => {
      const candidates = [
        { candidate: createMockCandidate({ id: 'c1', platform: 'boss' }), result: createMockResult(85) },
        { candidate: createMockCandidate({ id: 'c2', platform: 'boss' }), result: createMockResult(75) },
        { candidate: createMockCandidate({ id: 'c3', platform: 'maimai' }), result: createMockResult(90) },
      ];

      const report = generator.generateBatch(candidates, 'job_001', '工程师');

      expect(report.platformStats.length).toBe(2);
      const bossStats = report.platformStats.find(s => s.platform === 'boss');
      expect(bossStats!.count).toBe(2);
      expect(bossStats!.averageScore).toBe(80);
    });
  });

  describe('toMarkdown', () => {
    it('should generate markdown report', () => {
      const candidate = createMockCandidate();
      const result = createMockResult(85, true);
      const report = generator.generate(candidate, 'job_001', result);

      const md = generator.toMarkdown(report);

      expect(md).toContain('候选人评估报告');
      expect(md).toContain('张三');
      expect(md).toContain('85');
      expect(md).toContain('维度评分');
      expect(md).toContain('学历与绩点');
    });

    it('should show vetoes section when present', () => {
      const candidate = createMockCandidate();
      const result: EvaluationResult = {
        ...createMockResult(50, false),
        vetoed: ['学历一般且无亮点'],
      };

      const report = generator.generate(candidate, 'job_001', result);
      const md = generator.toMarkdown(report);

      expect(md).toContain('否决项');
      expect(md).toContain('学历一般且无亮点');
    });
  });

  describe('toFeishuCard', () => {
    it('should generate feishu card format', () => {
      const candidate = createMockCandidate();
      const result = createMockResult(85, true);
      const report = generator.generate(candidate, 'job_001', result);

      const card = generator.toFeishuCard(report);

      expect(card).toHaveProperty('msg_type', 'interactive');
      expect(card).toHaveProperty('card.header');
      expect(card).toHaveProperty('card.elements');
    });
  });

  describe('toJSON', () => {
    it('should serialize report to JSON', () => {
      const candidate = createMockCandidate();
      const result = createMockResult(85, true);
      const report = generator.generate(candidate, 'job_001', result);

      const json = generator.toJSON(report);
      const parsed = JSON.parse(json);

      expect(parsed.candidate.name).toBe('张三');
      expect(parsed.totalScore).toBe(85);
    });
  });
});
