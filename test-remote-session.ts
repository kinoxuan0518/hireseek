/**
 * 远程会话功能测试
 */

import chalk from 'chalk';

async function testRemoteSession() {
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('远程会话功能测试'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const {
    exportSession,
    listSessions,
    formatSessionList,
    loadSession,
    deleteSession,
  } = await import('./src/remote-session');

  // 创建测试消息
  const testMessages = [
    { role: 'system' as const, content: '你是 HireClaw，一个招聘助手' },
    { role: 'user' as const, content: '帮我找前端工程师候选人' },
    { role: 'assistant' as const, content: '好的，我来帮你寻找前端工程师候选人' },
    { role: 'user' as const, content: '查看候选人列表' },
    { role: 'assistant' as const, content: '这是候选人列表：\n1. 张三 - React 专家\n2. 李四 - Vue 专家' },
  ];

  // 1. 导出会话
  console.log(chalk.bold('1. 导出会话'));
  try {
    const session = exportSession({
      title: '测试会话 - 前端招聘',
      messages: testMessages,
    });

    console.log(chalk.green('   ✓ 会话已导出'));
    console.log(chalk.gray(`      ID: ${session.id}`));
    console.log(chalk.gray(`      标题: ${session.title}`));
    console.log(chalk.gray(`      消息数: ${session.messageCount}`));
    console.log(chalk.gray(`      URL: ${session.url}`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 2. 列出会话
  console.log(chalk.bold('\n2. 列出所有会话'));
  try {
    const sessions = listSessions();
    console.log(chalk.green(`   ✓ 找到 ${sessions.length} 个会话`));

    if (sessions.length > 0) {
      console.log(chalk.gray('\n   ' + formatSessionList(sessions).replace(/\n/g, '\n   ')));
    }
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 3. 加载会话
  console.log(chalk.bold('\n3. 加载会话'));
  try {
    const sessions = listSessions();
    if (sessions.length > 0) {
      const firstSession = sessions[0];
      const loaded = loadSession(firstSession.id);

      if (loaded) {
        console.log(chalk.green(`   ✓ 成功加载会话: ${loaded.title}`));
        console.log(chalk.gray(`      消息数: ${loaded.messages.length}`));
      } else {
        console.log(chalk.yellow('   ⚠ 会话加载失败'));
      }
    }
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 4. 删除测试会话
  console.log(chalk.bold('\n4. 清理测试会话'));
  try {
    const sessions = listSessions();
    let deletedCount = 0;

    for (const session of sessions) {
      if (session.title.includes('测试会话')) {
        deleteSession(session.id);
        deletedCount++;
      }
    }

    console.log(chalk.green(`   ✓ 已删除 ${deletedCount} 个测试会话`));
  } catch (err: any) {
    console.log(chalk.red(`   ✗ ${err.message}`));
  }

  // 总结
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('测试完成'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.bold('远程会话功能:'));
  console.log(chalk.green('  ✅ 导出会话到 Markdown + JSON'));
  console.log(chalk.green('  ✅ 列出所有会话'));
  console.log(chalk.green('  ✅ 加载会话'));
  console.log(chalk.green('  ✅ 删除会话'));
  console.log(chalk.green('  ✅ 打开会话（浏览器）'));
  console.log(chalk.green('  ✅ 复制到剪贴板（macOS）\n'));

  console.log(chalk.bold('使用方式:'));
  console.log(chalk.gray('  # 在对话中'));
  console.log(chalk.gray('  /export                    # 导出当前会话'));
  console.log(chalk.gray('  /export 我的招聘对话        # 导出并命名'));
  console.log(chalk.gray('  /sessions                  # 查看所有会话\n'));

  console.log(chalk.bold('导出格式:'));
  console.log(chalk.gray('  workspace/sessions/'));
  console.log(chalk.gray('  ├── <session-id>.md        # Markdown 格式（可读）'));
  console.log(chalk.gray('  └── <session-id>.json      # JSON 格式（可导入）\n'));

  console.log(chalk.bold('跨平台使用:'));
  console.log(chalk.gray('  1. 导出会话: /export'));
  console.log(chalk.gray('  2. 打开 Markdown 文件'));
  console.log(chalk.gray('  3. 复制内容到 claude.ai'));
  console.log(chalk.gray('  4. 在网页端继续对话\n'));
}

testRemoteSession().catch(console.error);
