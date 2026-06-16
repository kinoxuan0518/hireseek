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
}

/** do-er 在总结里吐出的、本轮已触达候选人的结构化清单（供质检与漏斗落库） */
export interface ContactedCandidate {
  name: string;
  company?: string;
  score?: number;     // do-er 的自评分 0-100
  reason?: string;
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
