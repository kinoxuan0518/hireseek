import type { ToolExecutionMode } from './tool-registry';

export type AgentRunMode = 'execute' | 'dry_run';

const READ_ONLY_ACTIONS = new Set(['screenshot', 'move', 'mouse_move', 'scroll']);

export function computerActionHasSideEffect(action: string): boolean {
  return !READ_ONLY_ACTIONS.has(action);
}

export function computerActionMode(action: string, runMode: AgentRunMode): ToolExecutionMode {
  if (runMode === 'dry_run') return 'dry_run';
  return computerActionHasSideEffect(action) ? 'execute' : 'read';
}

export function dryRunBlocksComputerAction(action: string): boolean {
  return computerActionHasSideEffect(action);
}
