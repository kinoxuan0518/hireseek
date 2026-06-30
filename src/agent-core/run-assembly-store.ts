import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import type { Channel } from '../types';
import type { HarnessRunAssembly, HarnessRunMode } from '../harness/run-assembly';
import { listExecutionEnvironments, type ExecutionEnvironmentState } from './environment-store';
import './store';

export interface RunAssemblySnapshotInput {
  runId: number;
  jobId: string;
  channel: Channel;
  mode: HarnessRunMode;
  assembly: HarnessRunAssembly;
  systemPrompt: string;
  taskPrompt: string;
  environments?: ExecutionEnvironmentState[];
}

export interface RunAssemblySnapshot {
  runId: number;
  jobId: string;
  channel: Channel;
  mode: HarnessRunMode;
  provider: string;
  model: string | null;
  platformProtocol: string | null;
  contractName: string | null;
  skillAssetMode: string | null;
  contextBlocks: HarnessRunAssembly['contextBlocks'];
  tools: HarnessRunAssembly['tools'];
  boundaries: string[];
  environments: ExecutionEnvironmentState[];
  systemPromptHash: string;
  systemPromptChars: number;
  taskPromptHash: string;
  taskPromptChars: number;
  createdAt: string;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function saveRunAssemblySnapshot(input: RunAssemblySnapshotInput): void {
  const environments = input.environments ?? listExecutionEnvironments(8);
  db.prepare(`
    INSERT INTO agent_run_assemblies
      (run_id, job_id, channel, mode, provider, model, platform_protocol, contract_name, skill_asset_mode,
       context_blocks_json, tools_json, boundaries_json, environments_json,
       system_prompt_hash, system_prompt_chars, task_prompt_hash, task_prompt_chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      job_id = excluded.job_id,
      channel = excluded.channel,
      mode = excluded.mode,
      provider = excluded.provider,
      model = excluded.model,
      platform_protocol = excluded.platform_protocol,
      contract_name = excluded.contract_name,
      skill_asset_mode = excluded.skill_asset_mode,
      context_blocks_json = excluded.context_blocks_json,
      tools_json = excluded.tools_json,
      boundaries_json = excluded.boundaries_json,
      environments_json = excluded.environments_json,
      system_prompt_hash = excluded.system_prompt_hash,
      system_prompt_chars = excluded.system_prompt_chars,
      task_prompt_hash = excluded.task_prompt_hash,
      task_prompt_chars = excluded.task_prompt_chars
  `).run(
    input.runId,
    input.jobId,
    input.channel,
    input.mode,
    input.assembly.provider,
    config.llm.model ?? null,
    input.assembly.platformProtocol,
    input.assembly.contractName,
    input.assembly.skillAssetMode,
    JSON.stringify(input.assembly.contextBlocks),
    JSON.stringify(input.assembly.tools),
    JSON.stringify(input.assembly.boundaries),
    JSON.stringify(environments),
    sha256(input.systemPrompt),
    input.systemPrompt.length,
    sha256(input.taskPrompt),
    input.taskPrompt.length,
  );
}

export function loadRunAssemblySnapshot(runId: number): RunAssemblySnapshot | null {
  const row = db.prepare(`
    SELECT
      run_id AS runId,
      job_id AS jobId,
      channel,
      mode,
      provider,
      model,
      platform_protocol AS platformProtocol,
      contract_name AS contractName,
      skill_asset_mode AS skillAssetMode,
      context_blocks_json AS contextBlocksJson,
      tools_json AS toolsJson,
      boundaries_json AS boundariesJson,
      environments_json AS environmentsJson,
      system_prompt_hash AS systemPromptHash,
      system_prompt_chars AS systemPromptChars,
      task_prompt_hash AS taskPromptHash,
      task_prompt_chars AS taskPromptChars,
      created_at AS createdAt
    FROM agent_run_assemblies
    WHERE run_id = ?
  `).get(runId) as {
    runId: number;
    jobId: string;
    channel: Channel;
    mode: HarnessRunMode;
    provider: string;
    model: string | null;
    platformProtocol: string | null;
    contractName: string | null;
    skillAssetMode: string | null;
    contextBlocksJson: string;
    toolsJson: string;
    boundariesJson: string;
    environmentsJson: string;
    systemPromptHash: string;
    systemPromptChars: number;
    taskPromptHash: string;
    taskPromptChars: number;
    createdAt: string;
  } | undefined;

  if (!row) return null;
  return {
    runId: row.runId,
    jobId: row.jobId,
    channel: row.channel,
    mode: row.mode,
    provider: row.provider,
    model: row.model,
    platformProtocol: row.platformProtocol,
    contractName: row.contractName,
    skillAssetMode: row.skillAssetMode,
    contextBlocks: parseJson(row.contextBlocksJson, []),
    tools: parseJson(row.toolsJson, []),
    boundaries: parseJson(row.boundariesJson, []),
    environments: parseJson(row.environmentsJson, []),
    systemPromptHash: row.systemPromptHash,
    systemPromptChars: row.systemPromptChars,
    taskPromptHash: row.taskPromptHash,
    taskPromptChars: row.taskPromptChars,
    createdAt: row.createdAt,
  };
}

export function latestRunAssemblySnapshots(limit = 5): RunAssemblySnapshot[] {
  const rows = db.prepare(`
    SELECT run_id AS runId
    FROM agent_run_assemblies
    ORDER BY run_id DESC
    LIMIT ?
  `).all(limit) as { runId: number }[];
  return rows
    .map(row => loadRunAssemblySnapshot(row.runId))
    .filter((row): row is RunAssemblySnapshot => !!row);
}
