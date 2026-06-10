/**
 * Claude Skills 桥接层
 *
 * 自动扫描并接管用户本机的 Claude Code 技能（~/.claude/skills 及插件市场目录），
 * 让 HireSeek（DeepSeek 驱动）可以直接调用全部招聘技能：
 * rbt、maimai-recruiter、talent-sourcing、candidate-intelligence、
 * blacklake-targeted-talent-hunting、bosszhibin-auto-recruiter 等。
 *
 * 技能格式：<skill-dir>/SKILL.md，YAML frontmatter 含 name/description，正文为执行指令。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';

export interface ClaudeSkill {
  name: string;
  description: string;
  /** SKILL.md 正文（不含 frontmatter） */
  body: string;
  /** 技能目录，body 中的相对路径引用（references/ scripts/）以此为根 */
  dir: string;
  /** 来源：user（~/.claude/skills）或 plugin */
  source: 'user' | 'plugin';
}

const SKILL_ROOTS: Array<{ dir: string; source: ClaudeSkill['source'] }> = [
  { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'user' },
  // rbt 编排的 BOSS直聘技能包（bosszhibin-auto-recruiter / message-resume-handler）
  { dir: path.join(os.homedir(), '.rbt', 'skills'), source: 'user' },
  // 额外技能目录（冒号分隔），如 HIRESEEK_SKILL_DIRS=~/my-skills:~/team-skills
  ...(process.env.HIRESEEK_SKILL_DIRS ?? '')
    .split(':')
    .filter(Boolean)
    .map(d => ({
      dir: d.startsWith('~') ? path.join(os.homedir(), d.slice(1)) : d,
      source: 'user' as const,
    })),
];

/** 插件市场目录下的技能（anthropic-skills 等） */
function pluginSkillDirs(): string[] {
  const marketplaces = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
  if (!fs.existsSync(marketplaces)) return [];

  const found: string[] = [];
  // marketplaces/<market>/**/skills/<skill>/SKILL.md（限制深度，避免全盘扫描）
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, 'SKILL.md'))) {
        found.push(sub);
      } else {
        walk(sub, depth + 1);
      }
    }
  };
  walk(marketplaces, 0);
  return found;
}

function parseSkillFile(skillDir: string, source: ClaudeSkill['source']): ClaudeSkill | null {
  const file = path.join(skillDir, 'SKILL.md');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  let name = path.basename(skillDir);
  let description = '';
  let body = raw;

  if (fmMatch) {
    body = raw.slice(fmMatch[0].length);
    try {
      const fm = yaml.load(fmMatch[1]) as { name?: string; description?: string };
      if (fm?.name) name = String(fm.name);
      if (fm?.description) description = String(fm.description).trim();
    } catch {
      // frontmatter 解析失败时退回目录名
    }
  }

  if (!description) {
    // 没有 frontmatter 描述时取正文首个非标题段落
    description = body
      .split('\n')
      .find(l => l.trim() && !l.startsWith('#'))?.trim()
      .slice(0, 200) ?? '';
  }

  return { name, description, body, dir: skillDir, source };
}

let cache: ClaudeSkill[] | null = null;

/** 扫描全部 Claude 技能（结果缓存，进程内只扫一次） */
export function listClaudeSkills(forceRefresh = false): ClaudeSkill[] {
  if (cache && !forceRefresh) return cache;

  const skills = new Map<string, ClaudeSkill>();

  // 用户技能优先级最高，后扫的插件技能不覆盖同名用户技能
  for (const root of SKILL_ROOTS) {
    if (!fs.existsSync(root.dir)) continue;
    for (const entry of fs.readdirSync(root.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = parseSkillFile(path.join(root.dir, entry.name), root.source);
      if (skill) skills.set(skill.name, skill);
    }
  }

  for (const dir of pluginSkillDirs()) {
    const skill = parseSkillFile(dir, 'plugin');
    if (skill && !skills.has(skill.name)) skills.set(skill.name, skill);
  }

  cache = Array.from(skills.values());
  return cache;
}

export function getClaudeSkill(name: string): ClaudeSkill | null {
  return listClaudeSkills().find(s => s.name === name) ?? null;
}

/**
 * 把技能转换成可注入 LLM 的执行提示词。
 * 附带技能目录路径，技能内引用的 references/ scripts/ 可被后续工具调用读取。
 */
export function skillToPrompt(skill: ClaudeSkill, args?: string): string {
  return [
    `# 技能: ${skill.name}`,
    `技能目录: ${skill.dir}（正文中的相对路径以此为根）`,
    args ? `用户参数: ${args}` : '',
    '---',
    skill.body,
    '---',
    '请严格按照上述技能定义执行任务。',
  ].filter(Boolean).join('\n\n');
}

/** 技能注册表摘要（供 LLM 路由选择，控制 token） */
export function skillCatalog(): string {
  return listClaudeSkills()
    .map(s => `- ${s.name}: ${s.description.slice(0, 150)}`)
    .join('\n');
}

/**
 * 智能路由：根据任务描述匹配最合适的技能。
 * 先做关键词粗筛，多个候选时返回全部，由调用方（LLM）最终决定。
 */
export function matchSkills(task: string): ClaudeSkill[] {
  const skills = listClaudeSkills();
  const lower = task.toLowerCase();

  const scored = skills
    .map(s => {
      let score = 0;
      if (lower.includes(s.name.toLowerCase())) score += 10;
      // 描述中的触发关键词命中（按引号内词组与常见平台词）
      const keywords = s.description.match(/[“"「]([^”"」]{2,12})[”"」]/g) ?? [];
      for (const kw of keywords) {
        const clean = kw.replace(/[“”"「」]/g, '');
        if (lower.includes(clean.toLowerCase())) score += 3;
      }
      for (const platform of ['boss', '脉脉', 'maimai', 'linkedin', '竞调', '尽调', '背调', '寻源', '挖猎', 'sourcing']) {
        if (lower.includes(platform) && s.description.toLowerCase().includes(platform)) score += 2;
      }
      return { skill: s, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map(x => x.skill);
}
