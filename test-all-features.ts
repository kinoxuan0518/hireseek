/**
 * 完整功能集成测试
 * 测试所有核心功能确保升级后一切正常
 */

import chalk from 'chalk';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void> | void) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(chalk.green(`  ✓ ${name}`));
    } catch (err: any) {
      results.push({ name, passed: false, error: err.message });
      console.log(chalk.red(`  ✗ ${name}: ${err.message}`));
    }
  };
}

async function runAllTests() {
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('HireClaw 完整功能测试'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // Phase 1-3: 基础功能
  console.log(chalk.bold('Phase 1-3: 基础功能'));

  await test('Planner 模块', async () => {
    const { generatePlan } = await import('./src/planner');
    // 不实际调用 LLM，只检查模块加载
    if (typeof generatePlan !== 'function') throw new Error('generatePlan 不是函数');
  })();

  await test('Glob 搜索', async () => {
    const { searchFiles } = await import('./src/tools/glob');
    const files = await searchFiles({ pattern: 'src/**/*.ts' });
    if (!Array.isArray(files)) throw new Error('返回值不是数组');
    if (files.length === 0) throw new Error('未找到任何文件');
  })();

  await test('Grep 搜索', async () => {
    const { searchContent } = await import('./src/tools/grep');
    // 基础测试，不实际搜索
    if (typeof searchContent !== 'function') throw new Error('searchContent 不是函数');
  })();

  await test('错误检测', async () => {
    const { detectCaptcha } = await import('./src/error-detector');
    if (typeof detectCaptcha !== 'function') throw new Error('detectCaptcha 不是函数');
  })();

  await test('重试处理', async () => {
    const { retryWithBackoff } = await import('./src/retry-handler');
    if (typeof retryWithBackoff !== 'function') throw new Error('retryWithBackoff 不是函数');
  })();

  await test('任务管理', async () => {
    const { listAllTasks } = await import('./src/tasks');
    const tasks = listAllTasks();
    if (!Array.isArray(tasks)) throw new Error('返回值不是数组');
  })();

  await test('MCP 客户端', async () => {
    const { mcpClient } = await import('./src/mcp-client');
    if (!mcpClient) throw new Error('mcpClient 未定义');
  })();

  await test('Git 助手', async () => {
    const { isGitRepo, getGitStatus } = await import('./src/git-helper');
    const isRepo = isGitRepo();
    if (typeof isRepo !== 'boolean') throw new Error('isGitRepo 返回值不是布尔');
    if (isRepo) {
      const status = getGitStatus();
      if (!status.branch) throw new Error('未获取到分支信息');
    }
  })();

  // Phase 4: Claude Code 独有功能
  console.log(chalk.bold('\nPhase 4: Claude Code 独有功能'));

  await test('Auto Memory', async () => {
    const { loadMemory, initializeDefaultTopics } = await import('./src/auto-memory');
    initializeDefaultTopics();
    const memory = loadMemory();
    if (typeof memory !== 'string') throw new Error('loadMemory 返回值不是字符串');
  })();

  await test('Ask User Question', async () => {
    const { askUserQuestions } = await import('./src/ask-user');
    if (typeof askUserQuestions !== 'function') throw new Error('askUserQuestions 不是函数');
  })();

  await test('PDF Reader', async () => {
    const { readPDF } = await import('./src/pdf-reader');
    if (typeof readPDF !== 'function') throw new Error('readPDF 不是函数');
  })();

  await test('Skill System', async () => {
    const { listSkills, initializeDefaultSkills } = await import('./src/skill-system');
    initializeDefaultSkills();
    const skills = listSkills();
    if (!Array.isArray(skills)) throw new Error('返回值不是数组');
    if (skills.length === 0) throw new Error('未找到任何技能');
  })();

  // Phase 5: 高级功能
  console.log(chalk.bold('\nPhase 5: 高级功能'));

  await test('Permission System', async () => {
    const { checkPermission } = await import('./src/permissions');
    const result = await checkPermission({ toolName: 'list_candidates', args: {} });
    if (typeof result !== 'boolean') throw new Error('checkPermission 返回值不是布尔');
  })();

  await test('Plan Mode', async () => {
    const { enterPlanMode, isInPlanMode } = await import('./src/plan-mode');
    enterPlanMode('测试任务');
    const inPlanMode = isInPlanMode();
    if (typeof inPlanMode !== 'boolean') throw new Error('isInPlanMode 返回值不是布尔');
  })();

  await test('Hook System', async () => {
    const { listHooks, AVAILABLE_HOOKS } = await import('./src/hooks');
    const hooks = listHooks();
    if (typeof hooks !== 'object') throw new Error('listHooks 返回值不是对象');
    if (!Array.isArray(AVAILABLE_HOOKS)) throw new Error('AVAILABLE_HOOKS 不是数组');
    if (AVAILABLE_HOOKS.length === 0) throw new Error('AVAILABLE_HOOKS 为空');
  })();

  await test('Context Compression', async () => {
    const { estimateTokens, compressConversation } = await import('./src/context-compression');
    const testMessages = [
      { role: 'system' as const, content: 'test' },
      { role: 'user' as const, content: 'test' },
    ];
    const tokens = estimateTokens(testMessages);
    if (typeof tokens !== 'number') throw new Error('estimateTokens 返回值不是数字');
    const compressed = compressConversation(testMessages);
    if (!Array.isArray(compressed)) throw new Error('compressConversation 返回值不是数组');
  })();

  await test('Remote Sessions', async () => {
    const { exportSession, listSessions } = await import('./src/remote-session');
    const testMessages = [
      { role: 'user' as const, content: 'test' },
      { role: 'assistant' as const, content: 'response' },
    ];
    const session = exportSession({ title: 'test', messages: testMessages });
    if (!session.id) throw new Error('session.id 未定义');
    const sessions = listSessions();
    if (!Array.isArray(sessions)) throw new Error('listSessions 返回值不是数组');
  })();

  // 核心模块
  console.log(chalk.bold('\n核心模块'));

  await test('Config', async () => {
    const { config } = await import('./src/config');
    if (!config.workspace) throw new Error('config.workspace 未定义');
  })();

  await test('Database', async () => {
    const { db, candidateOps } = await import('./src/db');
    if (!db) throw new Error('db 未定义');
    if (!candidateOps) throw new Error('candidateOps 未定义');
  })();

  await test('Orchestrator', async () => {
    const { runJob } = await import('./src/orchestrator');
    if (typeof runJob !== 'function') throw new Error('runJob 不是函数');
  })();

  await test('Browser Runner', async () => {
    const { getBrowser } = await import('./src/browser-runner');
    if (typeof getBrowser !== 'function') throw new Error('getBrowser 不是函数');
  })();

  await test('Accounts', async () => {
    const { getAccountId } = await import('./src/accounts');
    const accountId = getAccountId('boss', 0);
    if (accountId !== 'boss_1') throw new Error('getAccountId 返回值错误');
  })();

  // 总结
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('测试结果'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(chalk.bold(`总计: ${total} 个测试`));
  console.log(chalk.green(`通过: ${passed} 个`));
  if (failed > 0) {
    console.log(chalk.red(`失败: ${failed} 个`));
    console.log(chalk.red('\n失败的测试:'));
    results.filter(r => !r.passed).forEach(r => {
      console.log(chalk.red(`  ✗ ${r.name}: ${r.error}`));
    });
  }

  const passRate = Math.round((passed / total) * 100);
  console.log(chalk.bold(`\n通过率: ${passRate}%`));

  if (passRate === 100) {
    console.log(chalk.green('\n🎉 所有测试通过！可以安全上传到 GitHub\n'));
  } else if (passRate >= 80) {
    console.log(chalk.yellow('\n⚠️  大部分测试通过，建议修复失败的测试后再上传\n'));
  } else {
    console.log(chalk.red('\n❌ 测试通过率过低，请修复问题后再上传\n'));
  }

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error(chalk.red('测试运行失败:'), err);
  process.exit(1);
});
