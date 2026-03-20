// @hireclaw/core/evaluator — 候选人评估引擎
//
// 把 candidate-evaluation.md 的招聘知识变成可调用的评估引擎
// 支持：多维度打分、权重配置、一票否决、加分项、严格度级别

import type {
  Candidate,
  JobConfig,
  EvaluationConfig,
  EvaluationResult,
  EvaluationDimension,
  EvaluationDimensionDef,
  EvaluationWeights,
  VetoRule,
  BonusRule,
  DEFAULT_WEIGHTS,
} from '../types.js';

// ────────────────────────────────────────────────────────────
// Default Configuration
// ────────────────────────────────────────────────────────────

/** 默认权重（来自招聘经验总结） */
const DEFAULT_WEIGHTS_IMPL: EvaluationWeights = {
  education: 0.15,
  experience: 0.25,
  skills: 0.25,
  company: 0.15,
  growth: 0.10,
  personality: 0.10,
};

/** 默认通过阈值 */
const DEFAULT_THRESHOLD: Record<string, number> = {
  strict: 85,
  standard: 80,
  relaxed: 70,
};

/** 知名企业关键词 */
const TOP_COMPANIES = new Set([
  '字节跳动', '字节', 'bytedance',
  '腾讯', 'tencent',
  '阿里巴巴', '阿里', 'alibaba',
  '华为', 'huawei',
  '百度', 'baidu',
  '美团', 'meituan',
  '京东', 'jd',
  '拼多多', 'pdd',
  '蚂蚁', 'ant',
  '网易', 'netease',
  '快手', 'kuaishou',
  '小米', 'xiaomi',
  '微软', 'microsoft',
  '谷歌', 'google',
  'meta', 'facebook',
  'apple', '苹果',
  'amazon', '亚马逊',
  'openai', 'anthropic',
  'deepseek',
]);

/** 明星 AI/科技公司 */
const STAR_COMPANIES = new Set([
  '月之暗面', 'moonshot', 'kimi',
  '智谱', 'zhipu', 'chatglm',
  '百川智能', 'baichuan',
  'minimax',
  '零一万物', '01ai', 'yi',
  '阶跃星辰', 'stepfun',
  'deepseek',
  '商汤', 'sensetime',
  '科大讯飞', 'iflytek',
  '出门问问',
  '虹软',
  '思谋科技',
]);

/** 985/211 院校关键词 */
const TOP_SCHOOLS = new Set([
  '清华大学', '北大', '北京大学', '复旦大学', '上海交通大学', '上交', '浙江大学',
  '中国科学技术大学', '中科大', '南京大学', '南大', '哈尔滨工业大学', '哈工大',
  '西安交通大学', '西交', '中山大学', '中科大', '武汉大学', '武大', '华中科技大学',
  '华科', '同济大学', '同济', '北京航空航天大学', '北航', '天津大学', '天大',
  '东南大学', '北京理工大学', '北理工', '大连理工大学', '华南理工大学',
  '四川大学', '电子科技大学', '电子科大', '成电', '西北工业大学',
  '南开大学', '重庆大学', '中南大学', '吉林大学', '山东大学', '厦门大学',
  '中国人民大学', '人大', '北京师范大学', '北师大',
  'cambridge', 'oxford', 'mit', 'stanford', 'cmu', 'eth', 'berkeley',
]);

// ────────────────────────────────────────────────────────────
// Evaluation Dimension Evaluators
// ────────────────────────────────────────────────────────────

interface DimResult {
  score: number;
  notes: string;
}

/** 1. 学历与绩点评估 */
function evaluateEducation(
  candidate: Candidate,
  job: JobConfig
): DimResult {
  const edu = candidate.profile.education;
  if (!edu || edu.length === 0) return { score: 30, notes: '无学历信息' };

  // 取最高学历（按 endYear 排序，取最后一个）
  const sorted = [...edu].sort((a, b) => (b.endYear ?? 0) - (a.endYear ?? 0));
  const top = sorted[0];
  let score = 50;
  const notes: string[] = [];

  // 学校评估
  const schoolLower = top.school?.toLowerCase() ?? '';
  const isTop = [...TOP_SCHOOLS].some(s => schoolLower.includes(s.toLowerCase()));

  if (isTop) {
    score += 25;
    notes.push(`顶尖院校: ${top.school}`);
  } else if (top.degree === '硕士' || top.degree === '博士' || top.degree === 'Master' || top.degree === 'PhD') {
    score += 15;
    notes.push(`普通院校但${top.degree}学历`);
  } else {
    notes.push(`普通院校: ${top.school}`);
  }

  // 绩点评估
  if (top.gpa) {
    const gpa = typeof top.gpa === 'number' ? top.gpa : parseFloat(top.gpa);
    if (!isNaN(gpa)) {
      if (gpa >= 3.8 || (typeof top.gpa === 'string' && top.gpa.includes('/4.0') && gpa >= 3.5)) {
        score += 20;
        notes.push(`高绩点: ${top.gpa}，进取心强`);
      } else if (gpa >= 3.3) {
        score += 10;
        notes.push(`绩点尚可: ${top.gpa}`);
      } else {
        notes.push(`绩点偏低: ${top.gpa}`);
      }
    }
  }

  // 学历层次
  if (top.degree === '博士' || top.degree === 'PhD') {
    score += 5;
    notes.push('博士学位加分');
  }

  return { score: Math.min(100, score), notes: notes.join('；') };
}

/** 2. 公司背景评估 */
function evaluateCompany(
  candidate: Candidate
): DimResult {
  const exp = candidate.profile.experience;
  if (!exp || exp.length === 0) return { score: 30, notes: '无工作经历' };

  let score = 40;
  const notes: string[] = [];

  // 检查最近公司
  for (const e of exp) {
    const companyLower = e.company.toLowerCase();

    if ([...TOP_COMPANIES].some(c => companyLower.includes(c.toLowerCase()))) {
      score = Math.max(score, 85);
      notes.push(`大厂经历: ${e.company}`);
      e.isTopCompany = true;
    } else if ([...STAR_COMPANIES].some(c => companyLower.includes(c.toLowerCase()))) {
      score = Math.max(score, 80);
      notes.push(`明星公司: ${e.company}`);
      e.isTopCompany = true;
    }
  }

  // 如果没有知名公司，看经历丰富度
  if (notes.length === 0) {
    if (exp.length >= 3) {
      score += 15;
      notes.push(`${exp.length}段经历，有一定积累`);
    } else if (exp.length >= 2) {
      score += 8;
      notes.push(`${exp.length}段经历`);
    } else {
      notes.push('经历较少，需看具体内容');
    }
  }

  return { score: Math.min(100, score), notes: notes.join('；') };
}

/** 3. 技能匹配度评估 */
function evaluateSkills(
  candidate: Candidate,
  job: JobConfig
): DimResult {
  const candidateSkills = candidate.profile.skills;
  if (!candidateSkills || candidateSkills.length === 0) {
    return { score: 30, notes: '技能信息缺失' };
  }

  const notes: string[] = [];
  let score = 50;

  // 从职位描述中提取关键词
  const jobKeywords = extractKeywords(job.description ?? '' + ' ' + job.title);

  if (jobKeywords.length > 0) {
    const matched = candidateSkills.filter(s =>
      jobKeywords.some(k => s.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(s.toLowerCase()))
    );
    const matchRate = matched.length / Math.min(jobKeywords.length, 10);
    score += Math.round(matchRate * 40);
    notes.push(`技能匹配: ${matched.join(', ') || '无直接匹配'}`);
  } else {
    // 没有职位关键词，看技能数量和深度
    score += Math.min(20, candidateSkills.length * 3);
    notes.push(`${candidateSkills.length}项技能`);
  }

  // 看技能栈质量（有没有前沿技术）
  const hotSkills = ['pytorch', 'tensorflow', 'llm', 'rag', 'transformer', 'diffusion', 'reinforcement learning', '大模型', '深度学习'];
  const hasHotSkill = candidateSkills.some(s =>
    hotSkills.some(h => s.toLowerCase().includes(h))
  );
  if (hasHotSkill) {
    score += 10;
    notes.push('有前沿技术栈');
  }

  return { score: Math.min(100, score), notes: notes.join('；') };
}

/** 4. 实际做的事情评估（经验质量） */
function evaluateExperience(
  candidate: Candidate
): DimResult {
  const exp = candidate.profile.experience;
  if (!exp || exp.length === 0) return { score: 30, notes: '无经验信息' };

  let score = 50;
  const notes: string[] = [];

  for (const e of exp) {
    const desc = e.description ?? '';

    // 有具体项目描述
    if (desc.length > 100) {
      score += 10;
      notes.push('有详细项目描述');
    }

    // 有可量化的结果
    if (/\d+%/.test(desc) || /\d+x/.test(desc) || /提升|降低|增加|减少/.test(desc)) {
      score += 10;
      notes.push('有量化结果');
    }

    // 有技术选型理由
    if (/因为|选择|采用|基于|架构/.test(desc)) {
      score += 8;
      notes.push('有技术思考');
    }

    // 主导过项目（而非"参与"）
    if (/负责|主导|带领|独立|从.*到/.test(desc) && !/参与|协助|配合/.test(desc.substring(0, 50))) {
      score += 12;
      notes.push('有主导经验');
    }
  }

  if (notes.length === 0) {
    notes.push('描述模糊，无法判断实际贡献');
    score = 40;
  }

  return { score: Math.min(100, score), notes: notes.join('；') };
}

/** 5. 成长轨迹评估 */
function evaluateGrowth(
  candidate: Candidate
): DimResult {
  const exp = candidate.profile.experience;
  if (!exp || exp.length < 2) return { score: 50, notes: '经历不足，无法判断成长趋势' };

  let score = 60;
  const notes: string[] = [];

  // 跳槽频率
  const sorted = [...exp].sort((a, b) =>
    new Date(a.startDate ?? '2000').getTime() - new Date(b.startDate ?? '2000').getTime()
  );

  // 简单判断：如果有超过 3 段 < 1 年的经历
  const shortTenures = sorted.filter(e => {
    if (!e.startDate || !e.endDate) return false;
    const start = new Date(e.startDate);
    const end = new Date(e.endDate);
    const months = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30);
    return months < 12;
  });

  if (shortTenures.length >= 3) {
    score -= 20;
    notes.push(`频繁跳槽: ${shortTenures.length}段<1年经历`);
  } else if (shortTenures.length >= 2) {
    score -= 10;
    notes.push(`有${shortTenures.length}段短任期，需了解原因`);
  } else {
    notes.push('跳槽频率正常');
  }

  // 职级/方向是否在成长
  const titles = sorted.map(e => e.title).filter(Boolean);
  if (titles.length >= 2) {
    const lastTitle = titles[titles.length - 1];
    const hasSeniority = /高级|资深|专家|负责人|经理|总监|tech lead|senior|staff|principal/i.test(lastTitle);
    if (hasSeniority) {
      score += 15;
      notes.push(`职级在提升: ${lastTitle}`);
    }
  }

  // 方向是否一致（不是横向漂移）
  if (titles.length >= 2) {
    // 简单检查：title 之间是否有共同关键词
    const allKeywords = titles.flatMap(t => extractKeywords(t));
    const uniqueKeywords = new Set(allKeywords);
    if (uniqueKeywords.size < titles.length * 2) {
      score += 5;
      notes.push('职业方向有延续性');
    }
  }

  return { score: Math.min(100, Math.max(10, score)), notes: notes.join('；') };
}

/** 6. 个人特质评估 */
function evaluatePersonality(
  candidate: Candidate
): DimResult {
  let score = 60;
  const notes: string[] = [];

  const ext = candidate.profile.ext;
  if (!ext || Object.keys(ext).length === 0) return { score: 60, notes: '信息不足，默认中性评估' };

  // GitHub 活跃度
  const github = ext.github as Record<string, unknown> | undefined;
  if (github) {
    const repos = github.repos as number | undefined;
    const recentCommits = github.recentCommits as boolean | undefined;

    if (repos && repos > 10 && recentCommits) {
      score += 20;
      notes.push('GitHub 活跃，有创造力');
    } else if (repos && repos > 0) {
      score += 5;
      // 走过场 = 减分
      const forksOnly = github.forksOnly as boolean | undefined;
      if (forksOnly) {
        score -= 5;
        notes.push('GitHub 仅 fork，减分');
      } else {
        notes.push(`GitHub 有 ${repos} 个仓库`);
      }
    }
  }

  // 个人项目
  const hasPersonalProject = ext.personalProject as boolean | undefined;
  if (hasPersonalProject) {
    score += 10;
    notes.push('有个人项目，对技术有热情');
  }

  // 爱好推断特质
  const hobbies = ext.hobbies as string[] | string | undefined;
  if (hobbies) {
    const hobbyStr = Array.isArray(hobbies) ? hobbies.join(' ') : hobbies;
    if (/篮球|足球|排球/.test(hobbyStr)) {
      notes.push('团队运动 → 竞争心强，协作好');
      score += 5;
    }
    if (/阅读|写作|音乐|读书/.test(hobbyStr)) {
      notes.push('深度型爱好 → 适合研究方向');
      score += 5;
    }
    if (/投资|炒股|量化/.test(hobbyStr)) {
      notes.push('风险偏好型 → 决策风格进攻性');
      score += 3;
    }
  }

  // 简历"有趣度"（乱但有趣 = 加分，乱且无聊 = 减分）
  const rawText = candidate.source.rawText ?? '';
  if (rawText.length > 0) {
    const isMessy = rawText.length > 2000 && (rawText.match(/\n\n/g) || []).length > 20;
    if (isMessy) {
      // 看有没有有趣的内容
      const interesting = /有趣的|创新的|挑战|热爱|突破|开源|论文|专利/.test(rawText);
      if (interesting) {
        score += 10;
        notes.push('简历乱但有亮点 → 可能是天才型');
      }
    }
  }

  return { score: Math.min(100, score), notes: notes.join('；') || '默认中性评估' };
}

// ────────────────────────────────────────────────────────────
// Built-in Veto & Bonus Rules
// ────────────────────────────────────────────────────────────

const DEFAULT_VETOES: VetoRule[] = [
  {
    description: '第一学历一般且无任何亮点',
    check: (candidate: Candidate, _job: JobConfig): boolean => {
      const edu = candidate.profile.education;
      if (!edu || edu.length === 0) return true;

      const first = [...edu].sort((a, b) => (a.startYear ?? 9999) - (b.startYear ?? 9999))[0];
      const isTopSchool = [...TOP_SCHOOLS].some(s =>
        first.school?.toLowerCase().includes(s.toLowerCase())
      );

      if (isTopSchool) return false;

      // 检查是否有亮点
      const ext = candidate.profile.ext;
      const hasProject = (ext?.personalProject) as boolean | undefined;
      const hasGithub = (ext?.github) as Record<string, unknown> | undefined;
      const hasHighlights = (candidate.profile.experience ?? []).some(e =>
        /负责|主导|独立/.test(e.description ?? '')
      );

      return !hasProject && !hasGithub && !hasHighlights;
    },
  },
];

const DEFAULT_BONUSES: BonusRule[] = [
  {
    description: '985/211 博士',
    points: 10,
    check: (candidate: Candidate, _job: JobConfig): boolean => {
      return candidate.profile.education?.some(e =>
        [...TOP_SCHOOLS].some(s => e.school?.toLowerCase().includes(s.toLowerCase())) &&
        (e.degree === '博士' || e.degree === 'PhD')
      ) ?? false;
    },
  },
  {
    description: '大厂 + AI 相关经验',
    points: 15,
    check: (candidate: Candidate, _job: JobConfig): boolean => {
      const hasBigCompany = candidate.profile.experience?.some(e => {
        const c = e.company.toLowerCase();
        return [...TOP_COMPANIES].some(tc => c.includes(tc.toLowerCase()));
      });
      const hasAI = candidate.profile.skills?.some(s =>
        /ai|ml|deep learning|大模型|llm|nlp|cv|pytorch|tensorflow/i.test(s)
      );
      return (hasBigCompany && hasAI) ?? false;
    },
  },
  {
    description: 'GitHub 高活跃度（>20 repos + 近期有 commit）',
    points: 8,
    check: (candidate: Candidate, _job: JobConfig): boolean => {
      const gh = candidate.profile.ext?.github as Record<string, unknown> | undefined;
      if (!gh) return false;
      return (gh.repos as number) > 20 && !!gh.recentCommits;
    },
  },
];

// ────────────────────────────────────────────────────────────
// Main Evaluator
// ────────────────────────────────────────────────────────────

export interface EvaluateOptions {
  /** 评估配置（权重、严格度等） */
  config?: EvaluationConfig;
  /** 自定义一票否决规则（追加到默认规则） */
  additionalVetoes?: VetoRule[];
  /** 自定义加分项（追加到默认规则） */
  additionalBonuses?: BonusRule[];
}

export interface EvaluateResult extends EvaluationResult {
  /** 详细的维度评分（带权重计算） */
  dimensions: EvaluationDimension[];
}

/**
 * 评估候选人
 *
 * @param candidate - 标准格式的候选人数据
 * @param job - 职位配置
 * @param options - 评估选项
 * @returns 评估结果
 *
 * @example
 * ```ts
 * import { evaluate } from '@hireclaw/core/evaluator';
 *
 * const result = evaluate(candidate, jobConfig, {
 *   config: { strictness: 'standard' },
 * });
 *
 * if (result.passed) {
 *   console.log(`✅ ${result.score}分，可以触达`);
 * } else {
 *   console.log(`❌ ${result.score}分，跳过`);
 * }
 * ```
 */
export function evaluate(
  candidate: Candidate,
  job: JobConfig,
  options: EvaluateOptions = {}
): EvaluateResult {
  const {
    config = {},
    additionalVetoes = [],
    additionalBonuses = [],
  } = options;

  const strictness = config.strictness ?? 'standard';
  const threshold = DEFAULT_THRESHOLD[strictness];
  const weights: EvaluationWeights = {
    ...DEFAULT_WEIGHTS_IMPL,
    ...config.weights,
  };

  // ── Phase 1: Run veto rules ──
  const allVetoes = [...DEFAULT_VETOES, ...additionalVetoes];
  const vetoed: string[] = [];

  for (const veto of allVetoes) {
    try {
      if (veto.check(candidate, job)) {
        vetoed.push(veto.description);
      }
    } catch {
      // veto check 中的异常不应该中断评估
    }
  }

  // ── Phase 2: Score each dimension ──
  const dimResults: Array<{ name: string; dim: DimResult }> = [
    { name: 'education', dim: evaluateEducation(candidate, job) },
    { name: 'experience', dim: evaluateExperience(candidate) },
    { name: 'skills', dim: evaluateSkills(candidate, job) },
    { name: 'company', dim: evaluateCompany(candidate) },
    { name: 'growth', dim: evaluateGrowth(candidate) },
    { name: 'personality', dim: evaluatePersonality(candidate) },
  ];

  const dimensions: EvaluationDimension[] = dimResults.map(({ name, dim }) => ({
    name,
    score: dim.score,
    weight: weights[name as keyof EvaluationWeights],
    weightedScore: Math.round(dim.score * weights[name as keyof EvaluationWeights]),
    notes: dim.notes,
  }));

  let totalScore = dimensions.reduce((sum, d) => sum + d.weightedScore, 0);

  // ── Phase 3: Apply bonus rules ──
  const allBonuses = [...DEFAULT_BONUSES, ...additionalBonuses];
  const bonuses: Array<{ rule: string; points: number }> = [];

  for (const bonus of allBonuses) {
    try {
      if (bonus.check(candidate, job)) {
        totalScore += bonus.points;
        bonuses.push({ rule: bonus.description, points: bonus.points });
      }
    } catch {
      // bonus check 异常不中断评估
    }
  }

  // Cap at 100
  totalScore = Math.min(100, totalScore);

  // ── Phase 4: Determine priority ──
  let priority: EvaluationResult['priority'];
  if (totalScore >= 90) priority = 'critical';
  else if (totalScore >= 80) priority = 'high';
  else if (totalScore >= 65) priority = 'medium';
  else priority = 'low';

  return {
    score: totalScore,
    passed: totalScore >= threshold && vetoed.length === 0,
    threshold,
    dimensions,
    vetoed,
    bonuses,
    priority,
  };
}

/**
 * 批量评估候选人
 *
 * @param candidates - 候选人列表
 * @param job - 职位配置
 * @param options - 评估选项
 * @returns 评估结果列表（按分数降序）
 */
export function evaluateBatch(
  candidates: Candidate[],
  job: JobConfig,
  options: EvaluateOptions = {}
): Array<{ candidate: Candidate; result: EvaluateResult }> {
  return candidates
    .map(candidate => ({
      candidate,
      result: evaluate(candidate, job, options),
    }))
    .sort((a, b) => b.result.score - a.result.score);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  // 移除常见停用词，提取有意义的词
  const stopwords = new Set(['的', '了', '是', '在', '和', '有', '与', '及', '等',
    '能', '会', '要', '可', '对', '为', '以', '到', '从', '上', '中', '下',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'need', 'must', 'shall', 'with',
    '工程师', '招聘', '岗位', '职位', '工作', '我们', '你', '您']);

  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopwords.has(w))
    .slice(0, 30);
}

// ────────────────────────────────────────────────────────────
// Dimension Definitions (for knowledge base)
// ────────────────────────────────────────────────────────────

export const EVALUATION_DIMENSIONS: EvaluationDimensionDef[] = [
  {
    name: 'education',
    description: '学历与绩点：看绩点不只看学校，绩点高的普通院校 > 绩点低的名校',
    scoringGuide: '985/211+25, 高绩点+20, 硕士+15, 博士+5',
    defaultWeight: 0.15,
  },
  {
    name: 'experience',
    description: '实际做的事情：有具体描述、可量化结果、技术选型理由、主导经验',
    scoringGuide: '详细描述+10, 量化结果+10, 技术思考+8, 主导经验+12',
    defaultWeight: 0.25,
  },
  {
    name: 'skills',
    description: '技能匹配度：与职位关键词匹配 + 前沿技术栈',
    scoringGuide: '按匹配率 0-40, 前沿技术+10',
    defaultWeight: 0.25,
  },
  {
    name: 'company',
    description: '公司背景：大厂标准高、明星公司含金量不输大厂、小公司看做了什么',
    scoringGuide: '大厂85, 明星公司80, 经历丰富度额外+8-15',
    defaultWeight: 0.15,
  },
  {
    name: 'growth',
    description: '成长轨迹：跳槽频率、职级提升、方向一致性',
    scoringGuide: '频繁跳槽-20, 职级提升+15, 方向延续+5',
    defaultWeight: 0.10,
  },
  {
    name: 'personality',
    description: '个人特质：GitHub 活跃度、个人项目、爱好推断、简历有趣度',
    scoringGuide: 'GitHub活跃+20, 个人项目+10, 简历有趣+10',
    defaultWeight: 0.10,
  },
];
