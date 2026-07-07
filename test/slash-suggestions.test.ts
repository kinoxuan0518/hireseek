import { describe, expect, it } from 'vitest';
import {
  SlashSuggestionController,
  clearSlashSuggestionAnsi,
  formatSlashSuggestionLines,
  renderSlashSuggestionAnsi,
} from '../src/chat/slash-suggestions';

const entries = [
  { cmd: '/help', desc: '全部命令' },
  { cmd: '/status', desc: '模型状态' },
  { cmd: '/skills', desc: '技能列表' },
];

describe('slash command suggestions', () => {
  it('shows suggestions immediately for slash input without treating it as a submitted command', () => {
    const controller = new SlashSuggestionController(() => entries);

    const snapshot = controller.update('/');

    expect(snapshot.visible).toBe(true);
    expect(snapshot.input).toBe('/');
    expect(snapshot.index).toBe(0);
    expect(snapshot.entries.map(entry => entry.cmd)).toEqual(['/help', '/status', '/skills']);
  });

  it('keeps slash-prefixed text editable and hides suggestions after whitespace', () => {
    const controller = new SlashSuggestionController(() => entries);

    expect(controller.update('/s').entries.map(entry => entry.cmd)).toEqual(['/status', '/skills']);
    expect(controller.update('/status please').visible).toBe(false);
  });

  it('moves selection without changing the user input and accepts with trailing space', () => {
    const controller = new SlashSuggestionController(() => entries);

    controller.update('/');
    const moved = controller.move('down');

    expect(moved.input).toBe('/');
    expect(moved.index).toBe(1);
    expect(controller.accept()).toBe('/status ');
    expect(controller.snapshot().visible).toBe(false);
  });

  it('wraps selection and formats the visible suggestion block', () => {
    const controller = new SlashSuggestionController(() => entries);

    controller.update('/');
    const moved = controller.move('up');
    const lines = formatSlashSuggestionLines(moved.entries, moved.index);

    expect(moved.index).toBe(2);
    expect(lines[2]).toContain('▸ /skills');
    expect(lines.at(-1)).toContain('Tab 补全');
  });

  it('uses in-place terminal redraw instead of appending suggestion blocks below the prompt', () => {
    expect(clearSlashSuggestionAnsi(3)).toBe('\x1b[3A\r\x1b[3M');
    expect(clearSlashSuggestionAnsi(0)).toBe('');
    expect(renderSlashSuggestionAnsi(['  ▸ /help', '    /status'])).toBe('\r\x1b[2K  ▸ /help\n\x1b[2K    /status\n');
  });
});
