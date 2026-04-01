// @hireclaw/core/pipeline/stages — Tests

import { describe, it, expect } from 'vitest';
import { STAGE_METADATA, type StageId } from '../Stage.js';

describe('Stage', () => {
  describe('STAGE_METADATA', () => {
    it('should have all 7 stages', () => {
      const expectedStages: StageId[] = ['discover', 'evaluate', 'filter', 'plan', 'outreach', 'followup', 'complete'];
      expect(Object.keys(STAGE_METADATA).sort()).toEqual(expectedStages.sort());
    });

    it('should have labels for all stages', () => {
      for (const stage of Object.values(STAGE_METADATA)) {
        expect(stage.label).toBeDefined();
        expect(stage.label.length).toBeGreaterThan(0);
      }
    });

    it('should have descriptions for all stages', () => {
      for (const stage of Object.values(STAGE_METADATA)) {
        expect(stage.description).toBeDefined();
        expect(stage.description.length).toBeGreaterThan(0);
      }
    });

    it('should have outputs defined for all stages', () => {
      for (const stage of Object.values(STAGE_METADATA)) {
        expect(stage.outputs).toBeDefined();
        expect(stage.outputs.length).toBeGreaterThan(0);
      }
    });

    it('should have discover outputs', () => {
      const discover = STAGE_METADATA.discover;
      expect(discover.outputs).toContain('candidates[]');
      expect(discover.outputs).toContain('platformStatus');
    });

    it('should have evaluate outputs', () => {
      const evaluate = STAGE_METADATA.evaluate;
      expect(evaluate.outputs).toContain('evaluationResults[]');
      expect(evaluate.outputs).toContain('passedCandidates[]');
    });

    it('should have outreach outputs', () => {
      const outreach = STAGE_METADATA.outreach;
      expect(outreach.outputs).toContain('outreachRecords[]');
      expect(outreach.outputs).toContain('sentCount');
    });

    it('should have complete with no config fields', () => {
      const complete = STAGE_METADATA.complete;
      expect(complete.configFields).toEqual([]);
    });
  });
});
