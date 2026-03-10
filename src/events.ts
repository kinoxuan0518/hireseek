/**
 * 全局事件总线：让 runner/orchestrator 的实时日志广播到 dashboard。
 */
import { EventEmitter } from 'events';

export const bus = new EventEmitter();
bus.setMaxListeners(20);

export function emitLog(msg: string): void {
  bus.emit('log', msg);
}

export function emitScreenshot(base64: string): void {
  bus.emit('screenshot', base64);
}

export function emitStatus(status: 'idle' | 'running'): void {
  bus.emit('status', status);
}

// ── 介入队列 ──────────────────────────────────────────────
const interventionQueue: string[] = [];

export function pushIntervention(msg: string): void {
  interventionQueue.push(msg);
  bus.emit('log', `📩 收到介入指令：${msg}`);
}

export function popIntervention(): string | undefined {
  return interventionQueue.shift();
}
