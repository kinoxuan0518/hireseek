// test-e2e.mjs — HireClaw E2E test with GLM
//
// Tests three LLM-powered features:
//   3a. Evaluator E2E — evaluateWithLLM()
//   3b. Outreach E2E  — generateMessageWithLLM()
//   3c. Tracking E2E  — CandidateTracker funnel

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────────────────────────────────────────────────
// LLM Config
// ────────────────────────────────────────────────────────────

const llm = {
  provider: 'custom',
  model: 'GLM-5-Turbo',
  apiKey: '0cbcab149d0f4746884084b6e6fba2e0.9NyrOegrBGRFMlso',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

// ────────────────────────────────────────────────────────────
// Import SDK (ESM from dist)
// ────────────────────────────────────────────────────────────

const {
  evaluateWithLLM,
  generateMessageWithLLM,
  classifyTier,
  CandidateTracker,
} = await import('./packages/core/dist/index.js');

// ────────────────────────────────────────────────────────────
// Test Data
// ────────────────────────────────────────────────────────────

const candidate = {
  id: 'e2e-candidate-001',
  name: '李明远',
  platform: 'boss',
  profile: {
    education: [
      {
        school: '清华大学',
        degree: '硕士',
        major: '计算机科学与技术',
        gpa: '3.8/4.0',
        startYear: 2019,
        endYear: 2022,
        isTopSchool: true,
      },
    ],
    experience: [
      {
        company: '字节跳动',
        title: 'AI算法工程师',
        startDate: '2022-07',
        endDate: '至今',
        duration: '2年8个月',
        description: '负责大模型RAG系统的架构设计与落地，包括检索优化、重排序模型训练和知识库管理。基于LangChain构建企业级知识问答系统，服务日均调用量10万+。',
        highlights: [
          '设计并实现RAG pipeline，检索准确率从72%提升至91%',
          '基于BGE模型微调重排序器，NDCG@10提升15%',
          '搭建知识库管理平台，支持多租户和权限控制',
        ],
        isTopCompany: true,
      },
    ],
    skills: ['PyTorch', 'Transformers', 'LangChain', 'RAG', '向量检索', 'BERT', '大模型微调', 'Docker', 'Python'],
    ext: {
      github: 'https://github.com/limingyuan',
      openSourceContributions: '活跃，有多个RAG相关开源项目',
    },
  },
  source: {
    url: 'https://www.zhipin.com/job_detail/xxx',
    rawText: '李明远 | 清华大学硕士 | 字节跳动AI算法工程师\n\n工作经验：\n- 2022.07至今 字节跳动 AI算法工程师\n  负责RAG系统架构设计，检索优化，重排序模型训练\n  日均调用量10万+\n  检索准确率72%→91%\n\n技能：PyTorch, Transformers, LangChain, RAG, 向量检索, BERT, 大模型微调',
  },
};

const job = {
  id: 'e2e-job-001',
  title: 'AI算法工程师',
  department: 'AI Lab',
  location: '北京',
  description: '负责大模型训练、RAG系统搭建、模型微调。要求熟悉PyTorch、Transformers，有大模型相关经验优先。',
  salary: { min: 40, max: 70, currency: 'CNY', period: 'month' },
  platforms: ['boss', 'maimai'],
  outreach: {
    style: 'warm',
    companyHighlights: [
      '早期创业团队，核心成员来自字节、阿里',
      '专注AI Native应用，产品已上线且有付费用户',
      '技术栈前沿：大模型+RAG+Agent',
    ],
  },
};

// ────────────────────────────────────────────────────────────
// 3a. Evaluator E2E
// ────────────────────────────────────────────────────────────

console.log('='.repeat(70));
console.log('3a. Evaluator E2E — evaluateWithLLM()');
console.log('='.repeat(70));

const evaluationGuidePath = resolve(__dirname, 'workspace/references/candidate-evaluation.md');
let evaluationGuide;
try {
  evaluationGuide = readFileSync(evaluationGuidePath, 'utf-8');
  console.log(`📋 Loaded evaluation guide: ${evaluationGuidePath} (${evaluationGuide.length} chars)`);
} catch (err) {
  console.warn(`⚠️  Could not load evaluation guide: ${err.message}`);
}

const evalResult = await evaluateWithLLM(candidate, job, {
  llm,
  evaluationGuidePath,
  systemPromptAdditions: evaluationGuide
    ? `\n\n## 评估指南参考\n${evaluationGuide.slice(0, 2000)}`
    : undefined,
});

console.log('\n📊 EvaluationResult:');
console.log(JSON.stringify(evalResult, null, 2));
console.log(`\n✅ Score: ${evalResult.score}/100 | Passed: ${evalResult.passed} | Priority: ${evalResult.priority}`);

// ────────────────────────────────────────────────────────────
// 3b. Outreach E2E
// ────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('3b. Outreach E2E — generateMessageWithLLM()');
console.log('='.repeat(70));

const outreachGuidePath = resolve(__dirname, 'workspace/references/outreach-guide.md');
let outreachGuide;
try {
  outreachGuide = readFileSync(outreachGuidePath, 'utf-8');
  console.log(`📋 Loaded outreach guide: ${outreachGuidePath} (${outreachGuide.length} chars)`);
} catch (err) {
  console.warn(`⚠️  Could not load outreach guide: ${err.message}`);
}

const tier = classifyTier(evalResult);
console.log(`🏷️  Tier: ${tier} (score: ${evalResult.score})`);

let outreachResult;
const maxRetries = 3;
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    outreachResult = await generateMessageWithLLM({
      candidate,
      evaluation: evalResult,
      job,
      tier,
      attemptNumber: 1,
      brandTone: job.outreach?.companyHighlights?.join('；'),
      llm,
    });
    break;
  } catch (err) {
    console.warn(`⚠️  Outreach attempt ${attempt}/${maxRetries} failed: ${err.message}`);
    if (attempt === maxRetries) throw err;
  }
}
if (!outreachResult) throw new Error('Outreach generation failed after retries');

console.log('\n💬 OutreachMessage:');
console.log(JSON.stringify(outreachResult, null, 2));
console.log(`\n✅ Level: ${outreachResult.level}/4 | Content length: ${outreachResult.content.length} chars`);

// ────────────────────────────────────────────────────────────
// 3c. Tracking E2E
// ────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('3c. Tracking E2E — CandidateTracker');
console.log('='.repeat(70));

// Use a temp path so we don't pollute real data
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const trackerStoragePath = join(tmpdir(), `hireclaw-e2e-tracking-${Date.now()}.json`);

const tracker = new CandidateTracker({ storagePath: trackerStoragePath });
await tracker.init();
console.log(`📂 Tracker initialized with storage: ${trackerStoragePath}`);

// Register candidates
tracker.register('c1', '李明远', 'boss');
tracker.register('c2', '王芳芳', 'maimai');
tracker.register('c3', '张伟', 'boss');
tracker.register('c4', '赵小红', 'linkedin');
console.log('✅ Registered 4 candidates');

// Status flow for c1: new → contacted → replied → screening
tracker.recordOutreach('c1', { type: 'sent', platform: 'boss', content: '你好，看了你的经历…', result: 'sent' });
console.log('  c1: new → contacted (outreach sent)');

tracker.recordOutreach('c1', { type: 'received', platform: 'boss', result: 'replied' });
console.log('  c1: contacted → replied (received reply)');

tracker.transition('c1', 'screening', '安排初试');
console.log('  c1: replied → screening');

// Status flow for c2: new → contacted → dropped
tracker.recordOutreach('c2', { type: 'sent', platform: 'maimai', content: '你好…', result: 'sent' });
console.log('  c2: new → contacted');

tracker.transition('c2', 'dropped', '不合适');
console.log('  c2: contacted → dropped');

// c3 stays at new
console.log('  c3: new (no action)');

// c4: new → contacted
tracker.recordOutreach('c4', { type: 'sent', platform: 'linkedin', content: 'Hi…', result: 'sent' });
console.log('  c4: new → contacted');

// Save and verify
await tracker.save();
console.log(`\n💾 Saved to ${trackerStoragePath}`);

// Get follow-up reminders
console.log('\n🔔 Follow-up Reminders:');
const reminders = tracker.getFollowUpReminders({ maxDaysSinceActivity: 0 }); // 0 days to show all non-terminal
if (reminders.length === 0) {
  console.log('  (None — all candidates have recent activity)');
} else {
  for (const r of reminders) {
    console.log(`  - ${r.candidateName} (${r.status}): ${r.daysSinceActivity}d since activity → ${r.suggestedAction} [${r.priority}]`);
  }
}

// Get funnel stats
console.log('\n📊 Funnel Stats:');
const stats = tracker.getFunnelStats();
for (const [status, count] of Object.entries(stats)) {
  if (count > 0) {
    console.log(`  ${status}: ${count}`);
  }
}

// Verify total
const total = Object.values(stats).reduce((a, b) => a + b, 0);
console.log(`\n✅ Total candidates in funnel: ${total}`);

// Clean up
import { unlinkSync } from 'node:fs';
try { unlinkSync(trackerStoragePath); } catch {}

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('🎉 E2E Test Complete');
console.log('='.repeat(70));
console.log('  ✅ 3a. Evaluator — score:', evalResult.score, '| passed:', evalResult.passed, '| priority:', evalResult.priority);
console.log('  ✅ 3b. Outreach  — level:', outreachResult.level, '| chars:', outreachResult.content.length);
console.log('  ✅ 3c. Tracking  — total:', total, '| screening:', stats.screening, '| dropped:', stats.dropped);
console.log('='.repeat(70));
