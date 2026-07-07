export type SlashSuggestionEntry = {
  cmd: string;
  desc: string;
};

export type SlashSuggestionSnapshot = {
  visible: boolean;
  input: string;
  index: number;
  entries: SlashSuggestionEntry[];
};

export type SlashSuggestionDirection = 'up' | 'down';

export class SlashSuggestionController {
  private visible = false;
  private input = '';
  private index = 0;

  constructor(
    private readonly getEntries: () => SlashSuggestionEntry[],
    private readonly limit = 10,
  ) {}

  suggestionsFor(line: string): SlashSuggestionEntry[] {
    if (!line.startsWith('/') || /\s/.test(line)) return [];
    return this.getEntries()
      .filter(entry => entry.cmd.startsWith(line))
      .slice(0, this.limit);
  }

  update(line: string): SlashSuggestionSnapshot {
    const entries = this.suggestionsFor(line);
    if (entries.length === 0) {
      return this.hide();
    }

    this.visible = true;
    this.input = line;
    this.index = Math.max(0, Math.min(this.index, entries.length - 1));
    return this.snapshot(entries);
  }

  move(direction: SlashSuggestionDirection): SlashSuggestionSnapshot {
    const entries = this.suggestionsFor(this.input);
    if (!this.visible || entries.length === 0) {
      return this.hide();
    }

    this.index = direction === 'up'
      ? (this.index - 1 + entries.length) % entries.length
      : (this.index + 1) % entries.length;
    return this.snapshot(entries);
  }

  accept(): string | null {
    const entries = this.suggestionsFor(this.input);
    const picked = entries[this.index];
    this.hide();
    return picked ? `${picked.cmd} ` : null;
  }

  hide(): SlashSuggestionSnapshot {
    this.visible = false;
    this.input = '';
    this.index = 0;
    return this.snapshot([]);
  }

  snapshot(entries = this.visible ? this.suggestionsFor(this.input) : []): SlashSuggestionSnapshot {
    return {
      visible: this.visible,
      input: this.input,
      index: this.index,
      entries,
    };
  }
}

export type SlashSuggestionStyle = {
  marker?: (text: string) => string;
  selectedCommand?: (text: string) => string;
  hint?: (text: string) => string;
};

export const slashSuggestionHint = '    ↑↓ 移动 · Tab 补全 · Enter 发送当前输入 · Esc 收起';

export function formatSlashSuggestionLines(
  entries: SlashSuggestionEntry[],
  selectedIndex: number,
  style: SlashSuggestionStyle = {},
): string[] {
  const markerStyle = style.marker ?? (text => text);
  const commandStyle = style.selectedCommand ?? (text => text);
  const hintStyle = style.hint ?? (text => text);
  const lines = entries.map((entry, index) => {
    const marker = index === selectedIndex ? markerStyle('▸') : ' ';
    const label = index === selectedIndex ? commandStyle(entry.cmd) : entry.cmd;
    return `  ${marker} ${label}${entry.desc ? `  ${entry.desc}` : ''}`;
  });
  lines.push(hintStyle(slashSuggestionHint));
  return lines;
}

export function clearSlashSuggestionAnsi(renderedLines: number): string {
  if (renderedLines <= 0) return '';
  return `\x1b[${renderedLines}A\r\x1b[${renderedLines}M`;
}

export function renderSlashSuggestionAnsi(lines: string[]): string {
  if (lines.length === 0) return '';
  return `\r${lines.map(lineText => `\x1b[2K${lineText}`).join('\n')}\n`;
}
