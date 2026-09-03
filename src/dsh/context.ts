/**
 * Cordis 风格的微型内核：插件往共享 Context 上贡献服务、事件和可逆副作用。
 * 没有特权核心——扩展方式是再挂一个插件；卸载时副作用按注册反序回滚。
 */

import type { Disposer, ObserverHandler, Plugin, WaterfallHandler, WaterfallNext } from './types';

interface Listener {
  observer?: ObserverHandler;
  intercept?: WaterfallHandler;
}

export class Context {
  readonly parent: Context | null;
  private readonly services = new Map<string, unknown>();
  private readonly listeners = new Map<string, Listener[]>();
  private readonly effects: Disposer[] = [];
  private disposed = false;

  constructor(parent: Context | null = null) {
    this.parent = parent;
  }

  provide<T>(key: string, service: T): T {
    this.services.set(key, service);
    this.effect(() => () => {
      if (this.services.get(key) === service) this.services.delete(key);
    });
    return service;
  }

  get<T>(key: string): T {
    if (this.services.has(key)) return this.services.get(key) as T;
    if (this.parent) return this.parent.get<T>(key);
    throw new Error(`dsh: service "${key}" is not registered`);
  }

  tryGet<T>(key: string): T | undefined {
    if (this.services.has(key)) return this.services.get(key) as T;
    return this.parent?.tryGet<T>(key);
  }

  plugin(plugin: Plugin): void {
    // 挂到当前 context 上：服务要对后续插件和宿主可见。
    // 需要隔离能力集时再走 isolate()（例如单个 sub-agent 的 scoped registry）。
    const result = plugin.apply(this);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<void | Disposer>).then(disposer => {
        if (typeof disposer === 'function') this.effect(() => disposer);
      });
    } else if (typeof result === 'function') {
      this.effect(() => result);
    }
  }

  isolate(): Context {
    const child = new Context(this);
    this.effect(() => () => child.dispose());
    return child;
  }

  effect(setup: () => Disposer): void {
    if (this.disposed) return;
    this.effects.push(setup());
  }

  on<T = any>(event: string, handler: ObserverHandler<T> | WaterfallHandler<T>): Disposer {
    const list = this.listeners.get(event) ?? [];
    const listener: Listener = handler.length >= 2
      ? { intercept: handler as WaterfallHandler<T> }
      : { observer: handler as ObserverHandler<T> };
    list.push(listener);
    this.listeners.set(event, list);
    const dispose = (): void => {
      const current = this.listeners.get(event);
      if (!current) return;
      const next = current.filter(item => item !== listener);
      if (next.length) this.listeners.set(event, next);
      else this.listeners.delete(event);
    };
    this.effect(() => dispose);
    return dispose;
  }

  emit<T = unknown>(event: string, payload?: T): void {
    for (const listener of this.collect(event)) {
      if (listener.observer) void listener.observer(payload as T);
      else if (listener.intercept) void listener.intercept(payload as T, async current => (current ?? payload) as T);
    }
  }

  async serial<T = unknown>(event: string, payload?: T): Promise<void> {
    for (const listener of this.collect(event)) {
      if (listener.observer) await listener.observer(payload as T);
      else if (listener.intercept) await listener.intercept(payload as T, async current => (current ?? payload) as T);
    }
  }

  async waterfall<T>(event: string, payload: T): Promise<T> {
    const interceptors = this.collect(event).filter(item => item.intercept);
    let index = 0;
    const next: WaterfallNext<T> = async (current?: T): Promise<T> => {
      const value = (current ?? payload) as T;
      const listener = interceptors[index++];
      if (!listener?.intercept) return value;
      return listener.intercept(value, next);
    };
    return next(payload);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of [...this.effects].reverse()) {
      try { dispose(); } catch { /* 卸载失败不能阻断其他插件回滚 */ }
    }
    this.effects.length = 0;
    this.services.clear();
    this.listeners.clear();
  }

  private collect(event: string): Listener[] {
    const own = this.listeners.get(event) ?? [];
    const inherited = this.parent ? this.parent.collect(event) : [];
    return [...inherited, ...own];
  }
}

export function newId(prefix = 'dsh'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
