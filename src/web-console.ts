/**
 * HireSeek 网页指挥台 —— 打开浏览器就能"看见它、指挥它"
 *
 * 守护进程是隐形的后台进程，对不开终端的 HR 等于不存在。这个本地网页就是它
 * 探出来的"脸"：一个网址（默认 http://localhost:7799），左边状态卡告诉你它
 * 此刻活着、今天干了多少、漏斗长什么样、心跳最近在想什么；右边一个聊天框，
 * 你打字就能指挥它——和飞书 Bot 共用同一套 agent 大脑（agent-session）。
 *
 *   hireseek console        单独启动指挥台（不需要守护进程）
 *   hireseek daemon ...      守护进程启动时自动把它拉起来并打开浏览器
 *
 * 设计原则：零配置、零终端。不需要飞书应用，不需要公网，不需要 API 以外的任何东西。
 */

import http from 'http';
import { exec } from 'child_process';
import { config } from './config';
import { db } from './db';
import { loadActiveJob } from './skills/loader';
import { setHeadless } from './permissions';
import { createSession, runAgentTurn, type AgentSession } from './agent-session';
import { collectVitals } from './vitals';

const PORT = parseInt(process.env.HIRESEEK_CONSOLE_PORT || '7799', 10);

const STATUS_LABEL: Record<string, string> = {
  contacted: '已触达', replied: '已回复', interviewed: '已面试',
  offered: '已Offer', joined: '已入职', rejected: '已淘汰', dropped: '已放弃',
};

// ── 网页只有一个使用者（你自己），用单一全局会话 ─────────────────────────
let webSession: AgentSession | null = null;
function getWebSession(): AgentSession {
  if (!webSession) webSession = createSession();
  return webSession;
}

// ── 状态数据：它此刻活着、今天干了什么 ──────────────────────────────────
function collectStatus(): Record<string, unknown> {
  const job = loadActiveJob();
  const jobId = job ? job.title.replace(/\s+/g, '_') : 'default';

  const today = db.prepare(
    `SELECT COUNT(*) AS n FROM candidates WHERE date(contacted_at) = date('now','localtime')`,
  ).get() as { n: number };
  const goal = (job as any)?.daily_goal?.contact ?? 30;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get() as { n: number };

  const funnel = db.prepare(`
    SELECT status, COUNT(*) AS count FROM candidates
    WHERE job_id = ? GROUP BY status ORDER BY count DESC
  `).all(jobId) as Array<{ status: string; count: number }>;

  // 心跳最近一条决策（可能没有表）
  let lastBeat: { action: string; reason: string; at: string } | null = null;
  try {
    const r = db.prepare(
      `SELECT action, reason, created_at FROM heartbeat_log ORDER BY id DESC LIMIT 1`,
    ).get() as { action: string; reason: string; created_at: string } | undefined;
    if (r) lastBeat = { action: r.action, reason: (r.reason ?? '').slice(0, 120), at: r.created_at.slice(5, 16) };
  } catch { /* 尚未有心跳表 */ }

  // 生命体征：真实的"在线吗/守护多久/最后报平安/下一步"，而非写死 online:true
  const vitals = collectVitals();

  return {
    online: vitals.online,
    guarding: vitals.guarding,
    staleness: vitals.staleness,
    uptime: vitals.uptime,
    next: vitals.next,
    job: job?.title ?? '（未设置职位）',
    today: today.n,
    goal,
    totalCandidates: total.n,
    funnel: funnel.map(f => ({ label: STATUS_LABEL[f.status] ?? f.status, count: f.count })),
    lastBeat,
    feishuBot: config.feishu.bot.enabled,
    model: process.env.LLM_MODEL || config.llm.model,
  };
}

// ── SSE 写入小工具 ─────────────────────────────────────────────────────
function sse(res: http.ServerResponse, event: string, data: string): void {
  res.write(`event: ${event}\ndata: ${data.replace(/\n/g, '\\n')}\n\n`);
}

// ── 路由 ───────────────────────────────────────────────────────────────
function router(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url?.split('?')[0] ?? '/';

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(collectStatus()));
    return;
  }

  // POST /api/chat — 返回 SSE：先流式回报"正在做什么"，最后给出回复
  if (req.method === 'POST' && url === '/api/chat') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      const { message } = body ? JSON.parse(body) : {};
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      if (!message || !String(message).trim()) {
        sse(res, 'reply', '（没有收到内容）');
        res.end();
        return;
      }

      const session = getWebSession();
      if (session.busy) {
        sse(res, 'reply', '我还在处理上一条，稍等我回复你～');
        res.end();
        return;
      }

      // 内置快捷指令
      if (message === '/clear' || message === '清空') {
        webSession = null;
        sse(res, 'reply', '已清空当前会话上下文，我们重新开始。');
        res.end();
        return;
      }

      session.busy = true;
      try {
        const reply = await runAgentTurn(session, String(message), {
          onStep: (label) => sse(res, 'step', label),
        });
        sse(res, 'reply', reply);
      } catch (err) {
        sse(res, 'reply', `处理时出错了：${err instanceof Error ? err.message : err}`);
      } finally {
        session.busy = false;
        res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
}

// ── 启动 ───────────────────────────────────────────────────────────────
let server: http.Server | null = null;

/** 启动网页指挥台。openBrowser=true 时自动打开浏览器（守护进程启动时用）。 */
export function startWebConsole(opts: { openBrowser?: boolean } = {}): void {
  if (server) return;

  // 指挥台运行在无人值守环境，危险工具默认拒绝（与飞书 Bot 同策略）
  setHeadless(true);

  // 指挥台本身也报平安：单独跑 `hireseek console` 时，生命体征能反映"我在（可达）"
  void import('./vitals').then(({ markAlive }) => {
    markAlive();
    setInterval(() => markAlive(), 60 * 1000);
  });

  server = http.createServer(router);
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[指挥台] 端口 ${PORT} 已被占用，可能已有一个实例在跑：http://localhost:${PORT}`);
    } else {
      console.error('[指挥台] 启动失败：', err.message);
    }
  });
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n🖥  HireSeek 指挥台已启动：\x1b[36m${url}\x1b[0m`);
    console.log('   打开浏览器就能看见它、直接打字指挥它（手机同一 WiFi 下也能访问本机 IP）。\n');
    if (opts.openBrowser) exec(`open ${url}`);
  });
}

// ── 页面（单文件，无外部依赖）───────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>HireSeek 指挥台</title>
<style>
  :root { --bg:#0b0d10; --panel:#13161b; --line:#222831; --fg:#e6e8eb; --muted:#8b949e; --accent:#5e7cff; --ok:#3fb950; --warn:#d29922; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font-family:-apple-system,'PingFang SC','Microsoft YaHei',system-ui,sans-serif; height:100vh; display:flex; }
  /* 左：状态 */
  aside { width:300px; background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:18px; gap:14px; overflow-y:auto; }
  .brand { display:flex; align-items:center; gap:10px; }
  .brand h1 { font-size:17px; letter-spacing:.5px; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--ok); box-shadow:0 0 8px var(--ok); }
  .dot.off { background:#555; box-shadow:none; }
  .dot.warn { background:#d29922; box-shadow:0 0 8px #d29922; }
  .sub { font-size:12px; color:var(--muted); }
  .card { background:#0e1116; border:1px solid var(--line); border-radius:10px; padding:13px 14px; }
  .card .k { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
  .big { font-size:26px; font-weight:600; }
  .big small { font-size:13px; color:var(--muted); font-weight:400; }
  .progress { height:6px; background:#1c212a; border-radius:3px; margin-top:9px; overflow:hidden; }
  .progress > div { height:100%; background:linear-gradient(90deg,var(--accent),#7aa2ff); border-radius:3px; transition:width .4s; }
  .frow { display:flex; align-items:center; gap:8px; margin:5px 0; font-size:12px; }
  .frow .lbl { width:54px; color:var(--muted); }
  .frow .bar { height:8px; background:var(--accent); border-radius:2px; min-width:3px; opacity:.85; }
  .frow .cnt { color:var(--fg); }
  .beat { font-size:12px; color:var(--muted); line-height:1.55; }
  .beat b { color:var(--fg); font-weight:600; }
  .foot { margin-top:auto; font-size:11px; color:#5a626c; line-height:1.6; }
  /* 右：对话 */
  main { flex:1; display:flex; flex-direction:column; min-width:0; }
  .chat { flex:1; overflow-y:auto; padding:24px 22px; display:flex; flex-direction:column; gap:14px; }
  .msg { max-width:760px; display:flex; flex-direction:column; gap:4px; }
  .msg.me { align-self:flex-end; align-items:flex-end; }
  .bubble { padding:11px 15px; border-radius:14px; font-size:14px; line-height:1.65; white-space:pre-wrap; word-break:break-word; }
  .me .bubble { background:var(--accent); color:#fff; border-bottom-right-radius:4px; }
  .bot .bubble { background:var(--panel); border:1px solid var(--line); border-bottom-left-radius:4px; }
  .steps { display:flex; flex-direction:column; gap:3px; }
  .step { font-size:12px; color:var(--muted); padding:2px 0 2px 4px; }
  .step::before { content:'▸ '; color:var(--accent); }
  .who { font-size:11px; color:#5a626c; padding:0 4px; }
  .composer { border-top:1px solid var(--line); padding:14px 18px; display:flex; gap:10px; background:var(--panel); }
  .composer textarea { flex:1; resize:none; background:#0e1116; border:1px solid var(--line); border-radius:10px; color:var(--fg); padding:11px 14px; font-family:inherit; font-size:14px; line-height:1.5; max-height:140px; outline:none; }
  .composer textarea:focus { border-color:var(--accent); }
  .composer button { background:var(--accent); color:#fff; border:none; border-radius:10px; padding:0 20px; font-size:14px; cursor:pointer; font-family:inherit; }
  .composer button:disabled { opacity:.45; cursor:not-allowed; }
  .hint { padding:0 18px 10px; font-size:11px; color:#5a626c; background:var(--panel); }
  @media (max-width:720px){ aside{ display:none; } }
</style>
</head>
<body>
<aside>
  <div class="brand"><span class="dot" id="dot"></span><h1>HireSeek 指挥台</h1></div>
  <div class="sub" id="liveline">加载中…</div>
  <div class="sub" id="jobline"></div>

  <div class="card">
    <div class="k">今日触达</div>
    <div class="big"><span id="today">–</span><small> / <span id="goal">–</span> 人</small></div>
    <div class="progress"><div id="prog" style="width:0%"></div></div>
  </div>

  <div class="card">
    <div class="k">招聘漏斗 · 共 <span id="total">0</span> 人</div>
    <div id="funnel"><div class="sub">暂无数据</div></div>
  </div>

  <div class="card">
    <div class="k">心跳最近决策</div>
    <div class="beat" id="beat">尚无心跳记录</div>
  </div>

  <div class="foot">
    模型 <span id="model">–</span><br>
    飞书 Bot <span id="feishu">–</span><br>
    状态每 10 秒刷新
  </div>
</aside>

<main>
  <div class="chat" id="chat"></div>
  <div class="hint">回车发送，Shift+回车换行 · 试试"今天进展怎么样""把做供应链的候选人列出来""派个后台任务调研张三" · 发「清空」重置</div>
  <div class="composer">
    <textarea id="input" rows="1" placeholder="和 HireSeek 说人话…"></textarea>
    <button id="send" onclick="send()">发送</button>
  </div>
</main>

<script>
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

function el(cls, html){ const d=document.createElement('div'); d.className=cls; if(html!=null) d.innerHTML=html; return d; }
function escapeHtml(s){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function addUser(text){
  const m = el('msg me'); m.appendChild(el('bubble', escapeHtml(text)));
  chat.appendChild(m); chat.scrollTop = chat.scrollHeight;
}
function addBot(){
  const m = el('msg bot');
  m.appendChild(el('who','HireSeek'));
  const steps = el('steps'); m.appendChild(steps);
  const bubble = el('bubble','<span class="sub">思考中…</span>'); m.appendChild(bubble);
  chat.appendChild(m); chat.scrollTop = chat.scrollHeight;
  return { addStep:(t)=>{ steps.appendChild(el('step', escapeHtml(t))); chat.scrollTop=chat.scrollHeight; },
           setReply:(t)=>{ bubble.innerHTML = escapeHtml(t); chat.scrollTop=chat.scrollHeight; } };
}

async function send(){
  const text = input.value.trim();
  if(!text) return;
  input.value=''; input.style.height='auto'; sendBtn.disabled=true;
  addUser(text);
  const bot = addBot();
  try {
    const res = await fetch('/api/chat',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:text}) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf='';
    while(true){
      const {done,value} = await reader.read();
      if(done) break;
      buf += decoder.decode(value,{stream:true});
      let idx;
      while((idx=buf.indexOf('\\n\\n'))>=0){
        const chunk = buf.slice(0,idx); buf = buf.slice(idx+2);
        const ev = /event: (\\w+)/.exec(chunk); const dt = /data: ([\\s\\S]*)/.exec(chunk);
        if(!ev||!dt) continue;
        const data = dt[1].replace(/\\\\n/g,'\\n');
        if(ev[1]==='step') bot.addStep(data);
        else if(ev[1]==='reply') bot.setReply(data);
      }
    }
  } catch(e){ bot.setReply('连接出错了：'+e.message); }
  finally { sendBtn.disabled=false; input.focus(); refresh(); }
}

input.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
input.addEventListener('input', ()=>{ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,140)+'px'; });

async function refresh(){
  try{
    const s = await (await fetch('/api/status')).json();
    const dot = document.getElementById('dot');
    const live = document.getElementById('liveline');
    if (s.guarding) { dot.className='dot'; live.textContent = '在线守护中 · 已守护 ' + (s.uptime||'—') + '（报平安 ' + (s.staleness||'刚刚') + '）'; }
    else if (s.online) { dot.className='dot warn'; live.textContent = '我在，但未常驻守护 · 装 daemon 才会自动跑定时任务'; }
    else { dot.className='dot off'; live.textContent = '未在守护'; }
    document.getElementById('jobline').textContent = '在岗：' + s.job + (s.next ? ' · 下一步 '+s.next.label : '');
    document.getElementById('today').textContent = s.today;
    document.getElementById('goal').textContent = s.goal;
    document.getElementById('total').textContent = s.totalCandidates;
    document.getElementById('model').textContent = s.model;
    document.getElementById('feishu').textContent = s.feishuBot?'已启用':'未启用';
    document.getElementById('prog').style.width = Math.min(100, Math.round(s.today/Math.max(1,s.goal)*100)) + '%';
    const max = Math.max(1, ...s.funnel.map(f=>f.count));
    const fn = document.getElementById('funnel');
    fn.innerHTML = s.funnel.length ? s.funnel.map(f=>
      '<div class="frow"><span class="lbl">'+f.label+'</span><span class="bar" style="width:'+Math.round(f.count/max*110)+'px"></span><span class="cnt">'+f.count+'</span></div>'
    ).join('') : '<div class="sub">暂无数据</div>';
    const b = document.getElementById('beat');
    b.innerHTML = s.lastBeat ? ('<b>'+escapeHtml(s.lastBeat.action)+'</b>（'+s.lastBeat.at+'）<br>'+escapeHtml(s.lastBeat.reason)) : '尚无心跳记录';
  }catch(e){ document.getElementById('dot').className='dot off'; }
}
refresh(); setInterval(refresh, 10000);

addBot().setReply('我在。左边是我此刻的状态，有什么要我做的，直接打字告诉我。');
</script>
</body>
</html>`;
