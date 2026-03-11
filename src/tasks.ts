/**
 * 任务管理系统
 * 支持创建、更新、查询任务，适用于复杂招聘流程
 */

import chalk from 'chalk';
import { taskOps, db } from './db';

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  priority: number;
  parent_id?: number;
  job_id?: string;
  assigned_to?: string;
  due_date?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABEL: Record<Task['status'], string> = {
  pending: '待处理',
  in_progress: '进行中',
  blocked: '已阻塞',
  completed: '已完成',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<Task['status'], string> = {
  pending: 'gray',
  in_progress: 'blue',
  blocked: 'red',
  completed: 'green',
  cancelled: 'gray',
};

/**
 * 创建任务
 */
export function createTask(params: {
  title: string;
  description?: string;
  priority?: number;
  parentId?: number;
  jobId?: string;
  assignedTo?: string;
  dueDate?: string;
}): number {
  const result = taskOps.create.run({
    title: params.title,
    description: params.description,
    priority: params.priority ?? 0,
    parent_id: params.parentId,
    job_id: params.jobId,
    assigned_to: params.assignedTo,
    due_date: params.dueDate,
  });

  return result.lastInsertRowid as number;
}

/**
 * 更新任务
 */
export function updateTask(id: number, updates: {
  status?: Task['status'];
  title?: string;
  description?: string;
  priority?: number;
  assignedTo?: string;
  dueDate?: string;
}): void {
  const completedAt = updates.status === 'completed' ? new Date().toISOString() : undefined;

  taskOps.update.run({
    id,
    status: updates.status,
    title: updates.title,
    description: updates.description,
    priority: updates.priority,
    assigned_to: updates.assignedTo,
    due_date: updates.dueDate,
    completed_at: completedAt,
  });
}

/**
 * 删除任务
 */
export function deleteTask(id: number): void {
  taskOps.delete.run(id);
}

/**
 * 获取任务详情
 */
export function getTask(id: number): Task | null {
  return taskOps.get.get(id) as Task | null;
}

/**
 * 列出所有任务
 */
export function listAllTasks(): Task[] {
  return taskOps.listAll.all() as Task[];
}

/**
 * 按状态筛选任务
 */
export function listTasksByStatus(status: Task['status']): Task[] {
  return taskOps.listByStatus.all(status) as Task[];
}

/**
 * 按职位筛选任务
 */
export function listTasksByJob(jobId: string): Task[] {
  return taskOps.listByJob.all(jobId) as Task[];
}

/**
 * 获取子任务
 */
export function listSubtasks(parentId: number): Task[] {
  return taskOps.listSubtasks.all(parentId) as Task[];
}

/**
 * 获取任务统计
 */
export function getTaskStats(): { status: string; count: number }[] {
  return taskOps.stats.all() as { status: string; count: number }[];
}

/**
 * 显示任务看板
 */
export function displayTaskBoard(jobId?: string): void {
  const tasks = jobId ? listTasksByJob(jobId) : listAllTasks();

  if (tasks.length === 0) {
    console.log('\n暂无任务\n');
    return;
  }

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('                    📋 任务看板'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const grouped = {
    pending: tasks.filter(t => t.status === 'pending'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    blocked: tasks.filter(t => t.status === 'blocked'),
    completed: tasks.filter(t => t.status === 'completed'),
  };

  // 按列显示
  const columns = [
    { key: 'pending' as const, title: '待处理', color: 'gray' },
    { key: 'in_progress' as const, title: '进行中', color: 'blue' },
    { key: 'blocked' as const, title: '已阻塞', color: 'red' },
    { key: 'completed' as const, title: '已完成', color: 'green' },
  ];

  columns.forEach(col => {
    const count = grouped[col.key].length;
    const header = `${col.title} (${count})`;
    console.log((chalk as any)[col.color].bold(header));
    console.log((chalk as any)[col.color]('─'.repeat(30)));

    if (count === 0) {
      console.log(chalk.gray('  (无)'));
    } else {
      grouped[col.key].slice(0, 5).forEach((task, idx) => {
        const prefix = task.priority > 0 ? '🔥 ' : '  ';
        const title = task.title.length > 25 ? task.title.slice(0, 22) + '...' : task.title;
        console.log(`${prefix}${idx + 1}. [#${task.id}] ${title}`);
      });

      if (count > 5) {
        console.log(chalk.gray(`  ... 还有 ${count - 5} 个任务`));
      }
    }

    console.log('');
  });

  // 显示统计
  const stats = getTaskStats();
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const completed = stats.find(s => s.status === 'completed')?.count || 0;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`总计：${total} 个任务  |  已完成：${completed} 个 (${progress}%)`);
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

/**
 * 显示任务详情
 */
export function displayTask(id: number): void {
  const task = getTask(id);

  if (!task) {
    console.log(chalk.red(`\n任务 #${id} 不存在\n`));
    return;
  }

  const statusColor = STATUS_COLOR[task.status];
  const statusLabel = STATUS_LABEL[task.status];

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold(`📌 任务 #${task.id}`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.bold('标题:'), task.title);
  console.log(chalk.bold('状态:'), (chalk as any)[statusColor](statusLabel));
  console.log(chalk.bold('优先级:'), task.priority > 0 ? `🔥 ${task.priority}` : '普通');

  if (task.description) {
    console.log(chalk.bold('\n描述:'));
    console.log(task.description);
  }

  if (task.job_id) {
    console.log(chalk.bold('\n关联职位:'), task.job_id);
  }

  if (task.assigned_to) {
    console.log(chalk.bold('分配给:'), task.assigned_to);
  }

  if (task.due_date) {
    console.log(chalk.bold('截止日期:'), task.due_date);
  }

  if (task.parent_id) {
    console.log(chalk.bold('父任务:'), `#${task.parent_id}`);
  }

  // 显示子任务
  const subtasks = listSubtasks(task.id);
  if (subtasks.length > 0) {
    console.log(chalk.bold('\n子任务:'));
    subtasks.forEach((sub, idx) => {
      const status = (chalk as any)[STATUS_COLOR[sub.status]](STATUS_LABEL[sub.status]);
      console.log(`  ${idx + 1}. [#${sub.id}] ${sub.title} - ${status}`);
    });
  }

  console.log(chalk.gray(`\n创建时间: ${task.created_at}`));
  console.log(chalk.gray(`更新时间: ${task.updated_at}`));

  if (task.completed_at) {
    console.log(chalk.green(`完成时间: ${task.completed_at}`));
  }

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}
