/**
 * Hook 系统
 * 类似 Claude Code 的 Hook 机制
 * 在特定事件发生时自动执行 shell 命令
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { config } from './config';

export interface HookConfig {
  [hookName: string]: string; // hook 名称 -> shell 命令
}

const HOOKS_FILE = path.join(config.workspace.dir, 'hooks.json');

/**
 * 可用的 hook 事件
 */
export const AVAILABLE_HOOKS = [
  'user-prompt-submit',       // 用户提交消息后
  'pre-sourcing',             // sourcing 前
  'post-sourcing',            // sourcing 后
  'pre-commit',               // git commit 前
  'post-commit',              // git commit 后
  'pre-git-push',             // git push 前
  'post-git-push',            // git push 后
  'tool-call-start',          // 工具调用开始
  'tool-call-end',            // 工具调用结束
  'plan-mode-enter',          // 进入计划模式
  'plan-mode-exit',           // 退出计划模式
  'error-detected',           // 检测到错误
];

/**
 * 加载 hooks 配置
 */
function loadHooks(): HookConfig {
  if (!fs.existsSync(HOOKS_FILE)) {
    return {};
  }

  try {
    const content = fs.readFileSync(HOOKS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(chalk.yellow('[Hook] 加载配置失败，使用空配置'));
    return {};
  }
}

/**
 * 保存 hooks 配置
 */
export function saveHooks(hooks: HookConfig): void {
  fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooks, null, 2), 'utf-8');
}

/**
 * 执行 hook
 */
export async function runHook(
  hookName: string,
  context?: Record<string, any>
): Promise<{ success: boolean; output?: string; error?: string }> {
  const hooks = loadHooks();
  const command = hooks[hookName];

  if (!command) {
    // 没有配置此 hook，静默跳过
    return { success: true };
  }

  try {
    console.log(chalk.gray(`[Hook] 执行 ${hookName}: ${command}`));

    // 替换命令中的占位符
    let finalCommand = command;
    if (context) {
      Object.keys(context).forEach(key => {
        finalCommand = finalCommand.replace(new RegExp(`\\{${key}\\}`, 'g'), String(context[key]));
      });
    }

    const output = execSync(finalCommand, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    console.log(chalk.green(`[Hook] ✓ ${hookName} 执行成功`));

    return { success: true, output: output.trim() };
  } catch (err: any) {
    console.error(chalk.red(`[Hook] ✗ ${hookName} 执行失败: ${err.message}`));

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * 添加 hook
 */
export function addHook(hookName: string, command: string): void {
  if (!AVAILABLE_HOOKS.includes(hookName)) {
    throw new Error(`未知的 hook: ${hookName}\n\n可用 hooks:\n${AVAILABLE_HOOKS.join('\n')}`);
  }

  const hooks = loadHooks();
  hooks[hookName] = command;
  saveHooks(hooks);

  console.log(chalk.green(`✓ 已添加 hook: ${hookName}`));
}

/**
 * 删除 hook
 */
export function removeHook(hookName: string): void {
  const hooks = loadHooks();

  if (!hooks[hookName]) {
    throw new Error(`Hook 不存在: ${hookName}`);
  }

  delete hooks[hookName];
  saveHooks(hooks);

  console.log(chalk.green(`✓ 已删除 hook: ${hookName}`));
}

/**
 * 列出所有 hooks
 */
export function listHooks(): HookConfig {
  return loadHooks();
}

/**
 * 格式化 hooks 列表
 */
export function formatHooks(): string {
  const hooks = loadHooks();

  if (Object.keys(hooks).length === 0) {
    return '暂无配置的 hooks';
  }

  let output = '已配置的 hooks：\n\n';
  Object.entries(hooks).forEach(([name, command]) => {
    output += `${name}:\n  ${command}\n\n`;
  });

  return output.trim();
}

/**
 * 初始化示例 hooks
 */
export function initializeExampleHooks(): void {
  if (fs.existsSync(HOOKS_FILE)) {
    console.log(chalk.yellow('hooks.json 已存在，跳过初始化'));
    return;
  }

  const exampleHooks: HookConfig = {
    'post-sourcing': 'osascript -e \'display notification "Sourcing 完成" with title "HireClaw"\'',
    'post-commit': 'echo "Commit 完成: {message}"',
  };

  saveHooks(exampleHooks);
  console.log(chalk.green('✓ 已初始化示例 hooks'));
}

/**
 * 清除所有 hooks
 */
export function clearAllHooks(): void {
  if (fs.existsSync(HOOKS_FILE)) {
    fs.unlinkSync(HOOKS_FILE);
    console.log(chalk.green('✓ 已清除所有 hooks'));
  }
}
