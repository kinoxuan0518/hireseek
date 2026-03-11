/**
 * Skill 调用系统
 * 类似 Claude Code 的 /skill 命令
 * 用户可以通过 /skill-name 快速执行预定义的技能
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string; // 技能的完整提示词
  args?: string[]; // 可接受的参数
}

const SKILLS_DIR = path.join(config.workspace.dir, 'chat-skills');

/**
 * 确保 chat-skills 目录存在
 */
function ensureSkillsDir(): void {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

/**
 * 列出所有可用的技能
 */
export function listSkills(): SkillDefinition[] {
  ensureSkillsDir();

  const files = fs.readdirSync(SKILLS_DIR);
  const skills: SkillDefinition[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const filepath = path.join(SKILLS_DIR, file);
    const content = fs.readFileSync(filepath, 'utf-8');

    // 解析技能定义
    const nameMatch = content.match(/^#\s+(.+)$/m);
    const descMatch = content.match(/^>\s+(.+)$/m);

    if (nameMatch && descMatch) {
      skills.push({
        name: file.replace('.md', ''),
        description: descMatch[1],
        prompt: content,
      });
    }
  }

  return skills;
}

/**
 * 加载指定技能
 */
export function loadSkill(skillName: string): SkillDefinition | null {
  ensureSkillsDir();

  const filepath = path.join(SKILLS_DIR, `${skillName}.md`);

  if (!fs.existsSync(filepath)) {
    return null;
  }

  const content = fs.readFileSync(filepath, 'utf-8');

  // 解析技能定义
  const nameMatch = content.match(/^#\s+(.+)$/m);
  const descMatch = content.match(/^>\s+(.+)$/m);

  if (!nameMatch || !descMatch) {
    return null;
  }

  return {
    name: skillName,
    description: descMatch[1],
    prompt: content,
  };
}

/**
 * 创建默认技能
 */
export function initializeDefaultSkills(): void {
  ensureSkillsDir();

  const defaultSkills = [
    {
      name: '找候选人',
      file: 'find-candidates.md',
      content: `# 找候选人

> 自动执行 sourcing 任务，在各个招聘渠道寻找候选人

## 参数

- 职位名称（可选）：如"前端工程师"、"产品经理"

## 执行流程

1. 读取职位配置（workspace/jobs/active.yaml）
2. 确定要搜索的渠道
3. 调用 run_sourcing 工具执行
4. 返回找到的候选人数量

## 示例

\`\`\`
用户: /找候选人 前端工程师
AI: 开始为「前端工程师」职位寻找候选人...
    [执行 sourcing]
    ✓ 完成！在 BOSS直聘找到 15 人，脉脉找到 8 人
\`\`\`
`,
    },
    {
      name: '分析简历',
      file: 'analyze-resume.md',
      content: `# 分析简历

> 读取并分析候选人简历 PDF，给出结构化评估

## 参数

- PDF 文件路径（必需）：候选人简历的绝对路径

## 执行流程

1. 读取 PDF 文件
2. 提取关键信息：
   - 姓名、联系方式
   - 工作经验、教育背景
   - 技术栈、项目经历
3. 与职位要求匹配
4. 给出评分和建议

## 示例

\`\`\`
用户: /分析简历 /path/to/张三_简历.pdf
AI: 正在分析简历...

    姓名：张三
    工作经验：5 年前端开发
    技术栈：React, Vue, Node.js, TypeScript
    教育背景：本科，计算机科学，985 高校

    匹配度：⭐⭐⭐⭐ (4/5)
    - 技术栈完全匹配
    - 大厂经验丰富（字节、阿里）
    - 有开源贡献

    建议：优先联系，安排初步沟通
\`\`\`
`,
    },
    {
      name: '候选人漏斗',
      file: 'funnel.md',
      content: `# 候选人漏斗

> 查看当前职位的招聘漏斗数据和转化率

## 参数

无

## 执行流程

1. 调用 get_funnel 工具
2. 分析各阶段转化率
3. 识别瓶颈环节
4. 给出优化建议

## 示例

\`\`\`
用户: /候选人漏斗
AI: 正在查看招聘漏斗...

    触达：120 人
    回复：45 人 (37.5%)
    面试：12 人 (26.7%)
    Offer：3 人 (25%)
    入职：1 人 (33%)

    分析：
    - 回复率偏低，建议优化触达话术
    - 面试转化率正常
    - 目前漏斗健康，继续保持节奏
\`\`\`
`,
    },
    {
      name: 'commit',
      file: 'commit.md',
      content: `# Commit

> 自动提交代码更改到 git 仓库

## 参数

- 提交信息（可选）：如"feat: add new feature"
- 文件列表（可选）：要提交的文件，不填则提交所有更改

## 执行流程

1. 检查 git 状态
2. 如果有未提交的更改：
   - 自动生成提交信息（如果未提供）
   - 提交更改
3. 返回提交 SHA 和分支信息

## 示例

\`\`\`
用户: /commit
AI: 检查 git 状态...
    发现 3 个已修改文件

    生成提交信息：feat: add auto memory and skill system

    提交成功！
    SHA: a1b2c3d4
    分支: main
\`\`\`
`,
    },
  ];

  for (const skill of defaultSkills) {
    const filepath = path.join(SKILLS_DIR, skill.file);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, skill.content, 'utf-8');
    }
  }
}

/**
 * 解析用户输入中的技能调用
 */
export function parseSkillInvocation(userInput: string): {
  isSkill: boolean;
  skillName: string;
  args: string;
} {
  // 检查是否以 / 开头
  if (!userInput.startsWith('/')) {
    return { isSkill: false, skillName: '', args: '' };
  }

  // 提取技能名和参数
  const match = userInput.match(/^\/([^\s]+)\s*(.*)$/);
  if (!match) {
    return { isSkill: false, skillName: '', args: '' };
  }

  return {
    isSkill: true,
    skillName: match[1],
    args: match[2].trim(),
  };
}

/**
 * 执行技能
 */
export function executeSkill(skillName: string, args: string): string {
  const skill = loadSkill(skillName);

  if (!skill) {
    return `未找到技能: /${skillName}\n\n可用技能:\n${listSkills()
      .map(s => `  /${s.name} - ${s.description}`)
      .join('\n')}`;
  }

  // 返回技能的完整提示词，替换参数占位符
  let prompt = skill.prompt;

  // 替换 {args} 占位符
  if (args) {
    prompt = prompt.replace(/\{args\}/g, args);
  }

  // 添加执行指令
  return `
执行技能: /${skillName}

${prompt}

---

请根据上述技能定义执行任务。参数: ${args || '(无)'}
`.trim();
}

/**
 * 格式化技能列表
 */
export function formatSkillList(): string {
  const skills = listSkills();

  if (skills.length === 0) {
    return '暂无可用技能';
  }

  let output = '可用技能：\n\n';
  for (const skill of skills) {
    output += `/${skill.name}\n  ${skill.description}\n\n`;
  }

  return output.trim();
}
