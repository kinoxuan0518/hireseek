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

export interface SkillResult {
  contacted: number;
  skipped: number;
  candidates: Candidate[];
  summary: string;
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
