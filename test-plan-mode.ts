/**
 * 测试计划模式
 * 只生成计划并展示，不实际执行任务
 */

import 'dotenv/config';
import { generatePlan, confirmPlan } from './src/planner';
import { db } from './src/db';

async function testPlanMode() {
  console.log('\n🧪 测试计划模式...\n');

  try {
    // 1. 生成计划
    console.log('Step 1: 生成执行计划...');
    const plan = await generatePlan('AI_算法工程师');

    // 2. 展示计划
    console.log('\nStep 2: 展示计划给用户确认...\n');
    const confirmed = await confirmPlan(plan);

    if (confirmed) {
      console.log('\n✅ 测试成功！用户确认了计划');
      console.log('\n实际运行时，会执行以下任务：');
      plan.channels
        .filter(c => !c.skipReason)
        .forEach(c => {
          console.log(`  - ${c.channel}[${c.accountIndex + 1}]: 目标 ${c.targetCount} 人`);
        });
    } else {
      console.log('\n⏭️  用户取消了执行');
    }

    console.log('\n🎉 测试完成！\n');
  } catch (err: any) {
    console.error('\n❌ 测试失败:', err.message);
    console.error(err.stack);
  } finally {
    db.close();
  }
}

testPlanMode();
