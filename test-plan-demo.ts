/**
 * 演示计划模式的展示效果（使用模拟数据，不调用 API）
 */

import { confirmPlan } from './src/planner';
import type { ExecutionPlan } from './src/planner';

async function demoPlanMode() {
  console.log('\n🎬 演示计划模式...\n');

  // 模拟一个执行计划
  const mockPlan: ExecutionPlan = {
    jobTitle: 'AI 算法工程师',
    dailyGoal: 30,
    totalTargetToday: 20,
    channels: [
      {
        channel: 'boss',
        accountId: 'boss_1',
        accountIndex: 0,
        targetCount: 20,
        strategy: '重点关注 3 年以上 LLM/RAG/Agent 经验，985/211 优先，有落地项目经验的候选人',
        priority: 1,
      },
      {
        channel: 'maimai',
        accountId: 'maimai_1',
        accountIndex: 0,
        targetCount: 0,
        strategy: '',
        priority: 999,
        skipReason: '今日已触达 15 人，达到该渠道目标（每日目标 30 人已完成 50%）',
      },
    ],
    estimatedDurationMin: 25,
    reasoning: `基于历史数据分析：
- BOSS直聘质量较高，平均跳过率 30%，今日还需触达 20 人
- 脉脉今日已触达 15 人，建议暂停该渠道，避免重复触达
- 预计 25 分钟完成 BOSS 渠道的 20 人触达，达到今日总目标`,
    createdAt: new Date().toISOString(),
  };

  console.log('📋 以下是 AI 生成的执行计划：\n');

  // 展示计划并等待用户确认
  const confirmed = await confirmPlan(mockPlan);

  if (confirmed) {
    console.log('\n✅ 计划已确认！');
    console.log('\n实际运行时，会执行：');
    console.log('  1. 创建 BOSS直聘[1] 的浏览器标签页');
    console.log('  2. 加载已保存的登录状态（或引导登录）');
    console.log('  3. AI 自动筛选和触达候选人（目标 20 人）');
    console.log('  4. 保存结果到数据库');
    console.log('  5. 生成反思并发送报告\n');
  } else {
    console.log('\n⏭️  计划已取消\n');
  }

  console.log('🎉 演示完成！\n');
  console.log('💡 实际使用：hireclaw run --plan\n');
}

demoPlanMode().catch(console.error);
