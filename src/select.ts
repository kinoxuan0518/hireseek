/**
 * 终端方向键选择器（CC 风格）
 *
 * ↑↓/jk 移动，回车确认，数字 1-9 直选，Esc/Ctrl+C 取消。
 *
 * 与 readline 共存的关键：选择期间把 stdin 上所有 keypress 监听
 * （包括 readline 内部的行编辑处理）临时摘下，结束后原样装回——
 * 否则 ↑↓ 会被 readline 的历史回溯抢走并把历史内容写进输入行。
 */

import chalk from 'chalk';

export interface SelectOption {
  label: string;
  hint?: string;
}

interface KeypressEvent {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

/**
 * 弹出选择器，返回选中项下标；取消返回 null。
 * 非 TTY 环境（管道/CI）直接返回 null，调用方需有文字降级路径。
 */
export function selectOption(
  question: string,
  options: SelectOption[],
): Promise<number | null> {
  if (!process.stdin.isTTY || options.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    let idx = 0;
    let finished = false;

    const render = (first = false): void => {
      if (!first) process.stdout.write(`\x1b[${options.length}A`);
      options.forEach((o, i) => {
        process.stdout.write('\x1b[2K');
        const num = chalk.gray(`${i + 1}.`);
        const line = i === idx
          ? `  ${chalk.cyan('▸')} ${num} ${chalk.cyan.bold(o.label)}${o.hint ? chalk.gray(`  ${o.hint}`) : ''}`
          : `    ${num} ${o.label}${o.hint ? chalk.gray(`  ${o.hint}`) : ''}`;
        process.stdout.write(line + '\n');
      });
    };

    console.log(`\n${chalk.bold(question)} ${chalk.gray('↑↓ 选择 · 回车确认 · 数字直选 · Esc 取消')}`);
    render(true);

    // 摘下 stdin 上现有的全部 keypress 监听（含 readline 内部处理）
    const suspended = process.stdin.listeners('keypress') as Array<(...args: unknown[]) => void>;
    process.stdin.removeAllListeners('keypress');

    const wasRaw = process.stdin.isRaw ?? false;
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const finish = (result: number | null): void => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKey);
      // 恢复原监听与模式
      for (const l of suspended) process.stdin.on('keypress', l);
      process.stdin.setRawMode?.(wasRaw);
      if (result != null) {
        // 把选中项回显成"用户输入"的样子，对话记录视觉连贯
        process.stdout.write(`\x1b[${options.length}A\x1b[J`);
        console.log(`${chalk.green('❯')} ${options[result].label}`);
      } else {
        console.log(chalk.gray('（已取消）'));
      }
      resolve(result);
    };

    const onKey = (_str: unknown, key: KeypressEvent): void => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { finish(null); return; }
      switch (key.name) {
        case 'up':
        case 'k':
          idx = (idx - 1 + options.length) % options.length;
          render();
          return;
        case 'down':
        case 'j':
          idx = (idx + 1) % options.length;
          render();
          return;
        case 'return':
        case 'enter':
          finish(idx);
          return;
        case 'escape':
          finish(null);
          return;
      }
      if (key.sequence && /^[1-9]$/.test(key.sequence)) {
        const n = parseInt(key.sequence, 10) - 1;
        if (n < options.length) {
          idx = n;
          render();
          finish(n);
        }
      }
    };

    process.stdin.on('keypress', onKey);
  });
}
