/**
 * Git 自动化功能测试
 * 测试 git-helper 模块的各个功能
 */

import {
  isGitRepo,
  getGitStatus,
  getDefaultBranch,
  getRecentCommits,
  isGitHubRepo,
  hasGitHubCLI,
} from './src/git-helper';

async function testGitAutomation() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Git 自动化功能测试');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. 检查是否是 git 仓库
  console.log('1. 检查 Git 仓库');
  const isRepo = isGitRepo();
  console.log(`   是否为 Git 仓库: ${isRepo ? '✓' : '✗'}`);

  if (!isRepo) {
    console.log('\n⚠️  当前目录不是 Git 仓库，测试终止');
    return;
  }

  // 2. 获取 Git 状态
  console.log('\n2. Git 状态');
  try {
    const status = getGitStatus();
    console.log(`   当前分支: ${status.branch}`);
    console.log(`   工作区状态: ${status.clean ? '干净' : '有更改'}`);
    console.log(`   已暂存文件: ${status.staged.length} 个`);
    console.log(`   已修改文件: ${status.modified.length} 个`);
    console.log(`   未跟踪文件: ${status.untracked.length} 个`);

    if (!status.clean) {
      console.log('\n   详细信息:');
      if (status.staged.length > 0) {
        console.log('   已暂存:');
        status.staged.forEach(f => console.log(`     + ${f}`));
      }
      if (status.modified.length > 0) {
        console.log('   已修改:');
        status.modified.forEach(f => console.log(`     M ${f}`));
      }
      if (status.untracked.length > 0) {
        console.log('   未跟踪:');
        status.untracked.forEach(f => console.log(`     ? ${f}`));
      }
    }
  } catch (err: any) {
    console.log(`   ✗ 获取状态失败: ${err.message}`);
  }

  // 3. 获取默认分支
  console.log('\n3. 默认分支');
  try {
    const defaultBranch = getDefaultBranch();
    console.log(`   默认分支: ${defaultBranch}`);
  } catch (err: any) {
    console.log(`   ✗ 获取失败: ${err.message}`);
  }

  // 4. 获取最近提交
  console.log('\n4. 最近提交 (5 条)');
  try {
    const commits = getRecentCommits(5);
    commits.forEach(commit => console.log(`   ${commit}`));
  } catch (err: any) {
    console.log(`   ✗ 获取失败: ${err.message}`);
  }

  // 5. 检查是否是 GitHub 仓库
  console.log('\n5. GitHub 检测');
  const isGH = isGitHubRepo();
  console.log(`   是否为 GitHub 仓库: ${isGH ? '✓' : '✗'}`);

  // 6. 检查 gh CLI
  console.log('\n6. GitHub CLI');
  const hasGH = hasGitHubCLI();
  console.log(`   是否安装 gh CLI: ${hasGH ? '✓' : '✗'}`);
  if (!hasGH) {
    console.log('   提示: 运行 brew install gh 安装');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('测试完成');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 提示
  console.log('提示：');
  console.log('- 在对话模式中运行 "hireclaw" 即可使用 Git 自动化功能');
  console.log('- 可用命令：查看状态、提交代码、创建分支、推送、创建 PR');
  console.log('- 参考文档：docs/GIT-AUTOMATION.md\n');
}

testGitAutomation().catch(console.error);
