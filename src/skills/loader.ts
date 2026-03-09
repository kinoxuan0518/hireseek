import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { Channel } from '../types';

const SKILL_FILES: Record<Channel, string> = {
  boss: 'boss.md',
  maimai: 'maimai.md',
  linkedin: 'linkedin.md',
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
