/**
 * AppleScript Chrome 驱动（macOS）
 *
 * 直接接管用户正在使用的真实 Chrome——无需调试端口、无需重启浏览器，
 * 登录态、Cookie、浏览器指纹全部原生继承，风控风险远低于独立浏览器。
 *
 * 原理：osascript JXA 调用 Chrome 的 AppleScript 接口，在指定标签页内
 * execute javascript，复用与 DOM Runner 同源的 ref 标记快照协议。
 *
 * 唯一前置条件（一次性）：Chrome 菜单 视图 > 开发者 > 允许 Apple 事件中的 JavaScript。
 */

import { execFileSync } from 'child_process';

const JXA_DRIVER = `
function run(argv) {
  const mode = argv[0];
  const chrome = Application('Google Chrome');
  if (mode === 'running') {
    return chrome.running() ? 'yes' : 'no';
  }
  if (mode === 'tabs') {
    const out = [];
    const ws = chrome.windows();
    for (let wi = 0; wi < ws.length; wi++) {
      const ts = ws[wi].tabs();
      for (let ti = 0; ti < ts.length; ti++) {
        out.push(JSON.stringify({ wi: wi, ti: ti, title: ts[ti].title(), url: ts[ti].url() }));
      }
    }
    return out.join('\\n');
  }
  if (mode === 'exec') {
    const tab = chrome.windows[+argv[1]].tabs[+argv[2]];
    const r = chrome.execute(tab, { javascript: argv[3] });
    return r === undefined || r === null ? '' : String(r);
  }
  if (mode === 'goto') {
    chrome.windows[+argv[1]].tabs[+argv[2]].url = argv[3];
    return 'ok';
  }
  if (mode === 'activate') {
    chrome.activate();
    chrome.windows[+argv[1]].activeTabIndex = +argv[2] + 1;
    return 'ok';
  }
  return 'unknown mode';
}
`;

function jxa(args: string[], timeoutMs = 15000): string {
  return execFileSync('osascript', ['-l', 'JavaScript', '-e', JXA_DRIVER, ...args], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

export function chromeRunning(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    return jxa(['running'], 5000) === 'yes';
  } catch {
    return false;
  }
}

export interface ChromeTab {
  wi: number;
  ti: number;
  title: string;
  url: string;
}

export function listChromeTabs(): ChromeTab[] {
  const out = jxa(['tabs']);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(l => JSON.parse(l) as ChromeTab);
}

/**
 * 探测"Apple 事件中的 JavaScript"是否已开启。
 * 返回 null = 可用；否则返回给用户看的开启指引。
 */
export function probeJsPermission(tab: ChromeTab): string | null {
  try {
    const r = jxa(['exec', String(tab.wi), String(tab.ti), '1+1'], 8000);
    return r === '2' ? null : `JS 执行返回异常：${r}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/JavaScript|Apple\s*事件|turned off|不允许/i.test(msg)) {
      return '需要一次性开启 Chrome 权限：菜单栏 视图 > 开发者 > 允许 Apple 事件中的 JavaScript（开一次永久生效），开启后再让我重新连接。';
    }
    return `AppleScript 执行失败：${msg.slice(0, 150)}`;
  }
}

export function execJS(tab: ChromeTab, js: string): string {
  return jxa(['exec', String(tab.wi), String(tab.ti), js], 20000);
}

export function gotoUrl(tab: ChromeTab, url: string): void {
  jxa(['goto', String(tab.wi), String(tab.ti), url]);
}

export function activateTab(tab: ChromeTab): void {
  try {
    jxa(['activate', String(tab.wi), String(tab.ti)], 5000);
  } catch { /* 前置失败不影响 JS 操作 */ }
}

// ── 快照与动作（与 DOM Runner 同源的 ref 协议） ───────────────────────

/**
 * 页面内执行的快照脚本：标记 data-hs-ref 并返回 JSON。
 * 关键：递归进入【同源 iframe】——BOSS 企业端的候选人列表/推荐牛人渲染在 iframe 里，
 * 只读顶层 document 会"框架在、数据空"。同源 iframe 经 contentDocument 可达；跨源被
 * try/catch 吞掉，不影响顶层与可读帧。
 */
const SNAPSHOT_JS = `
(function () {
  var MAX_EL = 160, MAX_TEXT = 6000, MAX_DEPTH = 4;
  function visible(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      var win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      var s = win.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch (e) { return false; }
  }
  var sel = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="option"],[role="menuitem"],[role="checkbox"],[contenteditable="true"],[onclick]';
  var lines = [], texts = [], n = 0, frameSeen = 0, frameRead = 0;
  function collect(doc, depth) {
    var els;
    try { els = Array.prototype.filter.call(doc.querySelectorAll(sel), visible); } catch (e) { return; }
    for (var i = 0; i < els.length && n < MAX_EL; i++) {
      var el = els[i]; n++;
      try { el.setAttribute('data-hs-ref', String(n)); } catch (e) {}
      var tag = el.tagName.toLowerCase();
      var parts = ['[ref=' + n + '] <' + tag + (el.type ? ' type=' + el.type : '') + '>'];
      var t = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
      if (t) parts.push(t);
      if (el.placeholder) parts.push('placeholder="' + el.placeholder + '"');
      if (el.value && tag === 'input') parts.push('value="' + String(el.value).slice(0, 40) + '"');
      var aria = el.getAttribute('aria-label');
      if (aria) parts.push('aria="' + aria + '"');
      lines.push(parts.join(' '));
    }
    try { if (doc.body && doc.body.innerText) texts.push(doc.body.innerText); } catch (e) {}
    if (depth < MAX_DEPTH) {
      var frames;
      try { frames = doc.querySelectorAll('iframe,frame'); } catch (e) { frames = []; }
      for (var j = 0; j < frames.length && n < MAX_EL; j++) {
        frameSeen++;
        try { var d = frames[j].contentDocument; if (d) { frameRead++; collect(d, depth + 1); } } catch (e) {}
      }
    }
  }
  collect(document, 0);
  return JSON.stringify({
    url: location.href,
    title: document.title,
    elements: lines,
    bodyText: texts.join('\\n').replace(/\\n{3,}/g, '\\n\\n').slice(0, MAX_TEXT),
    frameSeen: frameSeen,
    frameRead: frameRead,
    scrollY: Math.round(window.scrollY),
    scrollMax: Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
  });
})()
`.trim();

/** 跨【同源 iframe】按 data-hs-ref 查元素的注入函数（click/type/refText 共用）。 */
const FIND_REF_FN = `
function __hsFind(ref) {
  function s(doc) {
    try {
      var el = doc.querySelector('[data-hs-ref="' + ref + '"]');
      if (el) return el;
      var fr = doc.querySelectorAll('iframe,frame');
      for (var i = 0; i < fr.length; i++) {
        try { var d = fr[i].contentDocument; if (d) { var e = s(d); if (e) return e; } } catch (_) {}
      }
    } catch (_) {}
    return null;
  }
  return s(document);
}`.trim();

export function takeSnapshot(tab: ChromeTab): string {
  const raw = execJS(tab, SNAPSHOT_JS);
  const data = JSON.parse(raw) as {
    url: string; title: string; elements: string[]; bodyText: string;
    frameSeen: number; frameRead: number; scrollY: number; scrollMax: number;
  };
  // iframe 诊断：BOSS 候选人列表在 iframe 里，frameSeen>frameRead 说明有跨源帧读不到
  const frameNote = data.frameSeen > 0
    ? `内嵌 iframe：发现 ${data.frameSeen} 个，可读 ${data.frameRead} 个${data.frameSeen > data.frameRead ? '（有跨源帧读不到，候选人列表若在其中需换策略）' : ''}`
    : '无 iframe';
  return [
    `URL: ${data.url}`,
    `标题: ${data.title}`,
    `滚动位置: ${data.scrollY}/${data.scrollMax}px ｜ ${frameNote}`,
    '',
    `## 可交互元素（共 ${data.elements.length} 个，含 iframe 内）`,
    ...data.elements,
    '',
    '## 页面正文',
    data.bodyText,
  ].join('\n');
}

/** 取 ref 元素文本（风控节流判定用）；跨同源 iframe 查找 */
export function refText(tab: ChromeTab, ref: number): string {
  try {
    return execJS(tab, `${FIND_REF_FN}
(function(){ var el = __hsFind(${ref}); return el ? (el.textContent || '') : ''; })()`).slice(0, 100);
  } catch {
    return '';
  }
}

export function clickRef(tab: ChromeTab, ref: number): void {
  const r = execJS(tab, `${FIND_REF_FN}
(function(){
  var el = __hsFind(${ref});
  if (!el) return 'NOT_FOUND';
  el.scrollIntoView({block:'center'});
  el.click();
  return 'ok';
})()`.trim());
  if (r === 'NOT_FOUND') throw new Error(`ref=${ref} 元素不存在（页面可能已变化，请重新快照）`);
}

export function typeRef(tab: ChromeTab, ref: number, text: string): void {
  // 文本经 JSON 转义注入，原生 setter + input 事件，兼容 React/Vue 受控组件
  const r = execJS(tab, `${FIND_REF_FN}
(function(){
  var el = __hsFind(${ref});
  if (!el) return 'NOT_FOUND';
  el.focus();
  var v = ${JSON.stringify(text)};
  var tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    var proto = tag === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
  } else {
    el.textContent = v;
  }
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return 'ok';
})()`.trim());
  if (r === 'NOT_FOUND') throw new Error(`ref=${ref} 元素不存在（页面可能已变化，请重新快照）`);
}

export function pressKey(tab: ChromeTab, key: string): void {
  const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  };
  const k = keyMap[key] ?? { key, code: key, keyCode: 0 };
  execJS(tab, `
(function(){
  // 焦点可能在同源 iframe 内：顶层 activeElement 会是 <iframe> 本身，需下钻到内层真实焦点元素
  function deepActive(doc){
    var a = doc.activeElement || doc.body;
    if (a && (a.tagName === 'IFRAME' || a.tagName === 'FRAME')) {
      try { if (a.contentDocument) return deepActive(a.contentDocument); } catch (_) {}
    }
    return a;
  }
  var t = deepActive(document);
  ['keydown','keypress','keyup'].forEach(function(type){
    t.dispatchEvent(new KeyboardEvent(type, {key:${JSON.stringify(k.key)}, code:${JSON.stringify(k.code)}, keyCode:${k.keyCode}, which:${k.keyCode}, bubbles:true, cancelable:true}));
  });
  var form = t.form;
  if (${JSON.stringify(k.key)} === 'Enter' && form && typeof form.requestSubmit === 'function') {
    try { form.requestSubmit(); } catch(e) {}
  }
  return 'ok';
})()`.trim());
}

export function scrollPage(tab: ChromeTab, amount: number): void {
  execJS(tab, `window.scrollBy(0, ${amount}); 'ok'`);
}

export function goBack(tab: ChromeTab): void {
  execJS(tab, `history.back(); 'ok'`);
}
