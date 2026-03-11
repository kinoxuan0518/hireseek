import { execSync } from 'child_process';
import path from 'path';

export interface GrepOptions {
  pattern: string;
  path?: string;
  filePattern?: string;  // 文件类型过滤，如 "*.ts"
  contextLines?: number;  // 显示上下文行数
  ignoreCase?: boolean;
  limit?: number;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

/**
 * 在文件内容中搜索匹配的文本
 * 使用 ripgrep (rg) 如果可用，否则回退到 grep
 */
export async function searchContent(options: GrepOptions): Promise<GrepMatch[]> {
  const {
    pattern,
    path: searchPath = process.cwd(),
    filePattern,
    contextLines = 0,
    ignoreCase = false,
    limit = 50,
  } = options;

  try {
    // 检测是否有 ripgrep
    let hasRipgrep = false;
    try {
      execSync('which rg', { stdio: 'ignore' });
      hasRipgrep = true;
    } catch {
      // ripgrep 不可用，使用 grep
    }

    let cmd: string;
    if (hasRipgrep) {
      cmd = buildRipgrepCommand(pattern, searchPath, filePattern, contextLines, ignoreCase);
    } else {
      cmd = buildGrepCommand(pattern, searchPath, filePattern, contextLines, ignoreCase);
    }

    const output = execSync(cmd, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 500,  // 500KB
      cwd: searchPath,
    }).trim();

    if (!output) {
      return [];
    }

    // 解析输出
    const matches = parseGrepOutput(output, hasRipgrep);

    // 限制返回数量
    return matches.slice(0, limit);
  } catch (err: any) {
    // grep/rg 没找到匹配时会返回非 0 退出码
    if (err.status === 1 && !err.stderr) {
      return [];
    }
    throw new Error(`搜索失败: ${err.message}`);
  }
}

/**
 * 构建 ripgrep 命令
 */
function buildRipgrepCommand(
  pattern: string,
  searchPath: string,
  filePattern?: string,
  contextLines: number = 0,
  ignoreCase: boolean = false
): string {
  const parts = ['rg', '--line-number', '--no-heading', '--with-filename'];

  if (ignoreCase) {
    parts.push('--ignore-case');
  }

  if (contextLines > 0) {
    parts.push(`--context=${contextLines}`);
  }

  if (filePattern) {
    parts.push(`--glob="${filePattern}"`);
  }

  // 忽略特定目录
  parts.push(
    '--glob=!node_modules',
    '--glob=!dist',
    '--glob=!.git',
    '--glob=!*.db',
    '--glob=!workspace/accounts'
  );

  parts.push(`"${pattern}"`);
  parts.push(searchPath);

  return parts.join(' ');
}

/**
 * 构建 grep 命令（回退方案）
 */
function buildGrepCommand(
  pattern: string,
  searchPath: string,
  filePattern?: string,
  contextLines: number = 0,
  ignoreCase: boolean = false
): string {
  const parts = ['grep', '-rn'];

  if (ignoreCase) {
    parts.push('-i');
  }

  if (contextLines > 0) {
    parts.push(`-C${contextLines}`);
  }

  if (filePattern) {
    parts.push(`--include="${filePattern}"`);
  }

  // 忽略特定目录
  parts.push(
    '--exclude-dir=node_modules',
    '--exclude-dir=dist',
    '--exclude-dir=.git',
    '--exclude=*.db',
    '--exclude-dir=workspace/accounts'
  );

  parts.push(`"${pattern}"`);
  parts.push(searchPath);

  return parts.join(' ');
}

/**
 * 解析 grep/rg 输出
 */
function parseGrepOutput(output: string, isRipgrep: boolean): GrepMatch[] {
  const lines = output.split('\n').filter(l => l.trim());
  const matches: GrepMatch[] = [];

  for (const line of lines) {
    // 格式：file:line:content 或 file-line-content（上下文行）
    const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
    if (match) {
      const [, file, lineNum, content] = match;
      matches.push({
        file: file.trim(),
        line: parseInt(lineNum, 10),
        content: content.trim(),
      });
    }
  }

  return matches;
}

/**
 * 格式化搜索结果
 */
export function formatGrepResults(matches: GrepMatch[], pattern: string): string {
  if (matches.length === 0) {
    return `未找到匹配 "${pattern}" 的内容`;
  }

  const header = `找到 ${matches.length} 处匹配 "${pattern}"：\n\n`;

  // 按文件分组
  const grouped = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    if (!grouped.has(match.file)) {
      grouped.set(match.file, []);
    }
    grouped.get(match.file)!.push(match);
  }

  const sections: string[] = [];
  for (const [file, fileMatches] of grouped) {
    const fileSection = [`${file}:`];
    for (const m of fileMatches) {
      fileSection.push(`  ${m.line}: ${m.content}`);
    }
    sections.push(fileSection.join('\n'));
  }

  return header + sections.join('\n\n');
}
