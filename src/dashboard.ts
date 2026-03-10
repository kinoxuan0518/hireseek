/**
 * HireClaw 本地控制台
 * 启动一个本地 HTTP 服务，提供实时截图、日志流、候选人数据和任务控制。
 */

import http from 'http';
import { exec } from 'child_process';
import { bus, pushIntervention } from './events';
import { db } from './db';
import { loadActiveJob } from './skills/loader';
import { runChannel, runJob, scanInbox } from './orchestrator';
import type { Channel } from './types';

const PORT = 7788;

// ── HTML ─────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>🦞 HireClaw</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d0d; color: #e0e0e0; font-family: 'Menlo', monospace; font-size: 13px; height: 100vh; display: flex; flex-direction: column; }
  header { background: #111; border-bottom: 1px solid #222; padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 16px; color: #7dd3fc; }
  #status { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #1a1a1a; color: #6b7280; }
  #status.running { background: #14532d; color: #4ade80; }
  .btn { background: #1e3a5f; color: #7dd3fc; border: 1px solid #2563eb; border-radius: 4px; padding: 5px 14px; cursor: pointer; font-size: 12px; font-family: inherit; }
  .btn:hover { background: #2563eb; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.danger { background: #3b1515; border-color: #ef4444; color: #fca5a5; }
  main { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr; gap: 1px; background: #222; overflow: hidden; }
  .panel { background: #0d0d0d; overflow: hidden; display: flex; flex-direction: column; }
  .panel-header { padding: 8px 14px; background: #111; border-bottom: 1px solid #222; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
  #screenshot-panel { grid-row: 1 / 3; display: flex; flex-direction: column; }
  #screenshot { width: 100%; height: 100%; object-fit: contain; background: #050505; }
  #log { flex: 1; overflow-y: auto; padding: 10px 14px; font-size: 12px; line-height: 1.7; }
  #log .entry { border-bottom: 1px solid #111; padding: 2px 0; white-space: pre-wrap; word-break: break-all; }
  #log .entry.think { color: #a78bfa; }
  #log .entry.action { color: #7dd3fc; }
  #log .entry.info { color: #6b7280; }
  #log .entry.ok { color: #4ade80; }
  #log .entry.err { color: #f87171; }
  #funnel { padding: 12px 14px; }
  .funnel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .funnel-label { width: 60px; color: #9ca3af; font-size: 11px; }
  .funnel-bar { height: 10px; background: #2563eb; border-radius: 2px; min-width: 2px; }
  .funnel-count { color: #7dd3fc; font-size: 11px; }
  footer { background: #111; border-top: 1px solid #222; padding: 10px 20px; display: flex; gap: 10px; align-items: center; }
</style>
</head>
<body>
<header>
  <h1>🦞 HireClaw</h1>
  <span id="status">空闲</span>
  <span id="job-title" style="color:#9ca3af;font-size:12px;margin-left:8px;"></span>
  <div style="flex:1"></div>
  <button class="btn" onclick="triggerRun()">▶ Run</button>
  <button class="btn" onclick="triggerRun('boss')">BOSS</button>
  <button class="btn" onclick="triggerScan()">扫收件箱</button>
  <button class="btn" onclick="loadFunnel()">刷新漏斗</button>
</header>

<main>
  <!-- 左：截图 -->
  <div class="panel" id="screenshot-panel">
    <div class="panel-header">实时截图</div>
    <img id="screenshot" src="/screenshot" alt="等待截图...">
  </div>

  <!-- 右上：漏斗 -->
  <div class="panel">
    <div class="panel-header">招聘漏斗</div>
    <div id="funnel"></div>
  </div>

  <!-- 右下：日志 -->
  <div class="panel">
    <div class="panel-header">实时日志</div>
    <div id="log"></div>
  </div>
</main>

<footer>
  <span style="color:#4b5563;font-size:11px;">localhost:${PORT}</span>
  <input id="intervene-input" type="text" placeholder="介入指令，如：跳过这个人 / 停止任务 / 只联系985..."
    style="flex:1;background:#1a1a1a;border:1px solid #333;border-radius:4px;color:#e0e0e0;padding:5px 10px;font-family:inherit;font-size:12px;outline:none;">
  <button class="btn" onclick="sendIntervention()">发送介入</button>
</footer>

<script>
const STATUS_LABEL = { contacted:'已触达', replied:'已回复', interviewed:'已面试', offered:'已Offer', joined:'已入职', rejected:'已淘汰', dropped:'已放弃' };

// SSE 日志流
const evtSource = new EventSource('/stream');
const log = document.getElementById('log');

function addLog(text, cls) {
  const d = document.createElement('div');
  d.className = 'entry ' + (cls || 'info');
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  if (log.children.length > 500) log.removeChild(log.firstChild);
}

evtSource.addEventListener('log', e => {
  const t = e.data;
  const cls = t.startsWith('💭') ? 'think' : t.startsWith('[') ? 'action' : t.startsWith('✓') ? 'ok' : t.startsWith('✗') || t.startsWith('错误') ? 'err' : 'info';
  addLog(t, cls);
});

evtSource.addEventListener('status', e => {
  const s = document.getElementById('status');
  if (e.data === 'running') { s.textContent = '运行中'; s.className = 'running'; }
  else { s.textContent = '空闲'; s.className = ''; }
});

evtSource.addEventListener('job', e => {
  document.getElementById('job-title').textContent = e.data;
});

// 截图轮询
setInterval(() => {
  const img = document.getElementById('screenshot');
  img.src = '/screenshot?t=' + Date.now();
}, 2000);

// 漏斗
async function loadFunnel() {
  const res = await fetch('/funnel');
  const data = await res.json();
  const el = document.getElementById('funnel');
  if (!data.length) { el.innerHTML = '<div style="padding:14px;color:#4b5563">暂无数据</div>'; return; }
  const max = Math.max(...data.map(r => r.count));
  el.innerHTML = data.map(r => \`
    <div class="funnel-row">
      <span class="funnel-label">\${STATUS_LABEL[r.status] || r.status}</span>
      <div class="funnel-bar" style="width:\${Math.round(r.count/max*120)}px"></div>
      <span class="funnel-count">\${r.count}</span>
    </div>
  \`).join('');
}

async function triggerRun(channel) {
  addLog('→ 触发 run' + (channel ? ' ' + channel : ''), 'info');
  await fetch('/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ channel }) });
}
async function triggerScan() {
  addLog('→ 触发 scan', 'info');
  await fetch('/scan', { method:'POST' });
}

async function sendIntervention() {
  const input = document.getElementById('intervene-input');
  const text = input.value.trim();
  if (!text) return;
  await fetch('/intervene', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: text }) });
  addLog('📩 你：' + text, 'ok');
  input.value = '';
}
document.getElementById('intervene-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendIntervention();
});

loadFunnel();
</script>
</body>
</html>`;

// ── 路由 ─────────────────────────────────────────────────
function router(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url?.split('?')[0] ?? '/';

  // GET /
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // GET /screenshot
  if (req.method === 'GET' && url === '/screenshot') {
    const fs = require('fs');
    const p = '/tmp/hireclaw-latest.jpg';
    if (!fs.existsSync(p)) {
      res.writeHead(204); res.end(); return;
    }
    const buf = fs.readFileSync(p);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.end(buf);
    return;
  }

  // GET /funnel
  if (req.method === 'GET' && url === '/funnel') {
    const job   = loadActiveJob();
    const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';
    const stats = db.prepare(`
      SELECT status, COUNT(*) as count FROM candidates
      WHERE job_id = ? GROUP BY status ORDER BY count DESC
    `).all(jobId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // GET /stream  (SSE)
  if (req.method === 'GET' && url === '/stream') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });

    const job = loadActiveJob();
    if (job) {
      res.write(`event: job\ndata: ${job.title}\n\n`);
    }

    const onLog    = (msg: string) => res.write(`event: log\ndata: ${msg.replace(/\n/g, ' ')}\n\n`);
    const onStatus = (s: string)   => res.write(`event: status\ndata: ${s}\n\n`);

    bus.on('log',    onLog);
    bus.on('status', onStatus);

    req.on('close', () => {
      bus.off('log',    onLog);
      bus.off('status', onStatus);
    });
    return;
  }

  // POST /run
  if (req.method === 'POST' && url === '/run') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      res.writeHead(202); res.end();
      const { channel } = body ? JSON.parse(body) : {};
      try {
        if (channel) await runChannel(channel as Channel);
        else await runJob();
      } catch (e: any) {
        bus.emit('log', `✗ 错误: ${e.message}`);
      }
    });
    return;
  }

  // POST /intervene
  if (req.method === 'POST' && url === '/intervene') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { message } = body ? JSON.parse(body) : {};
      if (message) pushIntervention(message);
      res.writeHead(200); res.end();
    });
    return;
  }

  // POST /scan
  if (req.method === 'POST' && url === '/scan') {
    res.writeHead(202); res.end();
    scanInbox().catch((e: any) => bus.emit('log', `✗ 错误: ${e.message}`));
    return;
  }

  res.writeHead(404); res.end();
}

// ── 启动 ─────────────────────────────────────────────────
export function startDashboard(): void {
  const server = http.createServer(router);
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n🦞 控制台已启动：\x1b[36m${url}\x1b[0m\n`);
    // macOS 自动开浏览器
    exec(`open ${url}`);
  });
}
