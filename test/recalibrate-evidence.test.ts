import './dsh-env';
import { beforeAll, describe, expect, it } from 'vitest';

const JOB = 'test-job';
const CHANNEL = 'boss';

function fingerprintOf(name: string, company: string): string {
  return `${name}|${company}|${CHANNEL}`;
}

beforeAll(async () => {
  const { db } = await import('../src/db');
  await import('../src/feedback');

  const seed = (opts: {
    name: string;
    company: string;
    predictedFit: number;
    result: 'passed' | 'failed';
    screen?: {
      evidence: string;
      fitTags: string[];
      riskFlags: string[];
      readingDepth: 'card' | 'detail';
      resumeDigest?: string;
      coherenceVerdict?: string;
      coherenceNote?: string;
    };
    interviewer?: string;
    feedback?: string;
  }) => {
    const fp = fingerprintOf(opts.name, opts.company);
    db.prepare(`
      INSERT OR REPLACE INTO candidates (fingerprint, name, company, channel, job_id, status, score)
      VALUES (?, ?, ?, ?, ?, 'contacted', ?)
    `).run(fp, opts.name, opts.company, CHANNEL, JOB, opts.predictedFit);

    db.prepare(`
      INSERT OR REPLACE INTO fit_predictions (fingerprint, name, job_id, predicted_fit, doer_score)
      VALUES (?, ?, ?, ?, ?)
    `).run(fp, opts.name, JOB, opts.predictedFit, opts.predictedFit);

    db.prepare(`
      INSERT OR REPLACE INTO interview_outcomes (fingerprint, name, job_id, result, note, interviewer, feedback)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(fp, opts.name, JOB, opts.result, '飞书招聘', opts.interviewer ?? null, opts.feedback ?? null);

    if (opts.screen) {
      db.prepare(`
        INSERT OR REPLACE INTO screen_candidates
          (run_id, candidate_fingerprint, job_id, channel, recommendation, score, evidence, risk_flags, fit_tags,
           profile_url, reading_depth, resume_digest, coherence_verdict, coherence_note)
        VALUES (?, ?, ?, ?, 'contact', ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(
        1,
        fp,
        JOB,
        CHANNEL,
        opts.predictedFit,
        opts.screen.evidence,
        JSON.stringify(opts.screen.riskFlags),
        JSON.stringify(opts.screen.fitTags),
        opts.screen.readingDepth,
        opts.screen.resumeDigest ?? null,
        opts.screen.coherenceVerdict ?? null,
        opts.screen.coherenceNote ?? null,
      );
    }
  };

  seed({
    name: '深读过的人',
    company: '大厂A',
    predictedFit: 82,
    result: 'failed',
    screen: {
      evidence: '三段经历都在做供应链履约调度，最近一段负责端到端落地。',
      fitTags: ['供应链', '端到端交付'],
      riskFlags: ['缺少团队规模信息'],
      readingDepth: 'detail',
      resumeDigest: '本科物流工程，先后在两家公司做履约调度，最近主导过一次全量切换。',
      coherenceVerdict: 'aligned',
      coherenceNote: '每次跳槽都往更靠近履约核心的方向走，没有横向漂移。',
    },
    interviewer: '张三',
    feedback: '简历上的项目问到细节答不上来，实际参与深度存疑。',
  });

  seed({
    name: '只看卡片的人',
    company: '大厂B',
    predictedFit: 40,
    result: 'passed',
    screen: {
      evidence: '卡片显示 3 年经验、当前在大厂B。',
      fitTags: ['大厂背景'],
      riskFlags: [],
      readingDepth: 'card',
    },
  });
});

describe('重校证据：当初凭什么判 × 后来真的怎么样', () => {
  it('把筛选依据、读取深度、合拍性和面试官评语一起取出来', async () => {
    const { gatherOutcomeEvidence } = await import('../src/evolution/recalibrate');
    const rows = gatherOutcomeEvidence(JOB);
    const deep = rows.find(r => r.name === '深读过的人');

    expect(deep).toBeDefined();
    expect(deep!.reading_depth).toBe('detail');
    expect(deep!.screen_evidence).toContain('履约调度');
    expect(deep!.coherence_verdict).toBe('aligned');
    expect(deep!.resume_digest).toContain('物流工程');
    expect(deep!.interviewer).toBe('张三');
    expect(deep!.feedback).toContain('参与深度存疑');
  });

  it('没有深读的人如实记为 card，不伪装成读过', async () => {
    const { gatherOutcomeEvidence } = await import('../src/evolution/recalibrate');
    const shallow = gatherOutcomeEvidence(JOB).find(r => r.name === '只看卡片的人');

    expect(shallow!.reading_depth).toBe('card');
    expect(shallow!.resume_digest).toBeNull();
    expect(shallow!.feedback).toBeNull();
  });

  it('卷宗文本把信号摊开给重校官，而不只给姓名公司学校', async () => {
    const { gatherOutcomeEvidence, formatOutcomeRow } = await import('../src/evolution/recalibrate');
    const deep = gatherOutcomeEvidence(JOB).find(r => r.name === '深读过的人')!;
    const dossier = formatOutcomeRow(deep);

    expect(dossier).toContain('判断时读到：通读简历详情');
    expect(dossier).toContain('筛选依据：');
    expect(dossier).toContain('命中标签：供应链、端到端交付');
    expect(dossier).toContain('当时的风险标记：缺少团队规模信息');
    expect(dossier).toContain('整份简历合拍性：整体合拍');
    expect(dossier).toContain('面试官评语（张三）：');
    expect(dossier).toContain('挂面❌');
  });
});
