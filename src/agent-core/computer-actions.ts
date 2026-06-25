import type { ToolExecutionMode } from './tool-registry';

export type AgentRunMode = 'execute' | 'dry_run' | 'prepare' | 'screen';

const READ_ONLY_ACTIONS = new Set(['screenshot', 'move', 'mouse_move', 'scroll']);

export function computerActionHasSideEffect(action: string): boolean {
  return !READ_ONLY_ACTIONS.has(action);
}

export function computerActionMode(action: string, runMode: AgentRunMode): ToolExecutionMode {
  if (runMode !== 'execute') return runMode;
  return computerActionHasSideEffect(action) ? 'execute' : 'read';
}

export function dryRunBlocksComputerAction(action: string): boolean {
  return computerActionHasSideEffect(action);
}
