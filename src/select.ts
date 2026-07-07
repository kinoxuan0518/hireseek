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
import readline from 'readline';

export interface SelectOption {
  label: string;
  hint?: string;
}

export interface SelectBehavior {
  echo?: boolean;
}

export interface EditableChoiceBehavior {
  echo?: boolean;
  multiSelect?: boolean;
}

export interface EditableChoiceResult {
  value: string;
  matchedIndex: number | null;
}

interface KeypressEvent {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

function visibleOptionWindow(idx: number, optionCount: number): { offset: number; count: number } {
  const rows = process.stdout.rows || 24;
  const maxVisible = Math.max(3, Math.min(10, rows - 7));
  const count = Math.min(optionCount, maxVisible);
  let offset = 0;
  if (idx >= count) offset = idx - count + 1;
  offset = Math.max(0, Math.min(offset, Math.max(0, optionCount - count)));
  return { offset, count };
}

export function appendMultiChoiceDraft(draft: string, label: string): string {
  const parts = draft
    .split(/[,\uFF0C\u3001]+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.includes(label)) parts.push(label);
  return parts.join(', ');
}

/**
 * 可编辑选择输入框：↑↓ 只移动候选，Tab 把候选填入输入框，Enter 提交当前输入。
 * 这用于 ask-user 这类"用户可能选，也可能补充文字"的场景。
 */
export function askEditableChoice(
  question: string,
  options: SelectOption[],
  behavior: EditableChoiceBehavior = {},
): Promise<EditableChoiceResult | null> {
  if (!process.stdin.isTTY || options.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    let idx = 0;
    let draft = '';
    let finished = false;
    let renderedLines = 0;
    let suspended: Array<(...args: unknown[]) => void> = [];
    let wasRaw = process.stdin.isRaw ?? false;
    let wasPaused = process.stdin.isPaused();

    const render = (first = false): void => {
      const { offset, count } = visibleOptionWindow(idx, options.length);
      const visible = options.slice(offset, offset + count);
      if (!first && renderedLines > 0) process.stdout.write(`\x1b[${renderedLines}A`);
      visible.forEach((o, i) => {
        const absolute = offset + i;
        process.stdout.write('\x1b[2K');
        const marker = absolute === idx ? chalk.cyan('▸') : ' ';
        const label = absolute === idx ? chalk.cyan.bold(o.label) : o.label;
        process.stdout.write(`  ${marker} ${label}${o.hint ? chalk.gray(`  ${o.hint}`) : ''}\n`);
      });
      const range = options.length > count ? ` ${idx + 1}/${options.length}` : '';
      const tabLabel = behavior.multiSelect ? 'Tab 加入候选' : 'Tab 填入候选';
      process.stdout.write('\x1b[2K');
      process.stdout.write(chalk.gray(`    ↑↓ 移动 · ${tabLabel} · Enter 发送当前输入 · Esc 取消${range}\n`));
      process.stdout.write('\x1b[2K');
      process.stdout.write(`${chalk.green('❯')} ${draft}`);
      renderedLines = visible.length + 2;
    };

    const applySelected = (): void => {
      const label = options[idx]?.label;
      if (!label) return;
      draft = behavior.multiSelect ? appendMultiChoiceDraft(draft, label) : label;
    };

    const finish = (result: EditableChoiceResult | null): void => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKey);
      for (const l of suspended) process.stdin.on('keypress', l);
      process.stdin.setRawMode?.(wasRaw);
      if (wasPaused || suspended.length === 0) process.stdin.pause();
      process.stdout.write(`\r\x1b[2K`);
      if (renderedLines > 0) process.stdout.write(`\x1b[${renderedLines - 1}A\x1b[J`);
      if (result != null) {
        if (behavior.echo !== false) console.log(`${chalk.green('❯')} ${result.value}`);
      } else {
        console.log(chalk.gray('（已取消）'));
      }
      resolve(result);
    };

    const finishWithDraft = (): void => {
      const value = draft.trim();
      if (!value) {
        applySelected();
        render();
        return;
      }
      const matchedIndex = options.findIndex(option => option.label === value);
      finish({ value, matchedIndex: matchedIndex >= 0 ? matchedIndex : null });
    };

    console.log(`\n${chalk.bold(question)} ${chalk.gray('↑↓ 选择 · Tab 填入 · Enter 发送当前输入 · Esc 取消')}`);
    render(true);

    readline.emitKeypressEvents(process.stdin);
    suspended = process.stdin.listeners('keypress') as Array<(...args: unknown[]) => void>;
    process.stdin.removeAllListeners('keypress');

    wasRaw = process.stdin.isRaw ?? false;
    wasPaused = process.stdin.isPaused();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const onKey = (str: string | undefined, key: KeypressEvent): void => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { finish(null); return; }
      if (key.ctrl && key.name === 'u') { draft = ''; render(); return; }
      switch (key.name) {
        case 'up':
          idx = (idx - 1 + options.length) % options.length;
          render();
          return;
        case 'down':
          idx = (idx + 1) % options.length;
          render();
          return;
        case 'tab':
          applySelected();
          render();
          return;
        case 'return':
        case 'enter':
          finishWithDraft();
          return;
        case 'escape':
          finish(null);
          return;
        case 'backspace':
          draft = draft.slice(0, -1);
          render();
          return;
      }
      if (str && str >= ' ' && str !== '\x7f') {
        draft += str;
        render();
      }
    };

    process.stdin.on('keypress', onKey);
  });
}

/**
 * 弹出选择器，返回选中项下标；取消返回 null。
 * 非 TTY 环境（管道/CI）直接返回 null，调用方需有文字降级路径。
 */
export function selectOption(
  question: string,
  options: SelectOption[],
  behavior: SelectBehavior = {},
): Promise<number | null> {
  if (!process.stdin.isTTY || options.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    let idx = 0;
    let offset = 0;
    let finished = false;
    let renderedLines = 0;

    const visibleCount = (): number => {
      const rows = process.stdout.rows || 24;
      const maxVisible = Math.max(3, Math.min(10, rows - 6));
      return Math.min(options.length, maxVisible);
    };
    const syncWindow = (): void => {
      const count = visibleCount();
      if (idx < offset) offset = idx;
      if (idx >= offset + count) offset = idx - count + 1;
      offset = Math.max(0, Math.min(offset, Math.max(0, options.length - count)));
    };

    const render = (first = false): void => {
      syncWindow();
      const count = visibleCount();
      const visible = options.slice(offset, offset + count);
      if (!first && renderedLines > 0) process.stdout.write(`\x1b[${renderedLines}A`);
      visible.forEach((o, i) => {
        const absolute = offset + i;
        process.stdout.write('\x1b[2K');
        const num = chalk.gray(`${absolute + 1}.`);
        const line = absolute === idx
          ? `  ${chalk.cyan('▸')} ${num} ${chalk.cyan.bold(o.label)}${o.hint ? chalk.gray(`  ${o.hint}`) : ''}`
          : `    ${num} ${o.label}${o.hint ? chalk.gray(`  ${o.hint}`) : ''}`;
        process.stdout.write(line + '\n');
      });
      process.stdout.write('\x1b[2K');
      const range = options.length > count ? ` ${idx + 1}/${options.length}` : '';
      process.stdout.write(chalk.gray(`    ↑↓/jk 移动 · 回车确认 · Esc 取消${range}\n`));
      renderedLines = visible.length + 1;
    };

    console.log(`\n${chalk.bold(question)} ${chalk.gray('↑↓ 选择 · 回车确认 · 数字直选 · Esc 取消')}`);
    render(true);

    // 摘下 stdin 上现有的全部 keypress 监听（含 readline 内部处理）
    readline.emitKeypressEvents(process.stdin);
    const suspended = process.stdin.listeners('keypress') as Array<(...args: unknown[]) => void>;
    process.stdin.removeAllListeners('keypress');

    const wasRaw = process.stdin.isRaw ?? false;
    const wasPaused = process.stdin.isPaused();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const finish = (result: number | null): void => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKey);
      // 恢复原监听与模式
      for (const l of suspended) process.stdin.on('keypress', l);
      process.stdin.setRawMode?.(wasRaw);
      if (wasPaused || suspended.length === 0) process.stdin.pause();
      if (result != null) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[J`);
        if (behavior.echo !== false) {
          // 把选中项回显成"用户输入"的样子，对话记录视觉连贯
          console.log(`${chalk.green('❯')} ${options[result].label}`);
        }
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

/**
 * 多选选择器。↑↓/jk 移动，空格勾选，回车确认。
 * 如果没有勾选任何项，回车会选择当前高亮项。
 */
export function selectMultipleOptions(
  question: string,
  options: SelectOption[],
): Promise<number[] | null> {
  if (!process.stdin.isTTY || options.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    let idx = 0;
    let offset = 0;
    let finished = false;
    let renderedLines = 0;
    const selected = new Set<number>();

    const visibleCount = (): number => {
      const rows = process.stdout.rows || 24;
      const maxVisible = Math.max(3, Math.min(10, rows - 6));
      return Math.min(options.length, maxVisible);
    };
    const syncWindow = (): void => {
      const count = visibleCount();
      if (idx < offset) offset = idx;
      if (idx >= offset + count) offset = idx - count + 1;
      offset = Math.max(0, Math.min(offset, Math.max(0, options.length - count)));
    };

    const render = (first = false): void => {
      syncWindow();
      const count = visibleCount();
      const visible = options.slice(offset, offset + count);
      if (!first && renderedLines > 0) process.stdout.write(`\x1b[${renderedLines}A`);
      visible.forEach((o, i) => {
        const absolute = offset + i;
        process.stdout.write('\x1b[2K');
        const marker = absolute === idx ? chalk.cyan('▸') : ' ';
        const checked = selected.has(absolute) ? chalk.cyan('[x]') : chalk.gray('[ ]');
        const num = chalk.gray(`${absolute + 1}.`);
        const label = absolute === idx ? chalk.cyan.bold(o.label) : o.label;
        process.stdout.write(`  ${marker} ${checked} ${num} ${label}${o.hint ? chalk.gray(`  ${o.hint}`) : ''}\n`);
      });
      process.stdout.write('\x1b[2K');
      const range = options.length > count ? ` ${idx + 1}/${options.length}` : '';
      process.stdout.write(chalk.gray(`    ↑↓/jk 移动 · Space 勾选 · 回车确认 · Esc 取消${range}\n`));
      renderedLines = visible.length + 1;
    };

    console.log(`\n${chalk.bold(question)} ${chalk.gray('↑↓ 选择 · Space 勾选 · 回车确认 · Esc 取消')}`);
    render(true);

    readline.emitKeypressEvents(process.stdin);
    const suspended = process.stdin.listeners('keypress') as Array<(...args: unknown[]) => void>;
    process.stdin.removeAllListeners('keypress');

    const wasRaw = process.stdin.isRaw ?? false;
    const wasPaused = process.stdin.isPaused();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const finish = (result: number[] | null): void => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKey);
      for (const l of suspended) process.stdin.on('keypress', l);
      process.stdin.setRawMode?.(wasRaw);
      if (wasPaused || suspended.length === 0) process.stdin.pause();
      if (result != null) {
        const labels = result.map(i => options[i].label).join(', ');
        process.stdout.write(`\x1b[${renderedLines}A\x1b[J`);
        console.log(`${chalk.green('❯')} ${labels}`);
      } else {
        console.log(chalk.gray('（已取消）'));
      }
      resolve(result);
    };

    const toggle = (i: number): void => {
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
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
        case 'space':
          toggle(idx);
          render();
          return;
        case 'return':
        case 'enter': {
          const result = selected.size > 0 ? Array.from(selected).sort((a, b) => a - b) : [idx];
          finish(result);
          return;
        }
        case 'escape':
          finish(null);
          return;
      }
      if (key.sequence && /^[1-9]$/.test(key.sequence)) {
        const n = parseInt(key.sequence, 10) - 1;
        if (n < options.length) {
          idx = n;
          toggle(n);
          render();
        }
      }
    };

    process.stdin.on('keypress', onKey);
  });
}
