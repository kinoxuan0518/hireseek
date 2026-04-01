// @hireclaw/core/evaluator/dimensions — Tests

import { describe, it, expect } from 'vitest';
import {
  scoreToLevel,
  LEVEL_LABELS,
  DIMENSION_DEFINITIONS,
  validateWeights,
  normalizeWeights,
  scoreDimension,
} from '../Dimensions.js';

describe('Dimensions', () => {
  describe('scoreToLevel', () => {
    it('should return excellent for score >= 90', () => {
      expect(scoreToLevel(90)).toBe('excellent');
      expect(scoreToLevel(95)).toBe('excellent');
      expect(scoreToLevel(100)).toBe('excellent');
    });

    it('should return good for score 80-89', () => {
      expect(scoreToLevel(80)).toBe('good');
      expect(scoreToLevel(85)).toBe('good');
      expect(scoreToLevel(89)).toBe('good');
    });

    it('should return acceptable for score 60-79', () => {
      expect(scoreToLevel(60)).toBe('acceptable');
      expect(scoreToLevel(70)).toBe('acceptable');
      expect(scoreToLevel(79)).toBe('acceptable');
    });

    it('should return poor for score < 60', () => {
      expect(scoreToLevel(59)).toBe('poor');
      expect(scoreToLevel(40)).toBe('poor');
      expect(scoreToLevel(0)).toBe('poor');
    });
  });

  describe('LEVEL_LABELS', () => {
    it('should have labels for all levels', () => {
      expect(LEVEL_LABELS.excellent).toBe('🌟 优秀');
      expect(LEVEL_LABELS.good).toBe('✅ 良好');
      expect(LEVEL_LABELS.acceptable).toBe('⚠️ 合格');
      expect(LEVEL_LABELS.poor).toBe('❌ 不合格');
    });
  });

  describe('DIMENSION_DEFINITIONS', () => {
    it('should have all 6 dimensions', () => {
      const keys = Object.keys(DIMENSION_DEFINITIONS);
      expect(keys).toContain('education');
      expect(keys).toContain('experience');
      expect(keys).toContain('skills');
      expect(keys).toContain('company');
      expect(keys).toContain('growth');
      expect(keys).toContain('personality');
      expect(keys.length).toBe(6);
    });

    it('should have valid weights summing to 1', () => {
      const total = Object.values(DIMENSION_DEFINITIONS)
        .reduce((sum, d) => sum + d.defaultWeight, 0);
      expect(total).toBeCloseTo(1.0, 1);
    });

    it('should have scoring guide for each dimension', () => {
      for (const def of Object.values(DIMENSION_DEFINITIONS)) {
        expect(def.scoringGuide.excellent).toBeDefined();
        expect(def.scoringGuide.good).toBeDefined();
        expect(def.scoringGuide.acceptable).toBeDefined();
        expect(def.scoringGuide.poor).toBeDefined();
      }
    });
  });

  describe('validateWeights', () => {
    it('should pass for valid weights', () => {
      const weights = {
        education: 0.15,
        experience: 0.25,
        skills: 0.25,
        company: 0.15,
        growth: 0.10,
        personality: 0.10,
      };
      const { valid, errors } = validateWeights(weights);
      expect(valid).toBe(true);
      expect(errors.length).toBe(0);
    });

    it('should fail for weights not summing to 1', () => {
      const weights = {
        education: 0.10,
        experience: 0.25,
        skills: 0.25,
        company: 0.15,
        growth: 0.10,
        personality: 0.10,
      };
      const { valid, errors } = validateWeights(weights);
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('总和'))).toBe(true);
    });
  });

  describe('normalizeWeights', () => {
    it('should normalize weights to sum to 1', () => {
      const weights = {
        education: 0.10,
        experience: 0.25,
        skills: 0.25,
        company: 0.15,
        growth: 0.10,
        personality: 0.10,
      };
      const normalized = normalizeWeights(weights);
      const total = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1.0, 5);
    });

    it('should return same weights if already normalized', () => {
      const weights = {
        education: 0.15,
        experience: 0.25,
        skills: 0.25,
        company: 0.15,
        growth: 0.10,
        personality: 0.10,
      };
      const normalized = normalizeWeights(weights);
      expect(normalized).toEqual(weights);
    });
  });

  describe('scoreDimension', () => {
    it('should return correct level and weighted score', () => {
      const result = scoreDimension('education', 90, 0.15, '顶尖院校');

      expect(result.rawScore).toBe(90);
      expect(result.level).toBe('excellent');
      expect(result.weightedScore).toBe(14);
      expect(result.weight).toBe(0.15);
      expect(result.def.label).toBe('学历与绩点');
    });

    it('should extract highlights for good scores', () => {
      const result = scoreDimension('company', 85, 0.15, '大厂经验，知名公司');
      expect(result.highlights.length).toBeGreaterThan(0);
    });
  });
});
