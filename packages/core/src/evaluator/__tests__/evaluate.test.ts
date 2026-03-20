// @hireclaw/core/evaluator — 测试
//
// 验证评估引擎在各种候选人场景下的打分行为

import { evaluate, evaluateBatch, EVALUATION_DIMENSIONS } from '../index.js';
import type { Candidate, JobConfig } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

function makeCandidate(overrides: Partial<Candidate> & { name: string }): Candidate {
  return {
    id: 'test-1',
    platform: 'boss',
    profile: {
      education: [],
      experience: [],
      skills: [],
      ext: {},
    },
    source: {},
    ...overrides,
  };
}

const AI_JOB: JobConfig = {
  id: '1',
  title: 'AI算法工程师',
  platforms: ['boss'],
  description: '负责大模型训练、RAG系统搭建、模型微调。要求熟悉PyTorch、Transformers，有大模型相关经验优先。',
};

// ────────────────────────────────────────────────────────────
// Test Cases
// ────────────────────────────────────────────────────────────

console.log('\n📋 @hireclaw/core/evaluator Tests\n');

// 1. 顶级候选人
console.log('--- 顶级候选人（清华博士 + 字节 + PyTorch）---');
{
  const result = evaluate(
    makeCandidate({
      name: '张三',
      profile: {
        education: [
          { school: '清华大学', degree: '博士', major: '计算机', gpa: 3.9, isTopSchool: true },
        ],
        experience: [
          { company: '字节跳动', title: '高级AI工程师', description: '负责大模型训练，模型性能提升40%', isTopCompany: true },
        ],
        skills: ['PyTorch', 'Transformers', '大模型', 'RAG', 'LLM微调'],
        ext: { github: { repos: 15, recentCommits: true } },
      },
    }),
    AI_JOB
  );

  assert(result.score >= 85, `分数 ${result.score} ≥ 85`);
  assert(result.passed, '通过标准模式评估');
  assert(result.vetoed.length === 0, '无否决项');
  assert(result.priority === 'critical' || result.priority === 'high', `优先级: ${result.priority}`);
  console.log(`    综合评分: ${result.score} | 各维度: ${result.dimensions.map(d => `${d.name}=${d.score}`).join(', ')}`);
}

// 2. 普通候选人
console.log('\n--- 普通候选人（211硕士 + 小公司）---');
{
  const result = evaluate(
    makeCandidate({
      name: '李四',
      profile: {
        education: [
          { school: '南京大学', degree: '硕士', major: '软件工程', gpa: 3.5 },
        ],
        experience: [
          { company: '某科技公司', title: '后端工程师', description: '参与了推荐系统的开发' },
        ],
        skills: ['Python', 'Java', '机器学习'],
        ext: {},
      },
    }),
    AI_JOB
  );

  assert(result.score >= 50, `分数 ${result.score} ≥ 50`);
  console.log(`    综合评分: ${result.score} | 通过: ${result.passed}`);
}

// 3. 一票否决（学历一般且无亮点）
console.log('\n--- 一票否决（学历一般 + 无亮点）---');
{
  const result = evaluate(
    makeCandidate({
      name: '王五',
      profile: {
        education: [
          { school: '某普通二本', degree: '本科', major: '信息管理' },
        ],
        experience: [
          { company: '某小公司', title: '测试', description: '参与了测试工作' },
        ],
        skills: ['Excel', 'Word'],
        ext: {},
      },
    }),
    AI_JOB
  );

  assert(result.vetoed.length > 0, `触发否决: ${result.vetoed.join(', ')}`);
  assert(!result.passed, '应被否决');
  console.log(`    综合评分: ${result.score} | 否决项: ${result.vetoed.join(', ')}`);
}

// 4. 严格 vs 宽松模式
console.log('\n--- 严格度对比（同一个候选人）---');
{
  const candidate = makeCandidate({
    name: '赵六',
    profile: {
      education: [{ school: '武汉大学', degree: '硕士', gpa: 3.4 }],
      experience: [{ company: '商汤科技', title: '算法工程师', description: '负责CV模型训练，准确率提升15%', isTopCompany: true }],
      skills: ['PyTorch', 'OpenCV', '深度学习'],
      ext: { personalProject: true },
    },
  });

  const strictResult = evaluate(candidate, AI_JOB, { config: { strictness: 'strict' } });
  const relaxedResult = evaluate(candidate, AI_JOB, { config: { strictness: 'relaxed' } });

  assert(strictResult.threshold === 85, `严格阈值: ${strictResult.threshold}`);
  assert(relaxedResult.threshold === 70, `宽松阈值: ${relaxedResult.threshold}`);
  console.log(`    严格模式: ${strictResult.score}/${strictResult.threshold} → ${strictResult.passed ? '通过' : '未通过'}`);
  console.log(`    宽松模式: ${relaxedResult.score}/${relaxedResult.threshold} → ${relaxedResult.passed ? '通过' : '未通过'}`);
}

// 5. 加分项（985博士）
console.log('\n--- 加分项（985博士 + 大厂 + AI经验）---');
{
  const result = evaluate(
    makeCandidate({
      name: '孙七',
      profile: {
        education: [
          { school: '北京大学', degree: '博士', major: 'AI', isTopSchool: true },
        ],
        experience: [
          { company: '腾讯', title: 'AI研究员', description: '主导大模型预训练项目', isTopCompany: true },
        ],
        skills: ['PyTorch', '大模型', 'NLP', 'LLM'],
        ext: {},
      },
    }),
    AI_JOB
  );

  assert(result.bonuses.length >= 2, `加分项: ${result.bonuses.map(b => b.rule).join(', ')}`);
  console.log(`    综合评分: ${result.score} | 加分项: ${JSON.stringify(result.bonuses)}`);
}

// 6. 批量评估
console.log('\n--- 批量评估（5个候选人排序）---');
{
  const candidates = [
    makeCandidate({ name: '顶级', profile: { education: [{ school: '清华大学', degree: '博士', gpa: 3.9 }], experience: [{ company: '字节跳动', title: '高级', description: '主导大模型项目' }], skills: ['PyTorch', 'LLM'], ext: {} } }),
    makeCandidate({ name: '中等', profile: { education: [{ school: '武汉理工大学', degree: '硕士' }], experience: [{ company: '普通公司', title: '开发', description: '参与后端开发' }], skills: ['Python'], ext: {} } }),
    makeCandidate({ name: '较弱', profile: { education: [{ school: '某学院', degree: '本科' }], experience: [{ company: '小公司', title: '测试' }], skills: ['Excel'], ext: {} } }),
  ];

  const results = evaluateBatch(candidates, AI_JOB);
  assert(results[0].candidate.name === '顶级', `排名第1: ${results[0].candidate.name}`);
  assert(results[results.length - 1].candidate.name === '较弱', `排名最后: ${results[results.length - 1].candidate.name}`);
  console.log(`    排序: ${results.map(r => `${r.candidate.name}=${r.result.score}`).join(' > ')}`);
}

// 7. 维度定义
console.log('\n--- 评估维度定义---');
{
  assert(EVALUATION_DIMENSIONS.length === 6, `共 ${EVALUATION_DIMENSIONS.length} 个维度`);
  assert(EVALUATION_DIMENSIONS[0].name === 'education', '第一维度: education');
  console.log(`    维度: ${EVALUATION_DIMENSIONS.map(d => d.name).join(', ')}`);
}

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`✅ ${passed} passed | ❌ ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
