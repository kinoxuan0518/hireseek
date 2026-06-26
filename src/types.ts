export type Channel = 'boss' | 'maimai' | 'linkedin' | 'followup';

export interface Job {
  id: string;
  name: string;
  channel: Channel;
  priority: 'high' | 'normal' | 'low';
  active: boolean;
}

export interface Candidate {
  fingerprint: string; // name|school|company|channel
  name: string;
  school?: string;
  company?: string;
  channel: Channel;
  job_id: string;
  status: CandidateStatus;
  score?: number;
  run_id?: number;        // 哪一轮 run 触达的（用于 verifier 按 runId 审本轮）
  contacted_at?: string;
}

export type CandidateStatus =
  | 'contacted'
  | 'replied'
  | 'resume_requested'
  | 'resume_received'
  | 'passed'
  | 'rejected'
  | 'on_hold';

export interface TaskRun {
  id?: number;
  job_id: string;
  channel: Channel;
  mode?: 'execute' | 'dry_run' | 'prepare' | 'screen';
  started_at: string;
  finished_at?: string;
  status: 'running' | 'completed' | 'failed';
  contacted_count: number;
  skipped_count: number;
  error?: string;
}

/** 一步可审计的执行动作（流程合规验证器据此判断"它干活的方法对不对"） */
export interface TraceStep {
  seq: number;
  action: string;            // snapshot/click/type/goto/press/scroll/back/wait
  target?: string;           // ref 编号或 URL
  detail?: string;           // 输入文本等（截断）
  ok: boolean;               // 该步是否成功执行
  at?: string;                // ISO/local timestamp（可选，旧轨迹兼容）
  toolName?: string;          // 触发该步的工具名（agent-core 通用 trace）
  inputSummary?: string;      // 工具输入摘要
  outputSummary?: string;     // 工具输出摘要
  error?: string;             // 失败原因
  sideEffect?: boolean;       // 是否真实影响外部世界
  mode?: 'read' | 'dry_run' | 'prepare' | 'screen' | 'execute';
  stageId?: string;           // 可选：中层协议阶段 id（如下层只记录，不解释业务含义）
  actionLabel?: string;       // 动作执行前的控件语义（用于审计 ref 是否点对）
}

/**
 * 本轮已触达候选人的【结构化】记录——对应 canonical 契约 contacted-candidate.v1。
 * 由 runner 通过 record_contacted 工具逐条产出（不靠总结文本正则解析），
 * 下游 verifier / 漏斗 / 校准都按此结构吃数据。
 */
export interface ContactedCandidate {
  name: string;
  company?: string;
  title?: string;
  location?: string;
  evidence?: string;        // 为什么联系 ta 的依据（供质检核对匹配度）
  personalizationEvidence?: string; // 招呼语里用到的候选人真实信息点
  messageIntent?: string;   // 这条招呼想触发候选人的哪种兴趣/回应
  riskFlags?: string[];     // 信息不足、可能误判、话术风险等
  fitTags?: string[];       // 命中的能力/背景标签
  score?: number;           // do-er 的自评分 0-100（契约字段名 fit_score）
  greetingSent?: boolean;   // 是否真的发出了打招呼
  greetingText?: string;    // 实际打招呼文案（供合规验证器查群发感）
  profileUrl?: string;      // 候选人主页/详情页 URL
  sourceChannel?: string;   // boss | maimai | linkedin
  reason?: string;          // 兼容旧字段（等同 evidence）
}

export interface SkillResult {
  contacted: number;
  skipped: number;
  candidates: Candidate[];
  summary: string;
  /** 本轮执行轨迹；仅 DOM runner 目前填充，其他 runner 可缺省 */
  trace?: TraceStep[];
  /** 本轮已触达候选人结构化清单；DOM runner 从总结解析，供 verifier/漏斗使用 */
  contactedList?: ContactedCandidate[];
}

export interface ComputerAction {
  action:
    | 'screenshot'
    | 'left_click'
    | 'right_click'
    | 'double_click'
    | 'type'
    | 'key'
    | 'scroll'
    | 'move';
  coordinate?: [number, number];
  text?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}
