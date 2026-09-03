import './dsh-env';
import { describe, expect, it } from 'vitest';
import { parseScreenReadingDepth } from '../src/runners/dom-runner';
import { extractInterviewFeedback, interviewerName } from '../src/channels/feishu-hire';

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

// 下面两份样例直接照搬飞书开放平台文档的响应体示例，字段名不是猜的。
// v1: hire/v1/interview_records/:id ; v2: hire/v2/interview_records/:id
const V1_RECORD = {
  id: '6949805467799537964',
  user_id: 'ou_266ed047ed37f24554e5a0afdbb15556',
  content: 'The code is ok, just not smart enough',
  commit_status: 1,
  conclusion: 1,
  interview_score: {
    id: '6949805467799537964',
    level: 3,
    zh_name: '三',
    zh_description: '通过, 能力达到要求, 建议录用',
    en_name: 'three',
    en_description: 'Pass, ability to meet the requirements, suggest to hire',
  },
  interviewer: { id: 'ou_266ed', name: { zh_cn: '苏乞儿', en_us: 'Cheer Su' } },
  dimension_assessment_list: [
    {
      id: '6949805467799537964',
      name: { zh_cn: '合规测试', en_us: 'Compliance testing' },
      content: 'This candidate is not bad',
      dimension_id: '6949805467799537964',
      dimension_score: { id: 'x', name: { zh_cn: '通过', en_us: 'Approve' } },
      dimension_type: 1,
    },
  ],
};

const V2_RECORD = {
  id: '7171693733661327361',
  feedback_form_id: '71716937336613273612',
  commit_status: 1,
  submit_time: '1710405457390',
  record_score: { score: 100.0, total_score: 100.0 },
  interviewer: { id: '7171693733661327364', name: { zh_cn: '小明', en_us: 'xiaoming' } },
  attachments: [{ file_id: '714051', file_name: '1.13测试1的面试记录.pdf', content_type: 'application/pdf' }],
  module_assessments: [
    {
      interview_feedback_form_module_id: '7171693733661327361',
      module_name: { zh_cn: '面试记录', en_us: 'Interview Result' },
      module_type: 1,
      dimension_assessments: [
        {
          interview_feedback_form_dimension_id: '7171693733661327361',
          dimension_name: { zh_cn: '行业知识储备水平', en_us: 'Industry knowledge reserve level' },
          dimension_type: 1,
          dimension_content: '描述题作答',
          dimension_option: { id: 'x', name: { zh_cn: '选项一', en_us: 'Option 1' }, score_val: 10 },
          recommended_job_level: {
            lower_limit_job_level_name: { zh_cn: '2-2', en_us: '2-2' },
            higher_limit_job_level_name: { zh_cn: '3-2', en_us: 'te3-2' },
          },
          question_assessments: [
            {
              question_type: 1,
              title: { zh_cn: '操作系统进程调度', en_us: 'Operating system process scheduling' },
              description: { zh_cn: '操作系统中如何进行进程调度？', en_us: 'How is process scheduling performed?' },
              content: '操作系统的进程调度是通过...',
            },
          ],
        },
      ],
    },
  ],
};

describe('飞书面评抽取（按开放平台文档结构）', () => {
  it('v1：总评、结论档位、各维度评语都取到', () => {
    const text = extractInterviewFeedback(V1_RECORD);
    expect(text).toContain('面试结论档位：通过, 能力达到要求, 建议录用');
    expect(text).toContain('总评：The code is ok, just not smart enough');
    expect(text).toContain('合规测试（通过）：This candidate is not bad');
  });

  it('v2：描述题作答、选项、职级建议和逐题作答都取到，且带上维度名', () => {
    const text = extractInterviewFeedback(V2_RECORD);
    expect(text).toContain('面试得分：100/100');
    expect(text).toContain('行业知识储备水平：描述题作答；选项一；职级建议 2-2~3-2');
    expect(text).toContain('面试题「操作系统进程调度」候选人作答：操作系统的进程调度是通过...');
  });

  it('不把附件名、模块名这类噪音当评语', () => {
    const text = extractInterviewFeedback(V2_RECORD);
    expect(text).not.toContain('面试记录.pdf');
    expect(text).not.toContain('application/pdf');
  });

  it('面试官姓名是 i18n 对象，取中文名而不是 [object Object]', () => {
    expect(interviewerName(V1_RECORD)).toBe('苏乞儿');
    expect(interviewerName(V2_RECORD)).toBe('小明');
    expect(interviewerName({ interviewer: { name: { en_us: 'Only English' } } })).toBe('Only English');
    expect(interviewerName(null)).toBe('');
  });

  it('没填评价时返回空串，不编造', () => {
    expect(extractInterviewFeedback({ conclusion: 2, commit_status: 2 })).toBe('');
    expect(extractInterviewFeedback(null)).toBe('');
  });

  it('截断超长评语，避免撑爆重校上下文', () => {
    const text = extractInterviewFeedback({ content: '好'.repeat(9000) }, 100);
    expect(text.length).toBe(100);
  });
});
