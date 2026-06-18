#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const scanAll = process.argv.includes('--all');
const gitArgs = scanAll
  ? ['ls-files']
  : ['ls-files', '--modified', '--others', '--exclude-standard'];

const skippedPath = [
  /^node_modules\//,
  /^dist\//,
  /^data\//,
  /^workspace\/accounts\//,
  /^workspace\/checkpoints\//,
  /^workspace\/memory\//,
  /^workspace\/sessions\//,
  /^workspace\/tmp\//,
  /^workspace\/scripts\//,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^packages\/core\/package-lock\.json$/,
  /^scripts\/privacy-scan\.mjs$/,
  /\.db(?:-|$)/,
  /\.sqlite(?:-|$)/,
  /\.(?:png|jpg|jpeg|gif|webp|pdf|zip|tar|gz)$/i,
];

const allowedLine = [
  /example\.com/i,
  /your@email\.com/i,
  /13800138000/,
  /your[-_ ]?(?:key|provider|email|token|secret)/i,
  /\bxxx\b/i,
  /\bplaceholder\b/i,
  /\bFEISHU_APP_SECRET\b/,
  /\bCLIENT_SECRET\b/,
  /\bACCESS_TOKEN\b/,
  /\bREFRESH_TOKEN\b/,
  /\btenant_access_token\b/,
  /\bpage_token\b/,
  /sk-your-key/,
];

const checks = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  },
  {
    id: 'provider-token',
    pattern: /\b(?:sk|ghp|github_pat|xoxb|xoxp|xoxa|ya29|AIza)[A-Za-z0-9_=-]{20,}\b/g,
  },
  {
    id: 'secret-assignment',
    pattern: /\b(?:api[_-]?key|secret|token|password|passwd|cookie|session)\b\s*[:=]\s*["'][A-Za-z0-9_./+=:-]{16,}["']/gi,
  },
  {
    id: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    id: 'cn-phone',
    pattern: /\b1[3-9]\d[ -]?\d{4}[ -]?\d{4}\b/g,
  },
  {
    id: 'runtime-session-path',
    pattern: /\bworkspace\/sessions\/[^\s"'`]+/g,
  },
];

function shouldSkip(file) {
  return skippedPath.some(re => re.test(file));
}

function isAllowed(line) {
  return allowedLine.some(re => re.test(line));
}

function isTextFile(abs) {
  const stat = statSync(abs);
  if (!stat.isFile()) return false;
  if (stat.size > 1024 * 1024) return false;
  const sample = readFileSync(abs, { encoding: null }).subarray(0, 4096);
  return !sample.includes(0);
}

const files = execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map(s => s.trim())
  .filter(Boolean)
  .filter(file => !shouldSkip(file))
  .filter(file => existsSync(path.join(root, file)))
  .filter(file => isTextFile(path.join(root, file)));

const findings = [];

for (const file of files) {
  const abs = path.join(root, file);
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (isAllowed(line)) return;
    for (const check of checks) {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          check: check.id,
          text: line.trim().slice(0, 180),
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Privacy scan failed: ${findings.length} finding(s).`);
  for (const f of findings.slice(0, 50)) {
    console.error(`${f.file}:${f.line} [${f.check}] ${f.text}`);
  }
  if (findings.length > 50) {
    console.error(`...and ${findings.length - 50} more.`);
  }
  process.exit(1);
}

console.log(`Privacy scan passed (${files.length} file(s), ${scanAll ? 'all tracked' : 'changed only'}).`);
