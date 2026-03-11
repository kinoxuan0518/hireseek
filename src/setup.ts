/**
 * HireClaw 交互式初始化向导
 * 像小龙虾一样一步步引导你配置好一切
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const ENV_PATH  = path.join(process.cwd(), '.env');
const JOB_PATH  = path.join(process.cwd(), 'workspace', 'jobs', 'active.yaml');

// ── readline helpers ─────────────────────────────────────
function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim())));
}

function askDefault(rl: readline.Interface, question: string, def: string): Promise<string> {
  return new Promise(resolve =>
    rl.question(`${question} ${chalk.gray(`[${def}]`)} `, ans => {
      const v = ans.trim();
      resolve(v === '' ? def : v);
    })
  );
}

function askYN(rl: readline.Interface, question: string, def = 'y'): Promise<boolean> {
  const hint = def === 'y' ? chalk.gray('[Y/n]') : chalk.gray('[y/N]');
  return new Promise(resolve =>
    rl.question(`${question} ${hint} `, ans => {
      const v = ans.trim().toLowerCase();
      if (v === '') resolve(def === 'y');
      else resolve(v === 'y' || v === 'yes');
    })
  );
}

// ── .env 读写 ────────────────────────────────────────────
function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function writeEnv(env: Record<string, string>): void {
  const lines = Object.entries(env)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
}

// ── active.yaml 写入 ─────────────────────────────────────
function writeJobYaml(fields: {
  title: string;
  mustHave: string[];
  niceToHave: string[];
  channels: string[];
  salaryMin: string;
  salaryMax: string;
  dailyContact: string;
  urgency: string;
}): void {
  const yaml = `# 当前激活的招聘职位（由 hireclaw setup 生成）
title: ${fields.title}
department: 技术

requirements:
  must_have:
${fields.mustHave.map(s => `    - ${s}`).join('\n')}
  nice_to_have:
${fields.niceToHave.length > 0 ? fields.niceToHave.map(s => `    - ${s}`).join('\n') : '    []'}
  deal_breaker:
    - 跳槽超过 3 次且无合理解释
    - 简历模糊、夸大其词

salary:
  min: ${fields.salaryMin}
  max: ${fields.salaryMax}
  unit: 月薪（税前）

channels:
${fields.channels.map(c => `  - ${c}`).join('\n')}

daily_goal:
  contact: ${fields.dailyContact}
  quality: 5

urgency: ${fields.urgency}
`;
  fs.mkdirSync(path.dirname(JOB_PATH), { recursive: true });
  fs.writeFileSync(JOB_PATH, yaml);
}

// ── 测试 LLM 连接 ─────────────────────────────────────────
async function testConnection(env: Record<string, string>): Promise<boolean> {
  try {
    const OpenAI = (await import('openai')).default;
    const apiKey  = env.CUSTOM_API_KEY || env.ANTHROPIC_API_KEY || '';
    const baseURL = env.CUSTOM_BASE_URL || undefined;
    const model   = env.LLM_MODEL || 'claude-sonnet-4-6';

    const client = new OpenAI({ apiKey, baseURL });
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: '回复 ok 两个字' }],
      max_tokens: 10,
    });
    return !!res.choices[0]?.message?.content;
  } catch {
    return false;
  }
}

// ── 分节 banner ──────────────────────────────────────────
function section(title: string): void {
  console.log('\n' + chalk.cyan('────────────────────────────────'));
  console.log(chalk.cyan(`  ${title}`));
  console.log(chalk.cyan('────────────────────────────────') + '\n');
}

// ── 主向导 ───────────────────────────────────────────────
export async function runSetup(): Promise<void> {
  console.log(chalk.cyan('\n🦞 HireClaw 初始化向导\n'));
  console.log(chalk.gray('我会一步步引导你配置好所有东西，大概 3 分钟。'));
  console.log(chalk.gray('随时按 Ctrl+C 退出，已填的不会丢失。\n'));

  const rl  = createRl();
  const env = readEnv();

  try {

    // ── STEP 1: API Key ──────────────────────────────────
    section('第一步：配置 AI 大模型');

    const hasKey = env.ANTHROPIC_API_KEY || env.CUSTOM_API_KEY;
    if (hasKey) {
      console.log(chalk.green('✓ 已检测到 API Key，跳过此步'));
    } else {
      console.log('HireClaw 需要一个 AI 大模型来驱动智能对话。\n');
      console.log(chalk.bold('🌟 推荐模型（按性价比排序）：\n'));

      console.log(`  ${chalk.cyan('1')}  ${chalk.white('Anthropic Claude Sonnet 4.5')} ${chalk.gray('（推荐）')}`);
      console.log(chalk.gray('      性能强、稳定、支持工具调用'));
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://console.anthropic.com'));
      console.log('');

      console.log(`  ${chalk.cyan('2')}  ${chalk.white('DeepSeek Chat')}`);
      console.log(chalk.gray('      国产大模型、便宜、中文友好'));
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://platform.deepseek.com'));
      console.log('');

      console.log(`  ${chalk.cyan('3')}  ${chalk.white('OpenRouter')}`);
      console.log(chalk.gray('      支持 100+ 模型、按需切换'));
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://openrouter.ai/settings/keys'));
      console.log('');

      console.log(`  ${chalk.cyan('4')}  ${chalk.white('OpenAI GPT-4o')}`);
      console.log(chalk.gray('      经典选择、生态完善'));
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://platform.openai.com/api-keys'));
      console.log('');

      console.log(`  ${chalk.cyan('5')}  ${chalk.white('Moonshot AI (月之暗面)')}`);
      console.log(chalk.gray('      国产、支持 200K 上下文'));
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://platform.moonshot.cn/console/api-keys'));
      console.log('');

      console.log(`  ${chalk.cyan('6')}  ${chalk.white('智谱 GLM-4-Plus')}`);
      console.log(chalk.gray('      国产、支持工具调用'));
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://open.bigmodel.cn/usercenter/apikeys'));
      console.log('');

      console.log(`  ${chalk.cyan('7')}  ${chalk.white('阿里通义千问')}`);
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://dashscope.console.aliyun.com/apiKey'));
      console.log('');

      console.log(`  ${chalk.cyan('8')}  ${chalk.white('百度文心一言')}`);
      console.log(chalk.gray('      获取 Key: ') + chalk.blue('https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application'));
      console.log('');

      console.log(`  ${chalk.cyan('9')}  ${chalk.white('其他 OpenAI 兼容 API')}`);
      console.log(chalk.gray('      自定义 Base URL 和模型\n'));

      const choice = await askDefault(rl, '选择模型 (1-9)', '1');

      let configured = false;

      if (choice === '1') {
        // Anthropic Claude
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://console.anthropic.com') + chalk.gray(' 创建 API Key'));
        const key = await ask(rl, chalk.white('\nAnthropic API Key (sk-ant-...): '));
        if (key) {
          env.LLM_PROVIDER = 'claude';
          env.LLM_MODEL = 'claude-sonnet-4-5';
          env.ANTHROPIC_API_KEY = key;
          configured = true;
        }
      } else if (choice === '2') {
        // DeepSeek
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://platform.deepseek.com') + chalk.gray(' 注册并创建 Key'));
        const key = await ask(rl, chalk.white('\nDeepSeek API Key: '));
        if (key) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = 'deepseek-chat';
          env.CUSTOM_API_KEY = key;
          env.CUSTOM_BASE_URL = 'https://api.deepseek.com';
          configured = true;
        }
      } else if (choice === '3') {
        // OpenRouter
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://openrouter.ai/settings/keys') + chalk.gray(' 创建免费 Key'));
        const key = await ask(rl, chalk.white('\nOpenRouter API Key (sk-or-v1-...): '));
        const model = await askDefault(rl, '选择模型', 'anthropic/claude-sonnet-4-5');
        if (key) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = model;
          env.CUSTOM_API_KEY = key;
          env.CUSTOM_BASE_URL = 'https://openrouter.ai/api/v1';
          configured = true;
        }
      } else if (choice === '4') {
        // OpenAI
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://platform.openai.com/api-keys') + chalk.gray(' 创建 Key'));
        const key = await ask(rl, chalk.white('\nOpenAI API Key (sk-...): '));
        if (key) {
          env.LLM_PROVIDER = 'openai';
          env.LLM_MODEL = 'gpt-4o';
          env.OPENAI_API_KEY = key;
          configured = true;
        }
      } else if (choice === '5') {
        // Moonshot
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://platform.moonshot.cn/console/api-keys') + chalk.gray(' 创建 Key'));
        const key = await ask(rl, chalk.white('\nMoonshot API Key: '));
        if (key) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = 'moonshot-v1-8k';
          env.CUSTOM_API_KEY = key;
          env.CUSTOM_BASE_URL = 'https://api.moonshot.cn/v1';
          configured = true;
        }
      } else if (choice === '6') {
        // 智谱 GLM
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://open.bigmodel.cn/usercenter/apikeys') + chalk.gray(' 创建 Key'));
        const key = await ask(rl, chalk.white('\n智谱 API Key: '));
        if (key) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = 'glm-4-plus';
          env.CUSTOM_API_KEY = key;
          env.CUSTOM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
          configured = true;
        }
      } else if (choice === '7') {
        // 通义千问
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://dashscope.console.aliyun.com/apiKey') + chalk.gray(' 创建 Key'));
        const key = await ask(rl, chalk.white('\n通义千问 API Key: '));
        if (key) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = 'qwen-plus';
          env.CUSTOM_API_KEY = key;
          env.CUSTOM_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
          configured = true;
        }
      } else if (choice === '8') {
        // 百度文心
        console.log(chalk.gray('\n💡 提示：访问 ') + chalk.blue('https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application'));
        console.log(chalk.yellow('      注意：文心一言需要 API Key 和 Secret Key 两个值'));
        const apiKey = await ask(rl, chalk.white('\nAPI Key: '));
        const secretKey = await ask(rl, chalk.white('Secret Key: '));
        if (apiKey && secretKey) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = 'ernie-4.0-8k';
          env.CUSTOM_API_KEY = apiKey;
          env.CUSTOM_BASE_URL = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro?access_token=${secretKey}`;
          configured = true;
        }
      } else {
        // 自定义
        console.log(chalk.gray('\n请手动输入以下信息：'));
        const baseUrl = await ask(rl, chalk.white('API Base URL: '));
        const key = await ask(rl, chalk.white('API Key: '));
        const model = await ask(rl, chalk.white('模型 ID: '));
        if (key && baseUrl && model) {
          env.LLM_PROVIDER = 'custom';
          env.LLM_MODEL = model;
          env.CUSTOM_API_KEY = key;
          env.CUSTOM_BASE_URL = baseUrl;
          configured = true;
        }
      }

      if (configured) {
        writeEnv(env);
        console.log(chalk.green('\n✓ API Key 已保存到 .env 文件'));
      } else {
        console.log(chalk.yellow('\n⚠️  未配置 API Key，稍后可运行 hireclaw setup 重新配置'));
      }
    }

    // ── STEP 2: 测试连接 ─────────────────────────────────
    section('第二步：测试 AI 连接');
    process.stdout.write('正在测试连接...');
    const ok = await testConnection(env);
    if (ok) {
      console.log(' ' + chalk.green('✓ 连接成功！'));
    } else {
      console.log(' ' + chalk.red('✗ 连接失败'));
      console.log(chalk.yellow('  Key 可能有误，或者网络不通。先继续配置，后续再修复。'));
    }

    // ── STEP 3: 职位配置 ─────────────────────────────────
    section('第三步：设置招聘职位');

    const existingJob = fs.existsSync(JOB_PATH) &&
      fs.readFileSync(JOB_PATH, 'utf-8').includes('title:') &&
      !fs.readFileSync(JOB_PATH, 'utf-8').includes('title: AI 算法工程师');

    if (existingJob) {
      const skip = await askYN(rl, '检测到已有职位配置，是否跳过？', 'y');
      if (skip) {
        console.log(chalk.green('✓ 保留现有职位配置'));
      } else {
        await collectJobInfo(rl);
      }
    } else {
      console.log('告诉我你在招什么人，我来帮你设置。\n');
      await collectJobInfo(rl);
    }

    // ── STEP 4: BOSS直聘 ─────────────────────────────────
    section('第四步：登录 BOSS直聘');
    console.log('HireClaw 需要在浏览器里操作 BOSS直聘。');
    console.log('请确保你已经在 BOSS直聘企业端 登录好账号。\n');
    console.log(chalk.gray('  如果还没登录，现在去浏览器登录一下，回来再继续。'));
    await ask(rl, chalk.white('\n登录好了，按 Enter 继续...'));
    console.log(chalk.green('✓ 记录在案'));

    // ── STEP 5: 完成 ─────────────────────────────────────
    section('🎉 初始化完成！');

    console.log(chalk.green('恭喜！HireClaw 已经配置完成，随时可以开始工作。\n'));

    console.log(chalk.bold('📖 常用命令：\n'));
    console.log(`  ${chalk.cyan('hireclaw')}            → 对话模式，自然语言控制一切`);
    console.log(`  ${chalk.cyan('hireclaw run')}        → 自动执行 sourcing`);
    console.log(`  ${chalk.cyan('hireclaw scan')}       → 扫描收件箱，更新回复`);
    console.log(`  ${chalk.cyan('hireclaw funnel')}     → 查看招聘漏斗数据`);
    console.log(`  ${chalk.cyan('hireclaw dashboard')}  → 启动可视化控制台\n`);

    console.log(chalk.bold('💡 对话模式示例：\n'));
    console.log(chalk.gray('  • "帮我在 BOSS直聘找 10 个前端工程师"'));
    console.log(chalk.gray('  • "查看今天沟通的候选人"'));
    console.log(chalk.gray('  • "把张三标记为已面试"'));
    console.log(chalk.gray('  • "分析一下候选人回复率"\n'));

    console.log(chalk.gray(`完整手册：workspace/PLAYBOOK.md\n`));

  } finally {
    rl.close();
  }
}

// ── 职位信息收集（提取为函数供复用）────────────────────
async function collectJobInfo(rl: readline.Interface): Promise<void> {
  const title = await askDefault(rl, '职位名称', 'AI 工程师');

  console.log(chalk.gray('\n以逗号分隔，例如：有实际落地经验, 逻辑清晰, 数据支撑'));
  const mustHaveStr = await ask(rl, chalk.white('硬性要求（必须有）: '));
  const mustHave = mustHaveStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);

  const niceStr = await ask(rl, chalk.white('加分项（可留空）: '));
  const niceToHave = niceStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);

  const salaryMin = await askDefault(rl, '薪资下限（月）', '20000');
  const salaryMax = await askDefault(rl, '薪资上限（月）', '40000');

  console.log(chalk.gray('\n可选渠道：boss / maimai / linkedin'));
  const channelsStr = await askDefault(rl, '使用哪些渠道（逗号分隔）', 'boss,maimai');
  const channels = channelsStr.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(s =>
    ['boss', 'maimai', 'linkedin', 'followup'].includes(s)
  );

  const dailyContact = await askDefault(rl, '每日触达目标人数', '30');

  const urgency = await askDefault(rl, '紧急程度 (low/medium/high)', 'high');

  writeJobYaml({ title, mustHave, niceToHave, channels, salaryMin, salaryMax, dailyContact, urgency });
  console.log(chalk.green(`\n✓ 职位「${title}」已保存到 workspace/jobs/active.yaml`));
}

