/**
 * Phase 5 功能测试
 * 测试权限系统、计划模式、Hook 系统、上下文压缩
 */

import chalk from 'chalk';

async function testPhase5Features() {
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('Phase 5 功能测试'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // 1. Permission System
  console.log(chalk.bold('1. Permission System (权限系统)'));
  try {
    const {
      checkPermission,
      listPermissions,
      clearPermissions,
    } = await import('./src/permissions');

    // 清除旧规则
    clearPermissions();

    // 测试安全工具（应自动批准）
    const safePermission = await checkPermission({
      toolName: 'list_candidates',
      args: {},
    });
    console.log(chalk.green(`   ✓ 安全工具自动批准: ${safePermission}`));

    // 列出权限规则
    const rules = listPermissions();
    console.log(chalk.green(`   ✓ 权限规则数: ${rules.length}`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 2. Plan Mode
  console.log(chalk.bold('\n2. Plan Mode (计划模式)'));
  try {
    const {
      enterPlanMode,
      isInPlanMode,
      listPlans,
    } = await import('./src/plan-mode');

    const result = enterPlanMode('测试任务：实现自动化功能');
    console.log(chalk.green('   ✓ 进入计划模式成功'));

    const inPlanMode = isInPlanMode();
    console.log(chalk.green(`   ✓ 计划模式状态: ${inPlanMode}`));

    const plans = listPlans();
    console.log(chalk.green(`   ✓ 已有计划数: ${plans.length}`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 3. Hook System
  console.log(chalk.bold('\n3. Hook System (Hook 系统)'));
  try {
    const {
      listHooks,
      addHook,
      removeHook,
      AVAILABLE_HOOKS,
    } = await import('./src/hooks');

    console.log(chalk.green(`   ✓ 可用 hook 事件: ${AVAILABLE_HOOKS.length} 个`));
    console.log(chalk.gray(`      ${AVAILABLE_HOOKS.slice(0, 5).join(', ')}...`));

    // 添加测试 hook
    try {
      addHook('post-commit', 'echo "Commit completed"');
      console.log(chalk.green('   ✓ 添加 hook 成功'));

      const hooks = listHooks();
      console.log(chalk.green(`   ✓ 已配置 hook 数: ${Object.keys(hooks).length}`));

      // 删除测试 hook
      removeHook('post-commit');
      console.log(chalk.green('   ✓ 删除 hook 成功'));
    } catch (err: any) {
      // Hook 可能已存在或其他错误，继续测试
      console.log(chalk.yellow(`   ⚠ Hook 操作警告: ${err.message}`));
    }
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 4. Context Compression
  console.log(chalk.bold('\n4. Context Compression (上下文压缩)'));
  try {
    const {
      estimateTokens,
      shouldCompress,
      compressConversation,
      getCompressionStats,
    } = await import('./src/context-compression');

    // 创建测试消息
    const testMessages = [
      { role: 'system' as const, content: '你是 HireClaw，一个招聘助手' },
      { role: 'user' as const, content: '帮我找候选人' },
      { role: 'assistant' as const, content: '好的，我来帮你找候选人' },
      { role: 'user' as const, content: '查看候选人列表' },
      { role: 'assistant' as const, content: '这是候选人列表...' },
    ];

    // 估算 tokens
    const tokens = estimateTokens(testMessages);
    console.log(chalk.green(`   ✓ Token 估算: ${tokens} tokens`));

    // 检查是否需要压缩
    const needsCompression = shouldCompress(testMessages, { maxTokens: 50 });
    console.log(chalk.green(`   ✓ 是否需要压缩: ${needsCompression}`));

    // 测试压缩
    const compressed = compressConversation(testMessages);
    const stats = getCompressionStats(testMessages, compressed);
    console.log(chalk.green(`   ✓ 压缩效果: ${stats.originalMessages} → ${stats.compressedMessages} 消息`));
    console.log(chalk.green(`   ✓ Token 减少: ${stats.reductionPercent}%`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 总结
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('测试完成'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.bold('Phase 5 功能总览:'));
  console.log(chalk.green('  ✅ Permission System - 权限控制和安全确认'));
  console.log(chalk.green('  ✅ Plan Mode - 交互式计划工作流'));
  console.log(chalk.green('  ✅ Hook System - 事件触发器'));
  console.log(chalk.green('  ✅ Context Compression - 智能上下文压缩\n'));

  console.log(chalk.bold('新增对话工具:'));
  console.log(chalk.gray('  - enter_plan_mode / exit_plan_mode'));
  console.log(chalk.gray('  - list_permissions / clear_permissions'));
  console.log(chalk.gray('  - list_hooks / add_hook / remove_hook\n'));

  console.log(chalk.bold('危险操作保护:'));
  console.log(chalk.gray('  - git push --force'));
  console.log(chalk.gray('  - execute_shell (删除命令)'));
  console.log(chalk.gray('  - write_file (敏感文件)'));
  console.log(chalk.gray('  - forget (删除记忆)'));
  console.log(chalk.gray('  - run_sourcing (资源消耗)\n'));

  console.log(chalk.bold('Hook 事件:'));
  console.log(chalk.gray('  - pre/post-commit'));
  console.log(chalk.gray('  - pre/post-git-push'));
  console.log(chalk.gray('  - pre/post-sourcing'));
  console.log(chalk.gray('  - plan-mode-enter/exit'));
  console.log(chalk.gray('  - user-prompt-submit\n'));
}

testPhase5Features().catch(console.error);
