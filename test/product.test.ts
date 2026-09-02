import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  normalizeBrowserControl,
  productEnv,
  resolveBrowserProfileDir,
  resolveDbPath,
  resolveProductHome,
} from '../src/product';

describe('product identity', () => {
  it('reads SEEYA_ then HIRESEEK_ then HIRECLAW_', () => {
    expect(productEnv('DB_PATH', { SEEYA_DB_PATH: 'a', HIRESEEK_DB_PATH: 'b' })).toBe('a');
    expect(productEnv('DB_PATH', { HIRESEEK_DB_PATH: 'b', HIRECLAW_DB_PATH: 'c' })).toBe('b');
    expect(productEnv('DB_PATH', { HIRECLAW_DB_PATH: 'c' })).toBe('c');
    expect(productEnv('DB_PATH', {})).toBe('');
  });

  it('maps seeya browser control onto the existing seeya controller value', () => {
    expect(normalizeBrowserControl('seeya')).toBe('hireseek');
    expect(normalizeBrowserControl('chrome')).toBe('chrome');
    expect(normalizeBrowserControl('hireseek')).toBe('hireseek');
  });

  it('keeps an existing seeya db when seeya.db has not been created yet', () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeya-home-'));
    const hireseekDb = path.join(homedir, '.hireseek', 'hireseek.db');
    fs.mkdirSync(path.dirname(hireseekDb), { recursive: true });
    fs.writeFileSync(hireseekDb, '');
    expect(resolveDbPath({ homedir })).toBe(hireseekDb);
    expect(resolveProductHome({ homedir })).toBe(path.join(homedir, '.hireseek'));
  });

  it('prefers ~/.seeya when that db already exists', () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeya-home-'));
    const seeyaDb = path.join(homedir, '.seeya', 'seeya.db');
    const hireseekDb = path.join(homedir, '.hireseek', 'hireseek.db');
    fs.mkdirSync(path.dirname(seeyaDb), { recursive: true });
    fs.mkdirSync(path.dirname(hireseekDb), { recursive: true });
    fs.writeFileSync(seeyaDb, '');
    fs.writeFileSync(hireseekDb, '');
    expect(resolveDbPath({ homedir })).toBe(seeyaDb);
  });

  it('defaults a fresh machine to ~/.seeya', () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeya-home-'));
    expect(resolveDbPath({ homedir })).toBe(path.join(homedir, '.seeya', 'seeya.db'));
    expect(resolveBrowserProfileDir({ homedir })).toBe(path.join(homedir, '.seeya', 'browser-profile'));
    expect(resolveProductHome({ homedir })).toBe(path.join(homedir, '.seeya'));
  });
});
