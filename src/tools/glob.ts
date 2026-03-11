import { glob } from 'glob';
import path from 'path';

export interface GlobOptions {
  pattern: string;
  cwd?: string;
  limit?: number;
}

/**
 * 按文件名模式搜索文件
 * 支持 glob 模式：*.ts, **\/*.yaml, src/**\/*.ts
 */
export async function searchFiles(options: GlobOptions): Promise<string[]> {
  const { pattern, cwd = process.cwd(), limit = 100 } = options;

  try {
    const files = await glob(pattern, {
      cwd,
      ignore: [
        'node_modules/**',
        'dist/**',
        '.git/**',
        '**/*.db',
        '**/*.db-shm',
        '**/*.db-wal',
        'workspace/accounts/**',  // 忽略敏感登录信息
      ],
      nodir: true,  // 只返回文件，不包括目录
      absolute: false,  // 返回相对路径
    });

    // 限制返回数量
    const limited = files.slice(0, limit);

    // 按修改时间排序（最近修改的在前）
    const fs = require('fs');
    const sorted = limited.sort((a: string, b: string) => {
      const statsA = fs.statSync(path.join(cwd, a));
      const statsB = fs.statSync(path.join(cwd, b));
      return statsB.mtimeMs - statsA.mtimeMs;
    });

    return sorted;
  } catch (err: any) {
    throw new Error(`Glob 搜索失败: ${err.message}`);
  }
}

/**
 * 格式化 glob 搜索结果
 */
export function formatGlobResults(files: string[], pattern: string): string {
  if (files.length === 0) {
    return `未找到匹配 "${pattern}" 的文件`;
  }

  const header = `找到 ${files.length} 个匹配 "${pattern}" 的文件：\n`;
  const list = files.map((f, i) => `  ${i + 1}. ${f}`).join('\n');

  return header + list;
}
