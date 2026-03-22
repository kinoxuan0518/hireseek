// @hireclaw/core/outreach — 触达策略引擎（模板版本）
//
// Template-based outreach message generation + tier classification + outreach planning.
// This is the fallback when LLM is unavailable.

import type {
  Candidate,
  JobConfig,
  EvaluationResult,
  OutreachConfig,
  OutreachMessage,
  OutreachRecord,
  ConversationStatus,
} from '../types.js';

// ────────────────────────────────────────────────────────────
// Candidate Tier Classification
// ────────────────────────────────────────────────────────────

/**
 * 候选人段位 — 决定触达投入程度
 */
export type Tier = 'critical' | 'high' | 'medium' | 'low';

/** 从评估结果推算段位 */
export function classifyTier(result: EvaluationResult): Tier {
  if (result.score >= 90 && result.vetoed.length === 0) return 'critical';
  if (result.score >= 80) return 'high';
  if (result.score >= 65) return 'medium';
  return 'low';
}

/** 段位对应的触达策略 */
export const TIER_STRATEGY: Record<Tier, {
  maxAttempts: number;
  switchPlatform: boolean;
  researchDepth: 'deep' | 'standard' | 'skip';
  followUpDelayDays: number;
  description: string;
}> = {
  critical: {
    maxAttempts: 5,
    switchPlatform: true,
    researchDepth: 'deep',
    followUpDelayDays: 3,
    description: '顶级目标：深挖背景，多平台触达，每次换角度',
  },
  high: {
    maxAttempts: 3,
    switchPlatform: true,
    researchDepth: 'standard',
    followUpDelayDays: 5,
    description: '优秀候选人：研究背景，多次触达，换平台',
  },
  medium: {
    maxAttempts: 1,
    switchPlatform: false,
    researchDepth: 'skip',
    followUpDelayDays: 0,
    description: '普通候选人：一条消息，没回就过',
  },
  low: {
    maxAttempts: 0,
    switchPlatform: false,
    researchDepth: 'skip',
    followUpDelayDays: 0,
    description: '不值得追：直接跳过',
  },
};

// ────────────────────────────────────────────────────────────
// Template-based Message Generation
// ────────────────────────────────────────────────────────────

export interface MessageContext {
  candidate: Candidate;
  evaluation: EvaluationResult;
  job: JobConfig;
  tier: Tier;
  attemptNumber: number;
  previousMessages?: string[];
  brandTone?: string;
}

/**
 * 生成触达消息（模板版本 — fallback）
 */
export function generateMessage(context: MessageContext): OutreachMessage {
  const { candidate, evaluation, job, tier, attemptNumber, previousMessages, brandTone } = context;

  const personalDetails = extractPersonalDetails(candidate, job);

  // Level 4
  if (personalDetails.standout && personalDetails.depth >= 3) {
    return {
      content: buildLevel4Message(candidate, job, personalDetails, brandTone, attemptNumber),
      level: 4,
      reasoning: `使用Level4话术：有${personalDetails.standout.length}个突出点，素材深度${personalDetails.depth}`,
      suggestedTime: suggestContactTime(candidate),
    };
  }

  // Level 3
  if (personalDetails.insight) {
    return {
      content: buildLevel3Message(candidate, job, personalDetails, brandTone, attemptNumber),
      level: 3,
      reasoning: `使用Level3话术：推断候选人${personalDetails.insight}`,
      suggestedTime: suggestContactTime(candidate),
    };
  }

  // Level 2
  if (personalDetails.specifics.length > 0) {
    return {
      content: buildLevel2Message(candidate, job, personalDetails, brandTone, attemptNumber),
      level: 2,
      reasoning: `使用Level2话术：${personalDetails.specifics.join('、')}`,
      suggestedTime: suggestContactTime(candidate),
    };
  }

  // Level 1
  return {
    content: buildLevel1Message(job, brandTone),
    level: 1,
    reasoning: '使用Level1通用话术：缺少个性化素材',
    suggestedTime: undefined,
  };
}

// ────────────────────────────────────────────────────────────
// Personal Detail Extraction
// ────────────────────────────────────────────────────────────

interface PersonalDetails {
  standout: string[];
  specifics: string[];
  insight?: string;
  depth: number;
}

function extractPersonalDetails(candidate: Candidate, job: JobConfig): PersonalDetails {
  const details: PersonalDetails = { standout: [], specifics: [], depth: 0 };
  const edu = candidate.profile.education;
  const exp = candidate.profile.experience;
  const skills = candidate.profile.skills;

  if (edu.length > 0) {
    const top = edu[edu.length - 1];
    if (top.school) {
      details.specifics.push(`${top.school}${top.degree ? top.degree : ''}${top.major ? '·' + top.major : ''}`);
      details.depth++;
    }
    if (top.gpa && (typeof top.gpa === 'number' ? top.gpa : parseFloat(String(top.gpa))) >= 3.8) {
      details.standout.push(`高绩点${top.gpa}`);
      details.depth++;
    }
  }

  if (exp.length > 0) {
    const recent = exp[exp.length - 1];
    details.specifics.push(`${recent.company}·${recent.title}`);
    details.depth++;

    const desc = recent.description ?? '';
    const quantified = desc.match(/提升\d+%|降低\d+%|\d+x|增长\d+|覆盖\d+/);
    if (quantified) {
      details.standout.push(`有量化成果(${quantified[0]})`);
      details.depth++;
    }

    const led = /负责|主导|独立|带领/.test(desc);
    if (led) {
      details.standout.push('有主导经验');
      details.depth++;
    }
  }

  if (skills.length > 0) {
    const jobKeywords = (job.description + ' ' + job.title).toLowerCase();
    const matched = skills.filter(s => jobKeywords.includes(s.toLowerCase()));
    if (matched.length > 0) {
      details.specifics.push(`技能匹配: ${matched.slice(0, 3).join('、')}`);
      details.depth++;
    }
  }

  details.insight = inferCandidateSituation(candidate);

  return details;
}

function inferCandidateSituation(candidate: Candidate): string | undefined {
  const exp = candidate.profile.experience;
  if (!exp || exp.length === 0) return undefined;

  const latest = exp[exp.length - 1];
  const yearsAtLatest = estimateTenureMonths(latest);

  if (latest.isTopCompany && yearsAtLatest >= 36) {
    return '大厂稳定3年+，可能渴望更大自主空间或创业机会';
  }
  if (latest.isTopCompany && yearsAtLatest < 18) {
    return '大厂待的时间不长，可能在寻找更合适的环境';
  }
  if (latest.isTopCompany && yearsAtLatest >= 12) {
    return '有明星公司经历，应该在意方向和团队质量';
  }

  const topEdu = candidate.profile.education[candidate.profile.education.length - 1];
  if (topEdu?.degree === '本科' && exp.length === 1 && yearsAtLatest < 24) {
    return '刚工作不久，应该在意成长路径和技术深度';
  }

  if (exp.length >= 3) {
    return '有多段经历，可能还在寻找最合适的方向';
  }

  return undefined;
}

function estimateTenureMonths(exp: { startDate?: string; endDate?: string; duration?: string }): number {
  if (exp.duration) {
    const match = exp.duration.match(/(\d+)年/);
    if (match) return parseInt(match[1]) * 12;
    const monthMatch = exp.duration.match(/(\d+)个?月/);
    if (monthMatch) return parseInt(monthMatch[1]);
  }
  if (exp.startDate && exp.endDate) {
    const ms = new Date(exp.endDate).getTime() - new Date(exp.startDate).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24 * 30));
  }
  return 12;
}

// ────────────────────────────────────────────────────────────
// Message Builders
// ────────────────────────────────────────────────────────────

function buildLevel4Message(
  candidate: Candidate,
  job: JobConfig,
  details: PersonalDetails,
  brandTone: string | undefined,
  attemptNumber: number
): string {
  const name = candidate.name;
  const insight = details.insight;
  const hook = details.standout[0] ?? details.specifics[0] ?? '';

  const templates: string[] = [];

  if (insight?.includes('自主空间') || insight?.includes('创业')) {
    templates.push(
      `${name}你好，看到你在${details.specifics[1]?.split('·')[0] ?? '现公司'}做了${details.specifics[1]?.split('·')[1] ?? '一段时间'}，${hook}。我猜你可能在找更有自主空间的机会？${jobTitleAndHighlight(job)}，想聊聊吗？`
    );
  } else if (insight?.includes('成长路径')) {
    templates.push(
      `${name}你好，${hook}。我们团队在做${job.description?.slice(0, 50) ?? job.title}，节奏快，能接触核心技术，不是螺丝钉。有兴趣聊聊吗？`
    );
  } else if (insight?.includes('方向和团队')) {
    templates.push(
      `${name}你好，注意到你在${details.specifics.map(s => s.split('·')[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join('和')}的经历。我们现在的方向我觉得你会感兴趣——${jobTitleAndHighlight(job)}。方便聊聊吗？`
    );
  } else if (insight?.includes('寻找')) {
    templates.push(
      `${name}你好，看了你的经历${details.specifics.length > 0 ? '（' + details.specifics.slice(-2).join(' → ') + '）' : ''}，感觉你在找真正能沉下来做事的地方。我们正在做${job.title}，${details.standout[0] ? '你这个背景正好对口' : '技术栈匹配度高'}，有空聊聊吗？`
    );
  }

  if (templates.length === 0) {
    const specificLine = details.specifics.slice(0, 2).join('，然后');
    templates.push(
      `${name}你好，${specificLine}${details.standout.length > 0 ? '，' + details.standout[0] : ''}。我们在找${job.title}，看了你的背景觉得值得一聊。不是海投——是因为${details.specifics[0]}让我觉得你可能是对的人。方便聊聊吗？`
    );
  }

  let msg = templates[0];

  if (attemptNumber > 1) {
    msg = `${name}，之前给你发过消息不知道你看到没有。${retryAngle(candidate, details, job, attemptNumber)}`;
  }

  return msg;
}

function buildLevel3Message(
  candidate: Candidate,
  job: JobConfig,
  details: PersonalDetails,
  brandTone: string | undefined,
  attemptNumber: number
): string {
  const name = candidate.name;
  const insight = details.insight ?? '可能在寻找新的机会';

  if (attemptNumber > 1) {
    return `${name}，上次给你发过消息。想了想你的情况——${insight}——觉得我们这边确实值得你了解一下。${jobTitleAndHighlight(job)}。有空的话可以聊聊？`;
  }

  return `${name}你好，看了你的经历${details.specifics.length > 0 ? '（' + details.specifics[0] + '）' : ''}。${insight}，我们正在做${job.title}，觉得你可能会有兴趣。方便聊聊吗？`;
}

function buildLevel2Message(
  candidate: Candidate,
  job: JobConfig,
  details: PersonalDetails,
  brandTone: string | undefined,
  attemptNumber: number
): string {
  const name = candidate.name;
  const specificLine = details.specifics.slice(0, 2).join('，');

  if (attemptNumber > 1) {
    return `${name}你好，之前联系过你。我们这边还在找${job.title}，${specificLine}的背景真的很匹配。如果方便的话可以聊聊？`;
  }

  return `${name}你好，看到你的背景${specificLine}，和我们正在招的${job.title}方向很匹配。方便了解一下这个机会吗？`;
}

function buildLevel1Message(job: JobConfig, brandTone?: string): string {
  const highlights = brandTone ? `我们${brandTone}` : '';
  return `您好，我们正在招聘${job.title}${job.description ? '，' + job.description.slice(0, 60) : ''}。${highlights}，如果您有兴趣了解，欢迎回复交流。`;
}

function retryAngle(
  candidate: Candidate,
  details: PersonalDetails,
  job: JobConfig,
  attempt: number
): string {
  const angles: string[] = [
    `看到你${details.specifics[0] ?? '有相关经验'}，和我们${job.title}岗位的匹配度其实很高。`,
    `我们最近在${job.description?.slice(0, 40) ?? job.title}方面有一些新进展，觉得你可能会感兴趣。`,
    `方便的话简单聊几句就行，不耽误你太多时间。`,
  ];

  const idx = (attempt - 2) % angles.length;
  return angles[idx];
}

// ────────────────────────────────────────────────────────────
// Contact Time Suggestion
// ────────────────────────────────────────────────────────────

function suggestContactTime(candidate: Candidate): string {
  const ext = candidate.profile.ext;
  const hobbies = ext?.hobbies as string[] | string | undefined;
  if (hobbies) {
    const h = Array.isArray(hobbies) ? hobbies.join(' ') : hobbies;
    if (/篮球|足球|健身|跑步|运动/.test(h)) {
      return '工作日 10:00-11:30（运动型，上午精力好）';
    }
    if (/阅读|写作|编程|游戏/.test(h)) {
      return '工作日 14:00-17:00（深度型，下午适合长消息）';
    }
  }
  return '工作日 10:00-11:30 或 14:00-16:00';
}

function jobTitleAndHighlight(job: JobConfig): string {
  if (job.outreach?.companyHighlights && job.outreach.companyHighlights.length > 0) {
    return `我们做${job.title}（${job.outreach.companyHighlights[0]}）`;
  }
  return `我们在招${job.title}`;
}

// ────────────────────────────────────────────────────────────
// Outreach Planning
// ────────────────────────────────────────────────────────────

export interface OutreachPlan {
  candidateId: string;
  candidateName: string;
  tier: Tier;
  shouldContact: boolean;
  attempts: PlannedAttempt[];
  reason: string;
}

export interface PlannedAttempt {
  attemptNumber: number;
  platform: string;
  delayDays: number;
  angle: string;
}

export function planOutreach(
  candidate: Candidate,
  evaluation: EvaluationResult,
  job: JobConfig,
  availablePlatforms: string[] = ['boss', 'maimai'],
  existingRecords: OutreachRecord[] = []
): OutreachPlan {
  const tier = classifyTier(evaluation);
  const strategy = TIER_STRATEGY[tier];

  if (tier === 'low') {
    return {
      candidateId: candidate.id,
      candidateName: candidate.name,
      tier,
      shouldContact: false,
      attempts: [],
      reason: '评估分数过低，不值得触达',
    };
  }

  const sentCount = existingRecords.filter(r => r.result === 'sent').length;
  const remainingAttempts = strategy.maxAttempts - sentCount;

  if (remainingAttempts <= 0) {
    return {
      candidateId: candidate.id,
      candidateName: candidate.name,
      tier,
      shouldContact: false,
      attempts: [],
      reason: `已达最大触达次数 (${strategy.maxAttempts})`,
    };
  }

  const attempts: PlannedAttempt[] = [];
  const platforms = strategy.switchPlatform && availablePlatforms.length > 1
    ? availablePlatforms
    : [availablePlatforms[0] ?? 'boss'];

  for (let i = 0; i < remainingAttempts; i++) {
    const attemptNum = sentCount + i + 1;
    attempts.push({
      attemptNumber: attemptNum,
      platform: platforms[i % platforms.length],
      delayDays: i === 0 ? 0 : strategy.followUpDelayDays * i,
      angle: i === 0 ? '首次触达' : `第${attemptNum}次触达，换${platforms[i % platforms.length]}平台`,
    });
  }

  return {
    candidateId: candidate.id,
    candidateName: candidate.name,
    tier,
    shouldContact: true,
    attempts,
    reason: strategy.description,
  };
}

export function planOutreachBatch(
  candidatesWithResults: Array<{ candidate: Candidate; evaluation: EvaluationResult }>,
  job: JobConfig,
  options: {
    availablePlatforms?: string[];
    existingRecords?: Map<string, OutreachRecord[]>;
    dailyLimit?: number;
  } = {}
): OutreachPlan[] {
  const {
    availablePlatforms = ['boss', 'maimai'],
    existingRecords = new Map(),
    dailyLimit = 50,
  } = options;

  const plans = candidatesWithResults.map(({ candidate, evaluation }) =>
    planOutreach(candidate, evaluation, job, availablePlatforms, existingRecords.get(candidate.id) ?? [])
  );

  const contactPlans = plans.filter(p => p.shouldContact);

  const tierOrder: Record<Tier, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  contactPlans.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  return contactPlans.slice(0, dailyLimit);
}

// ────────────────────────────────────────────────────────────
// Funnel Tracking
// ────────────────────────────────────────────────────────────

export interface FunnelStats {
  total: number;
  byTier: Record<Tier, number>;
  contacted: number;
  replied: number;
  replyRate: number;
  byStatus: Record<string, number>;
}

export function calculateFunnel(
  plans: OutreachPlan[],
  records: OutreachRecord[]
): FunnelStats {
  const byTier: Record<Tier, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byStatus: Record<string, number> = {};

  for (const plan of plans) {
    byTier[plan.tier]++;
  }

  const contacted = records.filter(r => r.result === 'sent').length;
  const replied = records.filter(r => r.response === 'replied').length;

  for (const record of records) {
    const status = record.response ?? 'unknown';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return {
    total: plans.length,
    byTier,
    contacted,
    replied,
    replyRate: contacted > 0 ? Math.round((replied / contacted) * 100) / 100 : 0,
    byStatus,
  };
}
