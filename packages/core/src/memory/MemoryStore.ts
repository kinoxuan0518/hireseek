// @hireclaw/core/memory — MemoryStore 接口与实现
//
// 记忆存储的抽象接口（trait 模式），参考 Claude Code 的 ApiClient/ ToolExecutor trait 设计
// 支持多种存储后端：InMemory（测试）、File（生产）、SQLite（未来扩展）

import type { MemoryEntry } from '../types.js';

// ────────────────────────────────────────────────────────────
// MemoryStore Interface (Trait Pattern)
// ────────────────────────────────────────────────────────────

/**
 * 记忆存储接口（Trait）
 *
 * 参考 Claude Code 的 trait 抽象模式，将存储层解耦
 * 任何存储后端只需实现此接口即可接入
 */
export interface IMemoryStore {
  /**
   * 保存记忆条目
   */
  save(entry: MemoryEntry): Promise<void>;

  /**
   * 批量保存记忆条目
   */
  saveBatch(entries: MemoryEntry[]): Promise<void>;

  /**
   * 按条件查询记忆
   * @param filter 支持 id / type / metadata 任意组合
   */
  query(filter: MemoryQueryFilter): Promise<MemoryEntry[]>;

  /**
   * 按 ID 获取单条记忆
   */
  get(id: string): Promise<MemoryEntry | null>;

  /**
   * 删除记忆
   */
  delete(id: string): Promise<void>;

  /**
   * 删除匹配条件的记忆
   */
  deleteWhere(filter: MemoryQueryFilter): Promise<number>;

  /**
   * 获取存储统计
   */
  stats(): Promise<MemoryStats>;

  /**
   * 持久化到磁盘（如果需要）
   */
  persist?(): Promise<void>;
}

export interface MemoryQueryFilter {
  id?: string;
  type?: MemoryEntry['type'];
  /** 返回在 startTime 之后的记忆 */
  after?: string;
  /** 返回在 endTime 之前的记忆 */
  before?: string;
  /** 按 metadata 字段过滤（如 candidateId） */
  metadata?: Record<string, string | number | boolean>;
  /** 模糊匹配 content */
  contentContains?: string;
  /** 限制返回数量 */
  limit?: number;
  /** 排序：createdAt（默认）或 updatedAt */
  sortBy?: 'createdAt' | 'updatedAt';
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<MemoryEntry['type'], number>;
  oldestEntry?: string;
  newestEntry?: string;
}

// ────────────────────────────────────────────────────────────
// In-Memory Store（开发/测试用）
// ────────────────────────────────────────────────────────────

/**
 * 内存存储（纯内存，不持久化）
 * 适合测试、演示、快速启动场景
 */
export class InMemoryStore implements IMemoryStore {
  private _entries: Map<string, MemoryEntry> = new Map();

  async save(entry: MemoryEntry): Promise<void> {
    const now = new Date().toISOString();
    const e = { ...entry, updatedAt: now, createdAt: entry.createdAt ?? now };
    this._entries.set(e.id, e);
  }

  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    const now = new Date().toISOString();
    for (const entry of entries) {
      const e = { ...entry, createdAt: entry.createdAt ?? now, updatedAt: now };
      this._entries.set(e.id, e);
    }
  }

  async query(filter: MemoryQueryFilter): Promise<MemoryEntry[]> {
    let results = [...this._entries.values()];

    if (filter.id) {
      results = results.filter(e => e.id === filter.id);
    }
    if (filter.type) {
      results = results.filter(e => e.type === filter.type);
    }
    if (filter.after) {
      results = results.filter(e => e.createdAt >= filter.after!);
    }
    if (filter.before) {
      results = results.filter(e => e.createdAt <= filter.before!);
    }
    if (filter.metadata) {
      results = results.filter(e => {
        for (const [k, v] of Object.entries(filter.metadata!)) {
          if ((e.metadata as Record<string, unknown>)?.[k] !== v) return false;
        }
        return true;
      });
    }
    if (filter.contentContains) {
      const q = filter.contentContains.toLowerCase();
      results = results.filter(e => e.content.toLowerCase().includes(q));
    }

    const sortBy = filter.sortBy ?? 'createdAt';
    results.sort((a, b) => (a[sortBy] > b[sortBy] ? -1 : 1));

    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this._entries.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this._entries.delete(id);
  }

  async deleteWhere(filter: MemoryQueryFilter): Promise<number> {
    const matches = await this.query(filter);
    for (const m of matches) {
      this._entries.delete(m.id);
    }
    return matches.length;
  }

  async stats(): Promise<MemoryStats> {
    const entries = [...this._entries.values()];
    const byType: Record<string, number> = {};
    for (const e of entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      totalEntries: entries.length,
      byType: byType as Record<MemoryEntry['type'], number>,
      oldestEntry: sorted[0]?.createdAt,
      newestEntry: sorted[sorted.length - 1]?.createdAt,
    };
  }
}

// ────────────────────────────────────────────────────────────
// File Store（生产用 JSON 持久化）
// ────────────────────────────────────────────────────────────

/**
 * JSON 文件存储
 * 适合简单部署、无数据库场景
 *
 * ⚠️ 注意：不是线程安全的，单进程或配合文件锁使用
 */
export class FileStore implements IMemoryStore {
  private _memory: InMemoryStore;
  private path: string;
  private dirty = false;

  constructor(path: string) {
    this.path = path;
    this._memory = new InMemoryStore();
  }

  /**
   * 从磁盘加载（启动时调用）
   */
  async load(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      if (!existsSync(this.path)) return;

      const data = await readFile(this.path, 'utf-8');
      const entries: MemoryEntry[] = JSON.parse(data);
      await this._memory.saveBatch(entries);
    } catch (err) {
      console.warn(`[Memory] Failed to load from ${this.path}:`, err);
    }
  }

  async save(entry: MemoryEntry): Promise<void> {
    await this._memory.save(entry);
    this.dirty = true;
    await this.maybePersist();
  }

  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    await this._memory.saveBatch(entries);
    this.dirty = true;
    await this.maybePersist();
  }

  async query(filter: MemoryQueryFilter): Promise<MemoryEntry[]> {
    return this._memory.query(filter);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this._memory.get(id);
  }

  async delete(id: string): Promise<void> {
    await this._memory.delete(id);
    this.dirty = true;
    await this.maybePersist();
  }

  async deleteWhere(filter: MemoryQueryFilter): Promise<number> {
    const count = await this._memory.deleteWhere(filter);
    if (count > 0) {
      this.dirty = true;
      await this.maybePersist();
    }
    return count;
  }

  async stats(): Promise<MemoryStats> {
    return this._memory.stats();
  }

  async persist(): Promise<void> {
    await this.doPersist();
  }

  /** 自动持久化（有变更时） */
  private async maybePersist(): Promise<void> {
    if (this.dirty) {
      await this.doPersist();
      this.dirty = false;
    }
  }

  private async doPersist(): Promise<void> {
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const entries = await this._memory.query({ limit: 10000 });

      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Memory] Failed to persist:', err);
    }
  }
}

// ────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────

export type StoreType = 'memory' | 'file';

export interface StoreFactoryOptions {
  type: StoreType;
  /** type=file 时使用 */
  filePath?: string;
}

/**
 * 创建 MemoryStore 实例
 */
export function createMemoryStore(options: StoreFactoryOptions): IMemoryStore {
  switch (options.type) {
    case 'memory':
      return new InMemoryStore();
    case 'file':
      if (!options.filePath) {
        throw new Error('filePath is required when type=file');
      }
      return new FileStore(options.filePath);
    default:
      throw new Error(`Unknown store type: ${options.type}`);
  }
}
