/**
 * DOM Runner 冒烟测试
 *
 * 用法：DEEPSEEK_API_KEY=sk-... npx tsx test-dom-runner.ts
 *
 * 不碰招聘平台：让 DeepSeek 操作百度完成一次搜索，验证
 * ①快照提取 ②ref 定位点击 ③输入与回车 ④任务自主终止。
 */

import { chromium } from 'playwright';
import { DomRunner } from './src/runners/dom-runner';
import { config } from './src/config';

async function main() {
  if (!config.deepseek.apiKey) {
    console.error('❌ 请先设置 DEEPSEEK_API_KEY');
    process.exit(1);
  }

  console.log(`🔱 DOM Runner 冒烟测试 | 模型: ${config.deepseek.model}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded' });

  const runner = new DomRunner(
    config.deepseek.baseUrl,
    config.deepseek.apiKey,
    config.deepseek.model,
  );

  const result = await runner.runSkill(
    page,
    '你是一个浏览器操作测试助手。',
    [
      '在当前页面的搜索框中输入"DeepSeek"，按回车搜索。',
      '看到搜索结果后，任务即完成，输出总结。',
      '总结格式：',
      '触达人数: 0',
      '跳过人数: 0',
      '候选人摘要: 冒烟测试，搜索结果首条标题为 <标题>',
    ].join('\n'),
    msg => console.log(`  ${msg}`),
  );

  console.log('\n══════ 测试结果 ══════');
  console.log(result.summary || '（无总结）');
  console.log('═════════════════════');

  await browser.close();
  const ok = /DeepSeek|deepseek|搜索/i.test(result.summary);
  console.log(ok ? '✅ 冒烟测试通过' : '⚠️ 总结内容异常，请人工检查');
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error('❌ 冒烟测试失败:', err.message);
  process.exit(1);
});
