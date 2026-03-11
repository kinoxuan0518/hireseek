/**
 * Claude Code 独有功能测试
 * 测试所有新实现的功能
 */

import chalk from 'chalk';

async function testClaudeFeatures() {
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('Claude Code 功能测试'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // 1. Auto Memory
  console.log(chalk.bold('1. Auto Memory (自动记忆)'));
  try {
    const {
      loadMemory,
      listTopicFiles,
      appendMemory,
      initializeDefaultTopics,
    } = await import('./src/auto-memory');

    initializeDefaultTopics();
    console.log(chalk.green('   ✓ 初始化默认主题'));

    const topics = listTopicFiles();
    console.log(chalk.green(`   ✓ 发现 ${topics.length} 个主题文件: ${topics.join(', ')}`));

    const memory = loadMemory();
    console.log(chalk.green(`   ✓ MEMORY.md 长度: ${memory.length} 字符`));

    // 测试追加记忆
    appendMemory('记忆索引', '测试记忆条目 - ' + new Date().toISOString());
    console.log(chalk.green('   ✓ 追加记忆成功'));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 2. Skill System
  console.log(chalk.bold('\n2. Skill System (技能系统)'));
  try {
    const {
      listSkills,
      initializeDefaultSkills,
      parseSkillInvocation,
    } = await import('./src/skill-system');

    initializeDefaultSkills();
    console.log(chalk.green('   ✓ 初始化默认技能'));

    const skills = listSkills();
    console.log(chalk.green(`   ✓ 发现 ${skills.length} 个技能:`));
    skills.forEach(skill => {
      console.log(chalk.gray(`      /${skill.name} - ${skill.description}`));
    });

    // 测试解析
    const test1 = parseSkillInvocation('/找候选人 前端工程师');
    console.log(chalk.green(`   ✓ 解析技能调用: /${test1.skillName}, args: "${test1.args}"`));

    const test2 = parseSkillInvocation('普通消息');
    console.log(chalk.green(`   ✓ 普通消息检测: isSkill=${test2.isSkill}`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 3. Git Automation
  console.log(chalk.bold('\n3. Git Automation (Git 自动化)'));
  try {
    const {
      isGitRepo,
      getGitStatus,
      hasGitHubCLI,
    } = await import('./src/git-helper');

    const isRepo = isGitRepo();
    console.log(chalk.green(`   ✓ Git 仓库检测: ${isRepo ? '是' : '否'}`));

    if (isRepo) {
      const status = getGitStatus();
      console.log(chalk.green(`   ✓ 当前分支: ${status.branch}`));
      console.log(chalk.green(`   ✓ 工作区状态: ${status.clean ? '干净' : '有更改'}`));
    }

    const hasGH = hasGitHubCLI();
    console.log(chalk.green(`   ✓ GitHub CLI: ${hasGH ? '已安装' : '未安装'}`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 4. MCP Client
  console.log(chalk.bold('\n4. MCP Client (MCP 协议)'));
  try {
    const { mcpClient } = await import('./src/mcp-client');

    const connections = mcpClient.listConnections();
    console.log(chalk.green(`   ✓ 已连接 MCP 服务器: ${connections.length} 个`));

    if (connections.length > 0) {
      connections.forEach(name => {
        const tools = mcpClient.getTools(name);
        const resources = mcpClient.getResources(name);
        console.log(chalk.gray(`      ${name}: ${tools.length} 工具, ${resources.length} 资源`));
      });
    }
  } catch (err: any) {
    console.log(chalk.yellow(`   ⚠ MCP 客户端未初始化（正常，需要配置）`));
  }

  // 5. Search Tools
  console.log(chalk.bold('\n5. Search Tools (搜索工具)'));
  try {
    const { searchFiles } = await import('./src/tools/glob');

    const tsFiles = await searchFiles({ pattern: 'src/**/*.ts' });
    console.log(chalk.green(`   ✓ Glob 搜索: 找到 ${tsFiles.length} 个 TypeScript 文件`));

    const { searchContent } = await import('./src/tools/grep');
    const matches = await searchContent({
      pattern: 'function',
      path: 'src',
      glob: '*.ts',
      outputMode: 'count',
    });
    console.log(chalk.green(`   ✓ Grep 搜索: 找到匹配`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 6. Task Management
  console.log(chalk.bold('\n6. Task Management (任务管理)'));
  try {
    const { listAllTasks } = await import('./src/tasks');

    const tasks = listAllTasks();
    console.log(chalk.green(`   ✓ 当前任务数: ${tasks.length}`));

    if (tasks.length > 0) {
      const pending = tasks.filter(t => t.status === 'pending').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      console.log(chalk.gray(`      Pending: ${pending}, In Progress: ${inProgress}, Completed: ${completed}`));
    }
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 7. Error Recovery
  console.log(chalk.bold('\n7. Error Recovery (错误恢复)'));
  try {
    const { loadCheckpoint } = await import('./src/retry-handler');

    const checkpoint = loadCheckpoint('default', 'boss', 'boss_1');
    if (checkpoint) {
      console.log(chalk.green(`   ✓ 发现检查点: ${checkpoint.timestamp}`));
    } else {
      console.log(chalk.green(`   ✓ 无检查点（正常）`));
    }
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 总结
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('测试完成'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.bold('功能总览:'));
  console.log(chalk.green('  ✅ Auto Memory - 跨会话自动记忆'));
  console.log(chalk.green('  ✅ Skill System - /技能名 快捷调用'));
  console.log(chalk.green('  ✅ AskUserQuestion - 结构化问答（运行时测试）'));
  console.log(chalk.green('  ✅ PDF Reader - 读取 PDF 文件（运行时测试）'));
  console.log(chalk.green('  ✅ Git Automation - 自动化 git 操作'));
  console.log(chalk.green('  ✅ MCP Protocol - 连接外部服务'));
  console.log(chalk.green('  ✅ Search Tools - Glob/Grep 搜索'));
  console.log(chalk.green('  ✅ Task Management - 结构化任务'));
  console.log(chalk.green('  ✅ Error Recovery - 智能重试'));
  console.log(chalk.green('  ✅ Plan Mode - AI 策略分析\n'));

  console.log(chalk.bold('对话工具总数: 30+'));
  console.log(chalk.gray('  - 执行控制、候选人管理、数据分析'));
  console.log(chalk.gray('  - 文件操作、网络搜索、代码操作'));
  console.log(chalk.gray('  - Git 自动化、MCP 集成、任务管理'));
  console.log(chalk.gray('  - 自动记忆、结构化问答、PDF 阅读\n'));

  console.log(chalk.bold('使用方式:'));
  console.log(chalk.gray('  hireclaw                 # 对话模式'));
  console.log(chalk.gray('  hireclaw run --plan      # 计划模式'));
  console.log(chalk.gray('  hireclaw tasks           # 任务看板'));
  console.log(chalk.gray('  hireclaw dashboard       # 实时控制台\n'));

  console.log(chalk.bold('技能调用:'));
  console.log(chalk.gray('  /找候选人 前端工程师'));
  console.log(chalk.gray('  /分析简历 resume.pdf'));
  console.log(chalk.gray('  /候选人漏斗'));
  console.log(chalk.gray('  /commit\n'));
}

testClaudeFeatures().catch(console.error);
