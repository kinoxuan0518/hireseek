// @hireclaw/core/outreach — Tests

import {
  generateMessage,
  classifyTier,
  planOutreach,
  planOutreachBatch,
  calculateFunnel,
} from '../index.js';
import type { Candidate, EvaluationResult, OutreachRecord } from '../../types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}

function makeCandidate(overrides: Partial<Candidate> & { name: string }): Candidate {
  return {
    id: 'test-1',
    platform: 'boss',
    profile: { education: [], experience: [], skills: [], ext: {} },
    source: {},
    ...overrides,
  };
}

function makeEval(score: number, vetoed: string[] = []): EvaluationResult {
  return {
    score,
    passed: score >= 80 && vetoed.length === 0,
    threshold: 80,
    dimensions: [],
    vetoed,
    bonuses: [],
    priority: score >= 90 ? 'critical' : score >= 80 ? 'high' : score >= 65 ? 'medium' : 'low',
  };
}

const AI_JOB = {
  id: '1',
  title: 'AI算法工程师',
  platforms: ['boss'],
  description: '负责大模型训练、RAG系统搭建。要求熟悉PyTorch、Transformers。',
};

console.log('\n📋 @hireclaw/core/outreach Tests\n');

// 1. 段位分类
console.log('--- 段位分类 ---');
{
  assert(classifyTier(makeEval(95)) === 'critical', '95分 → critical');
  assert(classifyTier(makeEval(85)) === 'high', '85分 → high');
  assert(classifyTier(makeEval(72)) === 'medium', '72分 → medium');
  assert(classifyTier(makeEval(50)) === 'low', '50分 → low');
  assert(classifyTier(makeEval(95, ['学历一般'])) === 'high', '95分但有否决 → 降为high');
}

// 2. 话术生成 — Level 4（顶级候选人）
console.log('\n--- 话术生成：Level 4（清华博士 + 字节，有量化成果）---');
{
  const candidate = makeCandidate({
    name: '张三',
    profile: {
      education: [{ school: '清华大学', degree: '博士', major: 'AI', gpa: 3.9 }],
      experience: [{ company: '字节跳动', title: '高级算法', description: '主导大模型训练，性能提升40%', isTopCompany: true }],
      skills: ['PyTorch', 'LLM', 'Transformers'],
      ext: {},
    },
  });

  const msg = generateMessage({
    candidate,
    evaluation: makeEval(98),
    job: AI_JOB,
    tier: 'critical',
    attemptNumber: 1,
  });

  assert(msg.level === 4, `话术层次: ${msg.level} (期望4)`);
  assert(msg.content.includes('张三'), `包含候选人姓名`);
  assert(msg.content.length > 30, `消息长度: ${msg.content.length} (期望>30)`);
  assert(msg.reasoning.length > 0, `推理: ${msg.reasoning}`);
  assert(!!msg.suggestedTime, `建议时间: ${msg.suggestedTime}`);
  console.log(`    话术: ${msg.content.slice(0, 80)}...`);
}

// 3. 话术生成 — Level 2（信息有限的候选人）
console.log('\n--- 话术生成：Level 2（普通候选人，信息有限）---');
{
  const candidate = makeCandidate({
    name: '李四',
    profile: {
      education: [{ school: '某大学', degree: '硕士' }],
      experience: [{ company: '某公司', title: '开发' }],
      skills: ['Python'],
      ext: {},
    },
  });

  const msg = generateMessage({
    candidate,
    evaluation: makeEval(65),
    job: AI_JOB,
    tier: 'medium',
    attemptNumber: 1,
  });

  assert(msg.level >= 2, `话术层次: ${msg.level} (期望≥2)`);
  assert(msg.content.includes('李四'), `包含姓名`);
  console.log(`    话术: ${msg.content.slice(0, 80)}...`);
}

// 4. 话术生成 — 首次 vs 再次触达
console.log('\n--- 首次 vs 再次触达 ---');
{
  const candidate = makeCandidate({
    name: '王五',
    profile: {
      education: [{ school: '南京大学', degree: '硕士', major: 'CS' }],
      experience: [{ company: '商汤科技', title: '算法工程师', description: '负责CV模型', isTopCompany: true }],
      skills: ['PyTorch', '深度学习'],
      ext: {},
    },
  });

  const first = generateMessage({
    candidate,
    evaluation: makeEval(85),
    job: AI_JOB,
    tier: 'high',
    attemptNumber: 1,
  });

  const second = generateMessage({
    candidate,
    evaluation: makeEval(85),
    job: AI_JOB,
    tier: 'high',
    attemptNumber: 2,
  });

  assert(first.content !== second.content, '首次和再次触达消息不同');
  console.log(`    首次: ${first.content.slice(0, 50)}...`);
  console.log(`    再次: ${second.content.slice(0, 50)}...`);
}

// 5. 触达计划 — critical 候选人
console.log('\n--- 触达计划：critical 候选人 ---');
{
  const plan = planOutreach(
    makeCandidate({ name: '孙七' }),
    makeEval(92),
    AI_JOB,
    ['boss', 'maimai']
  );

  assert(plan.shouldContact, '应该触达');
  assert(plan.tier === 'critical', `段位: ${plan.tier}`);
  assert(plan.attempts.length >= 3, `计划${plan.attempts.length}次触达`);
  assert(plan.attempts[0].platform === 'boss', `首次平台: ${plan.attempts[0].platform}`);
  console.log(`    计划: ${plan.attempts.map(a => `#${a.attemptNumber}(${a.platform})`).join(' → ')}`);
}

// 6. 触达计划 — medium 候选人
console.log('\n--- 触达计划：medium 候选人 ---');
{
  const plan = planOutreach(
    makeCandidate({ name: '赵八' }),
    makeEval(70),
    AI_JOB
  );

  assert(plan.shouldContact, '应该触达');
  assert(plan.tier === 'medium', `段位: ${plan.tier}`);
  assert(plan.attempts.length === 1, `只触达1次: ${plan.attempts.length}`);
}

// 7. 触达计划 — low 候选人
console.log('\n--- 触达计划：low 候选人 ---');
{
  const plan = planOutreach(
    makeCandidate({ name: '钱九' }),
    makeEval(40),
    AI_JOB
  );

  assert(!plan.shouldContact, '不应该触达');
  assert(plan.attempts.length === 0, '无触达计划');
  console.log(`    原因: ${plan.reason}`);
}

// 8. 触达计划 — 已达上限
console.log('\n--- 触达计划：已达上限 ---');
{
  const records: OutreachRecord[] = [
    { candidateId: 'test-1', platform: 'boss', message: '1', sentAt: '2026-01-01', result: 'sent' },
    { candidateId: 'test-1', platform: 'boss', message: '2', sentAt: '2026-01-05', result: 'sent' },
    { candidateId: 'test-1', platform: 'maimai', message: '3', sentAt: '2026-01-10', result: 'sent' },
  ];

  const plan = planOutreach(
    makeCandidate({ name: '吴十', id: 'test-1' }),
    makeEval(88),
    AI_JOB,
    ['boss', 'maimai'],
    records
  );

  assert(!plan.shouldContact, '已达上限，不再触达');
  console.log(`    原因: ${plan.reason}`);
}

// 9. 批量触达计划
console.log('\n--- 批量触达计划（按优先级排序）---');
{
  const batch = planOutreachBatch(
    [
      { candidate: makeCandidate({ name: 'Low' }), evaluation: makeEval(50) },
      { candidate: makeCandidate({ name: 'Critical' }), evaluation: makeEval(92) },
      { candidate: makeCandidate({ name: 'Medium' }), evaluation: makeEval(70) },
      { candidate: makeCandidate({ name: 'High' }), evaluation: makeEval(82) },
    ],
    AI_JOB,
    { dailyLimit: 10 }
  );

  assert(batch.length === 3, `可触达: ${batch.length} (排除low)`);
  assert(batch[0].candidateName === 'Critical', `第1: ${batch[0].candidateName}`);
  assert(batch[1].candidateName === 'High', `第2: ${batch[1].candidateName}`);
  assert(batch[2].candidateName === 'Medium', `第3: ${batch[2].candidateName}`);
  console.log(`    排序: ${batch.map(p => `${p.candidateName}(${p.tier})`).join(' > ')}`);
}

// 10. 漏斗统计
console.log('\n--- 漏斗统计 ---');
{
  const plans = planOutreachBatch(
    [
      { candidate: makeCandidate({ name: 'A' }), evaluation: makeEval(90) },
      { candidate: makeCandidate({ name: 'B' }), evaluation: makeEval(85) },
      { candidate: makeCandidate({ name: 'C' }), evaluation: makeEval(75) },
      { candidate: makeCandidate({ name: 'D' }), evaluation: makeEval(50) },
    ],
    AI_JOB
  );

  const records: OutreachRecord[] = [
    { candidateId: '1', platform: 'boss', message: '1', sentAt: '2026-01-01', result: 'sent', response: 'replied' },
    { candidateId: '2', platform: 'boss', message: '2', sentAt: '2026-01-01', result: 'sent' },
    { candidateId: '3', platform: 'boss', message: '3', sentAt: '2026-01-01', result: 'sent' },
  ];

  const funnel = calculateFunnel(plans, records);

  assert(funnel.total === 3, `总计划: ${funnel.total}`);
  assert(funnel.contacted === 3, `已触达: ${funnel.contacted}`);
  assert(funnel.replied === 1, `已回复: ${funnel.replied}`);
  assert(Math.abs(funnel.replyRate - 1 / 3) < 0.01, `回复率: ${(funnel.replyRate * 100).toFixed(1)}%`);
  console.log(`    计划${funnel.total}人，触达${funnel.contacted}人，回复${funnel.replied}人，回复率${(funnel.replyRate * 100).toFixed(1)}%`);
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`✅ ${passed} passed | ❌ ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
