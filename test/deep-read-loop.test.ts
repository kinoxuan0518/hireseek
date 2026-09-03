import './dsh-env';
import { describe, expect, it } from 'vitest';
import { parseScreenReadingDepth } from '../src/runners/dom-runner';
import { extractInterviewFeedback } from '../src/channels/feishu-hire';

describe('深读记录：reading_depth 只认真的带回简历事实的那种', () => {
  it('声明 detail 且给出简历摘要才算深读', () => {
    const parsed = parseScreenReadingDepth({
      reading_depth: 'detail',
      resume_digest: '三段经历都在做供应链履约，最近一段负责调度算法端到端落地。',
      coherence_verdict: 'aligned',
      coherence_note: '每次跳槽都往更靠近履约核心的方向走，没有横向漂移。',
    });
    expect(parsed.readingDepth).toBe('detail');
    expect(parsed.coherenceVerdict).toBe('aligned');
    expect(parsed.resumeDigest).toContain('供应链履约');
  });

  it('只声明读过详情但拿不出摘要，降级按卡片记', () => {
    const parsed = parseScreenReadingDepth({ reading_depth: 'detail' });
    expect(parsed.readingDepth).toBe('card');
    expect(parsed.resumeDigest).toBeUndefined();
  });

  it('缺省和非法取值都按卡片记，合拍性非法枚举丢弃', () => {
    expect(parseScreenReadingDepth({}).readingDepth).toBe('card');
    expect(parseScreenReadingDepth({ reading_depth: '认真读了' }).readingDepth).toBe('card');
    expect(parseScreenReadingDepth({ coherence_verdict: '还行' }).coherenceVerdict).toBeUndefined();
  });
});

describe('飞书面试评语抽取', () => {
  it('从面试记录里挖出评语，跳过结论码', () => {
    const record = {
      id: 'rec_1',
      conclusion: '1',
      interviewer: { name: '张三' },
      evaluation: '算法基础扎实，但没做过真实链路的容量规划。',
      interview_score: { level: 3 },
    };
    const text = extractInterviewFeedback(record);
    expect(text).toContain('容量规划');
    expect(text).not.toContain('1');
  });

  it('挖得进评分表单的逐题作答', () => {
    const record = {
      conclusion_status: 2,
      interview_feedback_form: {
        modules: [
          { question: '技术深度', answer: '停留在调包，追问原理答不上来。' },
          { question: '沟通', answer: { content: '表达清楚，愿意承认不知道。' } },
        ],
      },
    };
    const text = extractInterviewFeedback(record);
    expect(text).toContain('追问原理答不上来');
    expect(text).toContain('愿意承认不知道');
  });

  it('没有评语时返回空串，不编造', () => {
    expect(extractInterviewFeedback({ conclusion: '2', interviewer: { name: '李四' } })).toBe('');
    expect(extractInterviewFeedback(null)).toBe('');
  });

  it('截断超长评语，避免撑爆重校上下文', () => {
    const text = extractInterviewFeedback({ evaluation: '好'.repeat(9000) }, 100);
    expect(text.length).toBe(100);
  });
});
