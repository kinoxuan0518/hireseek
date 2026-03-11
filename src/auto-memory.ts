/**
 * Auto Memory - 跨会话自动学习和记忆系统
 * 类似 Claude Code 的 auto memory 功能
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';

const MEMORY_DIR = path.join(config.workspace.dir, 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md');
const MAX_MEMORY_LINES = 200; // MEMORY.md 最多 200 行，超出会截断

export interface MemoryEntry {
  topic: string;
  content: string;
  timestamp: string;
}

/**
 * 确保 memory 目录存在
 */
function ensureMemoryDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }

  // 如果 MEMORY.md 不存在，创建默认内容
  if (!fs.existsSync(MEMORY_FILE)) {
    const defaultContent = `# HireClaw 自动记忆

这个文件会自动记录 HireClaw 学到的招聘经验、用户偏好、常见模式等。
每次启动时，这些内容会注入到系统提示中。

## 使用规则

- 记录稳定的模式和约定（跨多次对话验证）
- 记录关键决策、重要文件路径、项目结构
- 记录用户偏好（工作流、工具、沟通风格）
- 记录常见问题的解决方案
- **不要**记录会话临时信息
- **不要**记录未验证的推测
- **不要**记录与 SOUL.md/PLAYBOOK.md 重复的内容

## 记忆索引

下面按主题组织详细笔记，超过 200 行的部分会被截断：

`;
    fs.writeFileSync(MEMORY_FILE, defaultContent, 'utf-8');
  }
}

/**
 * 读取 MEMORY.md 内容（会截断到 200 行）
 */
export function loadMemory(): string {
  ensureMemoryDir();

  if (!fs.existsSync(MEMORY_FILE)) {
    return '';
  }

  const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
  const lines = content.split('\n');

  if (lines.length <= MAX_MEMORY_LINES) {
    return content;
  }

  // 截断到 200 行，并添加提示
  const truncated = lines.slice(0, MAX_MEMORY_LINES).join('\n');
  return truncated + '\n\n_[后续内容已截断，详见主题文件]_';
}

/**
 * 写入 MEMORY.md（保留前 200 行）
 */
export function saveMemory(content: string): void {
  ensureMemoryDir();

  const lines = content.split('\n');
  if (lines.length > MAX_MEMORY_LINES) {
    console.warn(`[Memory] MEMORY.md 超过 ${MAX_MEMORY_LINES} 行，建议移动到主题文件`);
  }

  fs.writeFileSync(MEMORY_FILE, content, 'utf-8');
}

/**
 * 追加记忆到 MEMORY.md
 */
export function appendMemory(section: string, item: string): void {
  ensureMemoryDir();

  let content = fs.readFileSync(MEMORY_FILE, 'utf-8');

  // 查找对应的 section
  const sectionHeader = `## ${section}`;
  const sectionIndex = content.indexOf(sectionHeader);

  if (sectionIndex === -1) {
    // Section 不存在，添加新 section
    content += `\n\n${sectionHeader}\n\n- ${item}\n`;
  } else {
    // 在 section 后添加
    const nextSectionIndex = content.indexOf('\n## ', sectionIndex + 1);
    const insertPos = nextSectionIndex === -1 ? content.length : nextSectionIndex;
    content = content.slice(0, insertPos) + `- ${item}\n` + content.slice(insertPos);
  }

  saveMemory(content);
}

/**
 * 读取主题文件
 */
export function loadTopicFile(topic: string): string {
  ensureMemoryDir();

  const filename = `${topic}.md`;
  const filepath = path.join(MEMORY_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return '';
  }

  return fs.readFileSync(filepath, 'utf-8');
}

/**
 * 写入主题文件
 */
export function saveTopicFile(topic: string, content: string): void {
  ensureMemoryDir();

  const filename = `${topic}.md`;
  const filepath = path.join(MEMORY_DIR, filename);

  fs.writeFileSync(filepath, content, 'utf-8');
}

/**
 * 列出所有主题文件
 */
export function listTopicFiles(): string[] {
  ensureMemoryDir();

  const files = fs.readdirSync(MEMORY_DIR);
  return files
    .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
    .map(f => f.replace('.md', ''));
}

/**
 * 搜索过去的对话记录（从 .jsonl 文件）
 */
export function searchPastContext(searchTerm: string, limit: number = 10): string[] {
  const projectDir = path.dirname(MEMORY_DIR); // workspace/memory -> workspace
  const parentDir = path.dirname(projectDir); // workspace -> project root

  // 查找 .claude/projects 目录下的 .jsonl 文件
  const claudeDir = path.join(process.env.HOME || '', '.claude', 'projects');

  if (!fs.existsSync(claudeDir)) {
    return [];
  }

  const results: string[] = [];

  // 递归查找所有 .jsonl 文件
  function searchDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.name.endsWith('.jsonl')) {
        searchInJsonl(fullPath);
      }
    }
  }

  function searchInJsonl(filepath: string) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines) {
        if (results.length >= limit) return;

        try {
          const entry = JSON.parse(line);
          const text = JSON.stringify(entry).toLowerCase();

          if (text.includes(searchTerm.toLowerCase())) {
            results.push(line);
          }
        } catch {
          // 跳过无效 JSON
        }
      }
    } catch (err) {
      // 跳过无法读取的文件
    }
  }

  searchDir(claudeDir);
  return results;
}

/**
 * 创建默认主题文件
 */
export function initializeDefaultTopics(): void {
  ensureMemoryDir();

  // 1. 招聘模式
  const recruitingPatterns = `# 招聘模式记忆

记录成功的招聘模式、策略、话术等。

## 成功的触达话术

_待自动学习记录_

## 有效的筛选标准

_待自动学习记录_

## 渠道效果分析

_待自动学习记录_
`;

  // 2. 候选人偏好
  const candidatePreferences = `# 候选人偏好记忆

记录用户对候选人的偏好和要求。

## 优先特征

_待自动学习记录_

## 排除条件

_待自动学习记录_

## 特殊要求

_待自动学习记录_
`;

  // 3. 调试经验
  const debugging = `# 调试经验记忆

记录常见错误和解决方案。

## 常见错误

_待自动学习记录_

## 解决方案

_待自动学习记录_
`;

  // 4. 工作流偏好
  const workflow = `# 工作流偏好记忆

记录用户的工作流程和沟通偏好。

## 执行偏好

_待自动学习记录_

## 沟通风格

_待自动学习记录_

## 工具选择

_待自动学习记录_
`;

  const topics = [
    { name: 'recruiting-patterns', content: recruitingPatterns },
    { name: 'candidate-preferences', content: candidatePreferences },
    { name: 'debugging', content: debugging },
    { name: 'workflow', content: workflow },
  ];

  for (const topic of topics) {
    const filepath = path.join(MEMORY_DIR, `${topic.name}.md`);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, topic.content, 'utf-8');
    }
  }
}

/**
 * 删除记忆条目（用户要求忘记某些内容）
 */
export function forgetMemory(pattern: string): boolean {
  ensureMemoryDir();

  let modified = false;

  // 1. 从 MEMORY.md 中删除匹配的行
  if (fs.existsSync(MEMORY_FILE)) {
    let content = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const lines = content.split('\n');
    const filtered = lines.filter(line => !line.toLowerCase().includes(pattern.toLowerCase()));

    if (filtered.length < lines.length) {
      fs.writeFileSync(MEMORY_FILE, filtered.join('\n'), 'utf-8');
      modified = true;
    }
  }

  // 2. 从主题文件中删除匹配的行
  const topics = listTopicFiles();
  for (const topic of topics) {
    const filepath = path.join(MEMORY_DIR, `${topic}.md`);
    let content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');
    const filtered = lines.filter(line => !line.toLowerCase().includes(pattern.toLowerCase()));

    if (filtered.length < lines.length) {
      fs.writeFileSync(filepath, filtered.join('\n'), 'utf-8');
      modified = true;
    }
  }

  return modified;
}

/**
 * 获取完整的记忆上下文（用于注入系统提示）
 */
export function getMemoryContext(): string {
  const memory = loadMemory();

  if (!memory.trim()) {
    return '';
  }

  return `
# Auto Memory

以下是跨会话记忆的内容，这些是之前学到的稳定模式和用户偏好：

${memory}

参考这些记忆来更好地理解用户需求和工作方式。
`;
}
