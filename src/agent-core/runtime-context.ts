import { config } from '../config';
import {
  getEnabledChannels,
  loadActiveJob,
  type JobConfig,
} from '../skills/loader';
import type { Channel } from '../types';

export interface RuntimeContext {
  app: {
    name: 'HireSeek';
    cwd: string;
  };
  llm: {
    provider: string;
    model: string;
    verifierModel: string;
  };
  paths: {
    dbPath: string;
    workspaceDir: string;
    knowledgeHome: string;
    skillHomes: string[];
  };
  flags: {
    externalSkillsEnabled: boolean;
    legacySkillPreload: boolean;
  };
  activeJob: JobConfig | null;
  activeJobId: string;
  enabledChannels: Array<{ channel: Channel; accounts: number }>;
}

function jobIdOf(job: JobConfig | null): string {
  return job ? job.title.replace(/\s+/g, '_') : 'default';
}

/**
 * 场景无关的运行上下文。
 *
 * 这里只暴露事实和资源入口，不做招聘判断，不解释策略，也不编码任何渠道规则。
 */
export function createRuntimeContext(): RuntimeContext {
  const activeJob = loadActiveJob();
  return {
    app: {
      name: 'HireSeek',
      cwd: process.cwd(),
    },
    llm: {
      provider: config.llm.provider,
      model: process.env.LLM_MODEL || config.llm.model,
      verifierModel: config.verifier.model,
    },
    paths: {
      dbPath: config.db.path,
      workspaceDir: config.workspace.dir,
      knowledgeHome: config.knowledge.home,
      skillHomes: [...config.skills.homes],
    },
    flags: {
      externalSkillsEnabled: config.skills.externalEnabled,
      legacySkillPreload: config.skills.preloadLegacyForProductizedChannels,
    },
    activeJob,
    activeJobId: jobIdOf(activeJob),
    enabledChannels: activeJob ? getEnabledChannels(activeJob) : [],
  };
}
