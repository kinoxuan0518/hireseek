/**
 * Plan Mode - 交互式计划模式
 * 类似 Claude Code 的 EnterPlanMode/ExitPlanMode 工作流
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { config } from './config';
import type OpenAI from 'openai';

export interface PlanModeState {
  active: boolean;
  planFile: string;
  explorationNotes: string[];
  decisions: string[];
}

let planModeState: PlanModeState = {
  active: false,
  planFile: '',
  explorationNotes: [],
  decisions: [],
};

const PLAN_DIR = path.join(config.workspace.dir, 'plans');

/**
 * 确保 plans 目录存在
 */
function ensurePlanDir(): void {
  if (!fs.existsSync(PLAN_DIR)) {
    fs.mkdirSync(PLAN_DIR, { recursive: true });
  }
}

/**
 * 进入计划模式
 */
export function enterPlanMode(taskDescription: string): string {
  if (planModeState.active) {
    return '已经在计划模式中';
  }

  ensurePlanDir();

  // 生成计划文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const planFile = path.join(PLAN_DIR, `plan-${timestamp}.md`);

  planModeState = {
    active: true,
    planFile,
    explorationNotes: [],
    decisions: [],
  };

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('进入计划模式'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  console.log(chalk.gray('任务: ' + taskDescription));
  console.log(chalk.gray('\n我将探索代码库、分析需求、设计方案。'));
  console.log(chalk.gray('完成后会生成计划文档供你审阅。\n'));

  return `已进入计划模式。

任务: ${taskDescription}

现在我可以使用所有工具进行探索：
- 读取文件了解现有代码
- 搜索相关实现
- 分析历史数据
- 设计实现方案

我会将探索过程和决策记录下来，最后生成完整计划。`;
}

/**
 * 记录探索笔记
 */
export function addExplorationNote(note: string): void {
  if (!planModeState.active) {
    return;
  }

  planModeState.explorationNotes.push(note);
}

/**
 * 记录决策
 */
export function addDecision(decision: string): void {
  if (!planModeState.active) {
    return;
  }

  planModeState.decisions.push(decision);
}

/**
 * 生成计划文档
 */
export function generatePlanDocument(
  taskDescription: string,
  approach: string,
  steps: string[],
  risks: string[]
): string {
  const planContent = `# 实现计划

**任务**: ${taskDescription}

**生成时间**: ${new Date().toLocaleString('zh-CN')}

---

## 探索过程

${planModeState.explorationNotes.map((note, i) => `${i + 1}. ${note}`).join('\n')}

---

## 关键决策

${planModeState.decisions.map((decision, i) => `${i + 1}. ${decision}`).join('\n')}

---

## 实现方案

${approach}

---

## 执行步骤

${steps.map((step, i) => `### 步骤 ${i + 1}\n\n${step}\n`).join('\n')}

---

## 风险和注意事项

${risks.map((risk, i) => `${i + 1}. ${risk}`).join('\n')}

---

## 文件修改清单

_待执行时确定_

---

## 测试计划

_待执行时确定_

---

_此计划由 HireClaw 在计划模式下生成_
`;

  fs.writeFileSync(planModeState.planFile, planContent, 'utf-8');

  return planContent;
}

/**
 * 请求用户批准计划
 */
export async function requestPlanApproval(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('计划已生成'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.gray(`计划文件: ${planModeState.planFile}\n`));

    // 显示计划摘要
    if (fs.existsSync(planModeState.planFile)) {
      const content = fs.readFileSync(planModeState.planFile, 'utf-8');
      const lines = content.split('\n');

      // 显示前 30 行
      const preview = lines.slice(0, 30).join('\n');
      console.log(chalk.gray(preview));

      if (lines.length > 30) {
        console.log(chalk.gray(`\n... (还有 ${lines.length - 30} 行，查看完整计划请打开文件)\n`));
      }
    }

    console.log(chalk.yellow('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.green('1. 批准 - 开始执行此计划'));
    console.log(chalk.yellow('2. 修改 - 我需要调整计划'));
    console.log(chalk.red('3. 拒绝 - 放弃此计划'));
    console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    rl.question(chalk.cyan('请选择 (1-3): '), (answer) => {
      rl.close();

      const choice = parseInt(answer.trim(), 10);

      switch (choice) {
        case 1:
          console.log(chalk.green('\n✓ 计划已批准，开始执行\n'));
          resolve(true);
          break;

        case 2:
          console.log(chalk.yellow('\n请告诉我需要如何调整计划\n'));
          resolve(false);
          break;

        case 3:
          console.log(chalk.red('\n✗ 计划已放弃\n'));
          planModeState.active = false;
          resolve(false);
          break;

        default:
          console.log(chalk.red('\n✗ 无效选择，计划未批准\n'));
          resolve(false);
      }
    });
  });
}

/**
 * 退出计划模式
 */
export function exitPlanMode(approved: boolean): string {
  if (!planModeState.active) {
    return '当前不在计划模式中';
  }

  const planFile = planModeState.planFile;

  planModeState = {
    active: false,
    planFile: '',
    explorationNotes: [],
    decisions: [],
  };

  if (approved) {
    return `计划模式已退出。

计划已批准，现在开始执行。
计划文件: ${planFile}

我会按照计划逐步实施，完成后向你汇报。`;
  } else {
    return `计划模式已退出。

计划未批准或已放弃。
计划文件保存在: ${planFile}

你可以随时查看或重新开始计划。`;
  }
}

/**
 * 检查是否在计划模式中
 */
export function isInPlanMode(): boolean {
  return planModeState.active;
}

/**
 * 获取当前计划状态
 */
export function getPlanModeState(): PlanModeState {
  return { ...planModeState };
}

/**
 * 列出所有计划文件
 */
export function listPlans(): string[] {
  ensurePlanDir();

  const files = fs.readdirSync(PLAN_DIR);
  return files
    .filter(f => f.startsWith('plan-') && f.endsWith('.md'))
    .sort()
    .reverse(); // 最新的在前面
}

/**
 * 读取计划文件
 */
export function readPlan(filename: string): string {
  const filepath = path.join(PLAN_DIR, filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`计划文件不存在: ${filename}`);
  }

  return fs.readFileSync(filepath, 'utf-8');
}
