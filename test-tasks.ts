/**
 * 测试任务管理系统
 */

import { createTask, updateTask, displayTaskBoard, displayTask, deleteTask, listAllTasks } from './src/tasks';
import { db } from './src/db';

console.log('\n🧪 测试任务管理系统...\n');

// 清理旧数据
const oldTasks = listAllTasks();
oldTasks.forEach(t => deleteTask(t.id));

console.log('Step 1: 创建主任务和子任务\n');

// 创建主任务：招聘 AI 团队
const mainTaskId = createTask({
  title: '组建 AI 团队',
  description: 'Q1 目标：招聘 3 名 AI 算法工程师，组建核心 AI 团队',
  priority: 10,
  jobId: 'AI_Team_Building',
  dueDate: '2025-03-31',
});

console.log(`✓ 创建主任务 #${mainTaskId}: 组建 AI 团队\n`);

// 创建子任务
const subtask1 = createTask({
  title: '招聘 AI 算法工程师（NLP 方向）',
  description: '熟悉 Transformer、BERT、GPT 等模型',
  priority: 8,
  parentId: mainTaskId,
  jobId: 'AI_NLP_Engineer',
});

const subtask2 = createTask({
  title: '招聘 AI 算法工程师（CV 方向）',
  description: '熟悉 CNN、YOLO、目标检测等',
  priority: 7,
  parentId: mainTaskId,
  jobId: 'AI_CV_Engineer',
});

const subtask3 = createTask({
  title: '招聘 AI 工程师（MLOps 方向）',
  description: '负责模型部署、优化、监控',
  priority: 6,
  parentId: mainTaskId,
  jobId: 'AI_MLOps_Engineer',
});

console.log(`✓ 创建子任务 #${subtask1}: AI 算法工程师（NLP 方向）`);
console.log(`✓ 创建子任务 #${subtask2}: AI 算法工程师（CV 方向）`);
console.log(`✓ 创建子任务 #${subtask3}: AI 工程师（MLOps 方向）\n`);

// 创建其他独立任务
const task4 = createTask({
  title: '优化招聘流程',
  description: '梳理现有招聘流程，提升效率',
  priority: 5,
});

const task5 = createTask({
  title: '更新职位描述',
  description: '根据市场反馈更新 JD',
  priority: 3,
});

console.log(`✓ 创建独立任务 #${task4}: 优化招聘流程`);
console.log(`✓ 创建独立任务 #${task5}: 更新职位描述\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Step 2: 更新任务状态\n');

// 开始执行一些任务
updateTask(subtask1, { status: 'in_progress' });
console.log(`✓ 任务 #${subtask1} 状态更新为：进行中`);

updateTask(task4, { status: 'in_progress' });
console.log(`✓ 任务 #${task4} 状态更新为：进行中`);

updateTask(task5, { status: 'completed' });
console.log(`✓ 任务 #${task5} 状态更新为：已完成\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Step 3: 显示任务看板\n');

displayTaskBoard();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Step 4: 查看主任务详情（包含子任务）\n');

displayTask(mainTaskId);

console.log('🎉 测试完成！\n');
console.log('💡 运行以下命令查看任务看板：');
console.log('   hireclaw tasks\n');

db.close();
