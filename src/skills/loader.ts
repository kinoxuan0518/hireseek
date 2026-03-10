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
  channels?: Channel[];
  daily_goal?: { contact: number; quality: number };
  urgency?: string;
  deadline?: string;
}

export function loadActiveJob(): JobConfig | null {
  const filePath = path.join(config.workspace.dir, 'jobs', 'active.yaml');
  if (!fs.existsSync(filePath)) return null;
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) as JobConfig;
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

export function loadSkill(channel: Channel): string {
  const filePath = path.join(config.workspace.dir, 'skills', SKILL_FILES[channel]);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Skill 文件不存在: ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

export function loadWorkspaceFile(filename: string): string {
  const filePath = path.join(config.workspace.dir, filename);

  if (!fs.existsSync(filePath)) {
    return '';
  }

  return fs.readFileSync(filePath, 'utf-8');
}
