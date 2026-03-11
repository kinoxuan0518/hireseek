/**
 * 测试 Glob 和 Grep 搜索工具
 */

import { searchFiles, formatGlobResults } from './src/tools/glob';
import { searchContent, formatGrepResults } from './src/tools/grep';

async function testSearchTools() {
  console.log('\n🧪 测试搜索工具...\n');

  // Test 1: Glob - 搜索所有 TypeScript 文件
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Glob - 搜索所有 .ts 文件');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const tsFiles = await searchFiles({ pattern: 'src/**/*.ts', limit: 10 });
  console.log(formatGlobResults(tsFiles, 'src/**/*.ts'));

  // Test 2: Glob - 搜索 workspace 下的 Markdown 文件
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 2: Glob - 搜索 workspace 下的 .md 文件');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mdFiles = await searchFiles({ pattern: 'workspace/**/*.md', limit: 10 });
  console.log(formatGlobResults(mdFiles, 'workspace/**/*.md'));

  // Test 3: Grep - 搜索函数定义
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 3: Grep - 搜索 "function runJob"');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const funcMatches = await searchContent({
    pattern: 'function runJob',
    filePattern: '*.ts',
    limit: 5,
  });
  console.log(formatGrepResults(funcMatches, 'function runJob'));

  // Test 4: Grep - 搜索配置项
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 4: Grep - 搜索 "LLM_PROVIDER"');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const configMatches = await searchContent({
    pattern: 'LLM_PROVIDER',
    limit: 10,
  });
  console.log(formatGrepResults(configMatches, 'LLM_PROVIDER'));

  // Test 5: Grep - 忽略大小写搜索
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 5: Grep - 搜索 "channel"（忽略大小写）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const channelMatches = await searchContent({
    pattern: 'channel',
    filePattern: '*.ts',
    ignoreCase: true,
    limit: 5,
  });
  console.log(formatGrepResults(channelMatches, 'channel'));

  console.log('\n🎉 测试完成！\n');
}

testSearchTools().catch(console.error);
