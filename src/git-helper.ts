/**
 * Git 自动化辅助工具
 * 提供代码提交、分支管理、PR 创建等功能
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface GitStatus {
  branch: string;
  modified: string[];
  untracked: string[];
  staged: string[];
  clean: boolean;
}

export interface CommitOptions {
  message: string;
  files?: string[];  // 如果未指定，则提交所有更改
  amend?: boolean;
}

export interface BranchOptions {
  name: string;
  baseBranch?: string;  // 默认从当前分支创建
}

export interface PROptions {
  title: string;
  body?: string;
  baseBranch?: string;  // 默认 main 或 master
  draft?: boolean;
}

/**
 * 检查是否在 git 仓库中
 */
export function isGitRepo(dir: string = process.cwd()): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: dir,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 git 状态
 */
export function getGitStatus(dir: string = process.cwd()): GitStatus {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  const branch = execSync('git branch --show-current', {
    cwd: dir,
    encoding: 'utf-8'
  }).trim();

  const statusOutput = execSync('git status --porcelain', {
    cwd: dir,
    encoding: 'utf-8'
  });

  const modified: string[] = [];
  const untracked: string[] = [];
  const staged: string[] = [];

  statusOutput.split('\n').forEach(line => {
    if (!line) return;
    const status = line.substring(0, 2);
    const file = line.substring(3);

    if (status[0] === 'M' || status[0] === 'A' || status[0] === 'D') {
      staged.push(file);
    }
    if (status[1] === 'M') {
      modified.push(file);
    }
    if (status === '??') {
      untracked.push(file);
    }
  });

  return {
    branch,
    modified,
    untracked,
    staged,
    clean: modified.length === 0 && untracked.length === 0 && staged.length === 0,
  };
}

/**
 * 添加文件到暂存区
 */
export function gitAdd(files: string[], dir: string = process.cwd()): void {
  if (files.length === 0) {
    throw new Error('未指定要添加的文件');
  }

  const filesArg = files.map(f => `"${f}"`).join(' ');
  execSync(`git add ${filesArg}`, { cwd: dir, stdio: 'inherit' });
}

/**
 * 提交更改
 */
export function gitCommit(options: CommitOptions, dir: string = process.cwd()): string {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  // 如果指定了文件，先添加到暂存区
  if (options.files && options.files.length > 0) {
    gitAdd(options.files, dir);
  } else {
    // 未指定文件，添加所有已修改和新增的文件
    const status = getGitStatus(dir);
    const allFiles = [...status.modified, ...status.untracked];
    if (allFiles.length > 0) {
      gitAdd(allFiles, dir);
    }
  }

  // 提交
  const amendFlag = options.amend ? ' --amend --no-edit' : '';
  const message = options.message.replace(/"/g, '\\"');

  try {
    execSync(`git commit -m "${message}"${amendFlag}`, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe'
    });
  } catch (err: any) {
    // 如果没有更改需要提交，不视为错误
    if (err.message.includes('nothing to commit')) {
      return 'nothing';
    }
    throw err;
  }

  // 获取提交 SHA
  const sha = execSync('git rev-parse HEAD', {
    cwd: dir,
    encoding: 'utf-8'
  }).trim();

  return sha;
}

/**
 * 创建新分支
 */
export function createBranch(options: BranchOptions, dir: string = process.cwd()): void {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  const baseFlag = options.baseBranch ? ` ${options.baseBranch}` : '';
  execSync(`git checkout -b ${options.name}${baseFlag}`, {
    cwd: dir,
    stdio: 'inherit'
  });
}

/**
 * 切换分支
 */
export function checkoutBranch(branchName: string, dir: string = process.cwd()): void {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  execSync(`git checkout ${branchName}`, {
    cwd: dir,
    stdio: 'inherit'
  });
}

/**
 * 推送到远程
 */
export function gitPush(branch?: string, force: boolean = false, dir: string = process.cwd()): void {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  const branchArg = branch ? ` origin ${branch}` : '';
  const forceFlag = force ? ' --force' : '';

  execSync(`git push${branchArg}${forceFlag}`, {
    cwd: dir,
    stdio: 'inherit'
  });
}

/**
 * 检查是否安装了 gh CLI
 */
export function hasGitHubCLI(): boolean {
  try {
    execSync('which gh', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建 Pull Request (需要 gh CLI)
 */
export function createPR(options: PROptions, dir: string = process.cwd()): string {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  if (!hasGitHubCLI()) {
    throw new Error('未安装 gh CLI，请运行: brew install gh');
  }

  // 确保当前分支已推送
  const status = getGitStatus(dir);
  gitPush(status.branch, false, dir);

  // 构建 gh pr create 命令
  let cmd = `gh pr create --title "${options.title}"`;

  if (options.body) {
    cmd += ` --body "${options.body}"`;
  }

  if (options.baseBranch) {
    cmd += ` --base ${options.baseBranch}`;
  }

  if (options.draft) {
    cmd += ' --draft';
  }

  const output = execSync(cmd, {
    cwd: dir,
    encoding: 'utf-8'
  });

  // 提取 PR URL
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
  return urlMatch ? urlMatch[0] : output.trim();
}

/**
 * 获取默认主分支名称
 */
export function getDefaultBranch(dir: string = process.cwd()): string {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  try {
    const branch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: dir,
      encoding: 'utf-8'
    }).trim();
    return branch.replace('refs/remotes/origin/', '');
  } catch {
    // 如果获取失败，尝试常见分支名
    try {
      execSync('git rev-parse --verify main', { cwd: dir, stdio: 'ignore' });
      return 'main';
    } catch {
      try {
        execSync('git rev-parse --verify master', { cwd: dir, stdio: 'ignore' });
        return 'master';
      } catch {
        throw new Error('无法确定默认分支');
      }
    }
  }
}

/**
 * 获取最近的提交历史
 */
export function getRecentCommits(count: number = 5, dir: string = process.cwd()): string[] {
  if (!isGitRepo(dir)) {
    throw new Error('不是一个 git 仓库');
  }

  const output = execSync(`git log -${count} --oneline`, {
    cwd: dir,
    encoding: 'utf-8'
  });

  return output.trim().split('\n').filter(Boolean);
}

/**
 * 检查远程仓库是否是 GitHub
 */
export function isGitHubRepo(dir: string = process.cwd()): boolean {
  if (!isGitRepo(dir)) {
    return false;
  }

  try {
    const remote = execSync('git remote get-url origin', {
      cwd: dir,
      encoding: 'utf-8'
    }).trim();
    return remote.includes('github.com');
  } catch {
    return false;
  }
}
