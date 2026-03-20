// @hireclaw/core/pipeline — Tests

import { Pipeline } from '../index.js';
import type {
  PlatformAdapter,
  Candidate,
  JobConfig,
} from '../../types.js';
import type { PipelineEvent } from '../index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.log(`  ❌ ${message}`); }
}

// ── Mock Adapter ──

function createMockAdapter(name: string, candidates: Candidate[]): PlatformAdapter {
  return {
    name,
    async getCandidates() {
      return { candidates: [...candidates], hasMore: false };
    },
    async reachOut({ candidate }) {
      return { success: true, candidateId: candidate.id };
    },
    async getConversationStatus() { return 'uncontacted'; },
    async getStatus() {
      return { platform: name, loggedIn: true, rateLimited: false, accountStatus: 'active' };
    },
  };
}

function makeCandidate(id: string, name: string, score: number): Candidate {
  const isTop = score >= 85;
  return {
    id,
    name,
    platform: 'boss',
    profile: {
      education: isTop ? [{ school: '清华大学', degree: '博士', major: 'CS', gpa: 3.9 }] : [{ school: '某大学', degree: '本科' }],
      experience: isTop ? [{ company: '字节跳动', title: '高级工程师', description: '主导项目' }] : [{ company: '某公司', title: '开发' }],
      skills: isTop ? ['PyTorch', 'LLM'] : ['Python'],
      ext: {},
    },
    source: {},
  };
}

const JOB: JobConfig = {
  id: '1',
  title: 'AI算法工程师',
  platforms: ['boss'],
  description: '负责大模型训练。要求熟悉PyTorch。',
};

console.log('\n📋 @hireclaw/core/pipeline Tests\n');

// 1. 基本流水线 — dry run
console.log('--- 基本流水线（dry run）---');
{
  const pipeline = new Pipeline();
  pipeline.use(createMockAdapter('boss', [
    makeCandidate('1', '张三', 95),
    makeCandidate('2', '李四', 80),
    makeCandidate('3', '王五', 50),
  ]));

  const events: PipelineEvent[] = [];
  const result = await pipeline.run(
    { job: JOB, platforms: ['boss'] },
    { dryRun: true, onEvent: e => events.push(e) }
  );

  assert(result.totalCandidates === 3, `获取${result.totalCandidates}人`);
  assert(result.totalEvaluated === 3, `评估${result.totalEvaluated}人`);
  assert(result.totalPassed >= 1, `通过${result.totalPassed}人`);
  assert(result.status === 'completed', `状态: ${result.status}`);
  assert(result.platformResults.length === 1, `1个平台结果`);
  assert(events.length > 0, `${events.length}个事件`);
  console.log(`    事件流: ${events.map(e => e.type).join(' → ')}`);
}

// 2. 实际触达（非 dry run）
console.log('\n--- 实际触达模式 ---');
{
  const pipeline = new Pipeline();
  pipeline.use(createMockAdapter('boss', [
    makeCandidate('1', '张三', 92),
    makeCandidate('2', '李四', 85),
  ]));

  const result = await pipeline.run(
    { job: JOB, platforms: ['boss'] },
    { dryRun: false }
  );

  assert(result.totalReached >= 1, `触达${result.totalReached}人`);
  assert(result.errors.length === 0, `无错误`);
}

// 3. 多平台
console.log('\n--- 多平台流水线 ---');
{
  const pipeline = new Pipeline();
  pipeline.use(createMockAdapter('boss', [makeCandidate('1', '张三', 90)]));
  pipeline.use(createMockAdapter('maimai', [makeCandidate('2', '李四', 88)]));

  const result = await pipeline.run(
    { job: JOB, platforms: ['boss', 'maimai'] },
    { dryRun: true }
  );

  assert(result.totalCandidates === 2, `获取${result.totalCandidates}人`);
  assert(result.platformResults.length === 2, `${result.platformResults.length}个平台`);
}

// 4. 未注册平台
console.log('\n--- 未注册平台（优雅降级）---');
{
  const pipeline = new Pipeline();
  pipeline.use(createMockAdapter('boss', []));

  const result = await pipeline.run(
    { job: JOB, platforms: ['boss', 'linkedin'] },
    { dryRun: true }
  );

  assert(result.platformResults.length === 2, `${result.platformResults.length}个平台结果（含错误）`);
  console.log(`    平台结果: ${result.platformResults.map(p => p.platform).join(', ')}`);
  assert(result.errors.length === 1, `1个错误（linkedin未注册）`);
  assert(result.errors[0].recoverable, '错误可恢复');
}

// 5. evaluateOnly
console.log('\n--- evaluateOnly（只评估不触达）---');
{
  const pipeline = new Pipeline();
  pipeline.use(createMockAdapter('boss', [
    makeCandidate('1', '张三', 92),
    makeCandidate('2', '李四', 60),
  ]));

  const results = await pipeline.evaluateOnly(JOB, ['boss']);

  assert(results.length === 2, `评估${results.length}人`);
  assert(results[0].result.score >= results[1].result.score, `按分数排序: ${results[0].result.score} > ${results[1].result.score}`);
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`✅ ${passed} passed | ❌ ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
