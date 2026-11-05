// Event log: fast (append-only DOM, capped), levelled, exportable.
// Levels: debug (hidden unless "verbose"), info, ok, warn, error.

const MAX_ENTRIES = 5000;
const entries = []; // { t: Date, level, text }
let listEl = null;
let scrollEl = null;
let countEl = null;
const pending = [];
const isNode = (p) => typeof Node !== 'undefined' && p instanceof Node;

function stringify(part) {
  if (part == null) return String(part);
  if (typeof part === 'string') return part;
  if (part instanceof Error) return part.message || String(part);
  if (typeof DOMException !== 'undefined' && part instanceof DOMException) return `${part.name}: ${part.message}`;
  if (isNode(part)) return part.textContent;
  if (ArrayBuffer.isView(part) || part instanceof ArrayBuffer) {
    const u8 = part instanceof ArrayBuffer ? new Uint8Array(part) : new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
    return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (typeof part === 'object') {
    try {
      return JSON.stringify(part, (k, v) => (typeof v === 'number' && k.toLowerCase().includes('uuid') ? v.toString(16) : v));
    } catch {
      return String(part);
    }
  }
  return String(part);
}

function render(entry, parts) {
  const line = document.createElement('div');
  line.className = `log-line lvl-${entry.level}`;
  const time = document.createElement('time');
  time.textContent = entry.t.toLocaleTimeString();
  const msg = document.createElement('span');
  msg.className = 'msg';
  for (const p of parts) {
    if (isNode(p)) msg.appendChild(p);
    else msg.appendChild(document.createTextNode(stringify(p)));
  }
  line.append(time, msg);
  const stick = scrollEl && scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 40;
  listEl.appendChild(line);
  while (listEl.childElementCount > MAX_ENTRIES) listEl.firstElementChild.remove();
  if (stick) scrollEl.scrollTop = scrollEl.scrollHeight;
  if (countEl) countEl.textContent = String(entries.length);
}

function write(level, parts) {
  const text = parts.map(stringify).join(' ');
  const entry = { t: new Date(), level, text };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'log';
  console[fn](`[${level}]`, ...parts.map((p) => (isNode(p) ? p.textContent : p)));
  if (listEl) render(entry, parts);
  else pending.push([entry, parts]);
}

export const log = {
  debug: (...parts) => write('debug', parts),
  info: (...parts) => write('info', parts),
  ok: (...parts) => write('ok', parts),
  warn: (...parts) => write('warn', parts),
  error: (...parts) => write('error', parts),
};

/** A clickable link that can be passed as a log part. */
export function logLink(text, href) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function initLog({ list, scroll, count }) {
  listEl = list;
  scrollEl = scroll;
  countEl = count;
  for (const [entry, parts] of pending.splice(0)) render(entry, parts);
}

export function clearLog() {
  entries.length = 0;
  if (listEl) listEl.textContent = '';
  if (countEl) countEl.textContent = '0';
}

export function logAsText({ includeDebug = true } = {}) {
  return entries
    .filter((e) => includeDebug || e.level !== 'debug')
    .map((e) => `${e.t.toISOString()} [${e.level.toUpperCase()}] ${e.text}`)
    .join('\n');
}
