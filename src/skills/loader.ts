import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import type { Channel } from '../types';

export interface JobConfig {
  title: string;
  department?: string;
  requirements?: {
    must_have?: string[];
    nice_to_have?: string[];
    deal_breaker?: string[];
  };
  salary?: { min: number; max: number; unit: string };
  channels?: {
    [key in Channel]?: {
      enabled: boolean;
      accounts: number;
    };
  };
  daily_goal?: { contact: number; quality: number };
  urgency?: string;
  deadline?: string;
}

export function loadActiveJob(): JobConfig | null {
  const filePath = path.join(config.workspace.dir, 'jobs', 'active.yaml');
  if (!fs.existsSync(filePath)) return null;
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) as JobConfig;
}

/** 获取启用的渠道及其账号配置 */
export function getEnabledChannels(job: JobConfig): Array<{ channel: Channel; accounts: number }> {
  if (!job.channels) return [];
  return (Object.keys(job.channels) as Channel[])
    .filter(ch => job.channels![ch]?.enabled)
    .map(ch => ({ channel: ch, accounts: job.channels![ch]!.accounts }))
    .filter(({ accounts }) => accounts > 0);
}

export function jobToPrompt(job: JobConfig): string {
  const lines = [`## 当前招聘职位：${job.title}`];
  if (job.department) lines.push(`部门：${job.department}`);
  if (job.urgency)    lines.push(`紧急程度：${job.urgency}${job.deadline ? `，截止日期：${job.deadline}` : ''}`);
  if (job.salary)     lines.push(`薪资范围：${job.salary.min}–${job.salary.max} ${job.salary.unit}`);

  if (job.requirements) {
    const r = job.requirements;
    if (r.must_have?.length)    lines.push(`\n必须具备：\n${r.must_have.map(s => `- ${s}`).join('\n')}`);
    if (r.nice_to_have?.length) lines.push(`\n加分项：\n${r.nice_to_have.map(s => `- ${s}`).join('\n')}`);
    if (r.deal_breaker?.length) lines.push(`\n一票否决：\n${r.deal_breaker.map(s => `- ${s}`).join('\n')}`);
  }

  if (job.daily_goal) {
    lines.push(`\n今日目标：触达 ${job.daily_goal.contact} 人，期望 ${job.daily_goal.quality} 人进入下一轮`);
  }

  return lines.join('\n');
}

const SKILL_FILES: Record<Channel, string> = {
  boss:     'boss.md',
  maimai:   'maimai.md',
  linkedin: 'linkedin.md',
  followup: 'followup.md',
};

const EXTERNAL_SKILL_FILES: Partial<Record<Channel, string>> = {
  boss:     path.join('bosszhibin-auto-recruiter', 'SKILL.md'),
  maimai:   path.join('maimai-recruiter', 'SKILL.md'),
  linkedin: path.join('linkedin-candidate-recruiter', 'SKILL.md'),
};

function readSkillFile(filePath: string, sourceLabel: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return [
    `<!-- HireSeek skill source: ${sourceLabel} -->`,
    [
      '# Skill 资产兼容层',
      '',
      '以下内容来自历史 skill，用作页面经验、异常案例、候选人判断样例和迁移素材。',
      '它不是 HireSeek 产品运行时的最高优先级协议。',
      '',
      '优先级规则：',
      '1. 代码层工具安全、风控、run trace、message history、结构化输出契约优先。',
      '2. HireSeek 产品中层协议（platform protocol / capability protocol）优先。',
      '3. 本 skill 资产只在不冲突时补充执行细节；若发生冲突，必须服从前两层。',
    ].join('\n'),
    content,
  ].join('\n\n');
}

export function loadSkill(channel: Channel): string {
  const externalRel = EXTERNAL_SKILL_FILES[channel];
  if (config.skills.externalEnabled && externalRel) {
    for (const home of config.skills.homes) {
      const externalPath = path.join(home, externalRel);
      const external = readSkillFile(externalPath, `external:${externalRel}`);
      if (external) return external;
    }
  }

  const filePath = path.join(config.workspace.dir, 'skills', SKILL_FILES[channel]);
  const fallback = readSkillFile(filePath, `workspace:${SKILL_FILES[channel]}`);
  if (fallback) return fallback;

  const tried = [
    ...(externalRel && config.skills.externalEnabled
      ? config.skills.homes.map(home => path.join(home, externalRel))
      : []),
    filePath,
  ].filter(Boolean).join(', ');
  throw new Error(`Skill 文件不存在: ${tried}`);
}

export function loadWorkspaceFile(filename: string): string {
  const filePath = path.join(config.workspace.dir, filename);

  if (!fs.existsSync(filePath)) {
    return '';
  }

  return fs.readFileSync(filePath, 'utf-8');
}
