/**
 * 权限系统
 * 类似 Claude Code 的权限控制，用户可以批准/拒绝工具调用
 */

import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface ToolCallRequest {
  toolName: string;
  args: any;
  description?: string;
}

export interface PermissionRule {
  tool: string;
  action: 'allow' | 'deny' | 'ask';
  pattern?: string; // 可选的参数匹配模式
}

const PERMISSIONS_FILE = path.join(config.workspace.dir, '.permissions.json');

/**
 * 危险工具列表（需要用户确认）
 *
 * 策略：默认允许大部分操作，只在真正危险时确认
 * - 删除/破坏性操作
 * - 外部通信（Git 推送、PR）
 * - Shell 命令执行
 */
const DANGEROUS_TOOLS = [
  'execute_shell',     // Shell 命令可能破坏系统
  'forget',            // 删除记忆
  'delete_candidate',  // 删除候选人数据
  // 注意：以下工具默认允许，除非有危险参数
  // - git_push（普通推送允许，强制推送需确认）
  // - write_file（普通文件允许，敏感文件需确认）
  // - run_sourcing（招聘操作，默认允许）
];

/**
 * 危险参数模式
 *
 * 即使工具本身不在 DANGEROUS_TOOLS 中，
 * 如果参数匹配危险模式，也需要确认
 */
const DANGEROUS_PATTERNS: Record<string, (args: any) => boolean> = {
  // Git 强制推送需要确认
  git_push: (args) => args.force === true,

  // 破坏性 Shell 命令需要确认
  execute_shell: (args) => {
    const cmd = args.command?.toLowerCase() || '';
    return cmd.includes('rm -rf') ||
           cmd.includes('delete') ||
           cmd.includes('drop') ||
           cmd.includes('truncate');
  },

  // 写入敏感文件需要确认
  write_file: (args) => {
    const filepath = args.filename || args.file_path || '';
    return filepath.includes('.env') ||
           filepath.includes('credentials') ||
           filepath.includes('secret') ||
           filepath.includes('password');
  },

  // 创建 PR 到主分支需要确认
  git_create_pr: (args) => {
    const target = args.target_branch?.toLowerCase() || '';
    return target === 'main' || target === 'master';
  },
};

/**
 * 加载权限规则
 */
function loadPermissions(): PermissionRule[] {
  if (!fs.existsSync(PERMISSIONS_FILE)) {
    return [];
  }

  try {
    const content = fs.readFileSync(PERMISSIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * 保存权限规则
 */
function savePermissions(rules: PermissionRule[]): void {
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(rules, null, 2), 'utf-8');
}

/**
 * 检查工具是否危险
 */
function isDangerousTool(toolName: string, args: any): boolean {
  // 1. 检查是否在危险工具列表中
  if (DANGEROUS_TOOLS.includes(toolName)) {
    // 2. 检查是否有危险参数模式
    const patternCheck = DANGEROUS_PATTERNS[toolName];
    if (patternCheck && patternCheck(args)) {
      return true; // 危险参数
    }
    return true; // 危险工具
  }

  return false;
}

/**
 * 检查已保存的权限规则
 */
function checkSavedPermission(toolName: string, args: any): 'allow' | 'deny' | 'ask' {
  const rules = loadPermissions();

  for (const rule of rules) {
    if (rule.tool === toolName) {
      // 如果有参数模式匹配，检查是否匹配
      if (rule.pattern) {
        const argsStr = JSON.stringify(args);
        if (argsStr.includes(rule.pattern)) {
          return rule.action;
        }
      } else {
        return rule.action;
      }
    }
  }

  return 'ask';
}

/**
 * 向用户请求权限
 */
async function askUserPermission(request: ToolCallRequest): Promise<{
  approved: boolean;
  saveRule?: PermissionRule;
}> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(chalk.yellow('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.yellow('⚠️  工具调用需要确认'));
    console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.bold(`工具: ${request.toolName}`));
    if (request.description) {
      console.log(chalk.gray(`说明: ${request.description}`));
    }
    console.log(chalk.bold('参数:'));
    console.log(chalk.gray(JSON.stringify(request.args, null, 2)));

    // 检查是否有危险模式
    const patternCheck = DANGEROUS_PATTERNS[request.toolName];
    if (patternCheck && patternCheck(request.args)) {
      console.log(chalk.red('\n警告: 检测到危险操作！'));
      if (request.toolName === 'git_push' && request.args.force) {
        console.log(chalk.red('- 强制推送会覆盖远程分支历史'));
        console.log(chalk.red('- 可能导致他人工作丢失'));
      } else if (request.toolName === 'execute_shell') {
        console.log(chalk.red('- 此命令可能删除或修改重要数据'));
      } else if (request.toolName === 'write_file') {
        console.log(chalk.red('- 写入敏感文件可能导致配置错误'));
      }
    }

    console.log(chalk.yellow('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.green('1. 批准（仅此次）'));
    console.log(chalk.green('2. 批准所有 ' + request.toolName));
    console.log(chalk.red('3. 拒绝（仅此次）'));
    console.log(chalk.red('4. 拒绝所有 ' + request.toolName));
    console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    rl.question(chalk.cyan('请选择 (1-4): '), (answer) => {
      rl.close();

      const choice = parseInt(answer.trim(), 10);

      switch (choice) {
        case 1:
          // 批准（仅此次）
          console.log(chalk.green('\n✓ 已批准\n'));
          resolve({ approved: true });
          break;

        case 2:
          // 批准所有
          console.log(chalk.green('\n✓ 已批准所有 ' + request.toolName + '\n'));
          resolve({
            approved: true,
            saveRule: {
              tool: request.toolName,
              action: 'allow',
            },
          });
          break;

        case 3:
          // 拒绝（仅此次）
          console.log(chalk.red('\n✗ 已拒绝\n'));
          resolve({ approved: false });
          break;

        case 4:
          // 拒绝所有
          console.log(chalk.red('\n✗ 已拒绝所有 ' + request.toolName + '\n'));
          resolve({
            approved: false,
            saveRule: {
              tool: request.toolName,
              action: 'deny',
            },
          });
          break;

        default:
          // 默认拒绝
          console.log(chalk.red('\n✗ 无效选择，已拒绝\n'));
          resolve({ approved: false });
      }
    });
  });
}

/**
 * 主权限检查函数
 */
export async function checkPermission(request: ToolCallRequest): Promise<boolean> {
  const { toolName, args } = request;

  // 1. 检查是否是危险工具
  if (!isDangerousTool(toolName, args)) {
    return true; // 安全工具，自动批准
  }

  // 2. 检查已保存的权限规则
  const savedPermission = checkSavedPermission(toolName, args);

  if (savedPermission === 'allow') {
    return true;
  }

  if (savedPermission === 'deny') {
    console.log(chalk.red(`\n✗ 工具 ${toolName} 已被拒绝（根据已保存规则）\n`));
    return false;
  }

  // 3. 询问用户
  const result = await askUserPermission(request);

  // 4. 保存规则（如果用户选择了"所有"）
  if (result.saveRule) {
    const rules = loadPermissions();
    rules.push(result.saveRule);
    savePermissions(rules);
  }

  return result.approved;
}

/**
 * 清除所有权限规则
 */
export function clearPermissions(): void {
  if (fs.existsSync(PERMISSIONS_FILE)) {
    fs.unlinkSync(PERMISSIONS_FILE);
    console.log(chalk.green('已清除所有权限规则'));
  }
}

/**
 * 列出所有权限规则
 */
export function listPermissions(): PermissionRule[] {
  return loadPermissions();
}

/**
 * 格式化权限规则列表
 */
export function formatPermissions(): string {
  const rules = loadPermissions();

  if (rules.length === 0) {
    return '暂无已保存的权限规则';
  }

  let output = '已保存的权限规则：\n\n';
  rules.forEach((rule, index) => {
    const action = rule.action === 'allow' ? '✓ 允许' : '✗ 拒绝';
    output += `${index + 1}. ${action} - ${rule.tool}`;
    if (rule.pattern) {
      output += ` (匹配: ${rule.pattern})`;
    }
    output += '\n';
  });

  return output.trim();
}
