// DOM helpers: safe HTML templates, field accessors, status line, dialogs and toasts.

export const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Safe HTML templating: interpolated values are escaped unless they are the result
// of another html`` call (or raw()). Arrays are concatenated; null/false render nothing.
class SafeHtml {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const toHtml = (v) => {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return escapeHtml(v);
};
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += toHtml(vals[i]) + strings[i + 1];
  return new SafeHtml(out);
}
export const raw = (s) => new SafeHtml(String(s));

/** Render a template into an element, preserving which <details data-key> were open. */
export function render(el, tpl) {
  if (typeof el === 'string') el = $(el);
  if (!el) return;
  const previous = new Map([...el.querySelectorAll('details[data-key]')].map((d) => [d.dataset.key, d.open]));
  el.innerHTML = toHtml(tpl);
  for (const d of el.querySelectorAll('details[data-key]')) {
    if (previous.has(d.dataset.key)) d.open = previous.get(d.dataset.key);
  }
}

// ---------------------------------------------------------------------------
// Field accessors that tolerate missing elements (the original page threw TypeErrors).
export function getVal(id, fallback = '') {
  const el = $(id);
  return el ? el.value : fallback;
}
export function setVal(id, value) {
  const el = $(id);
  if (el) el.value = value;
  return !!el;
}
export function getChecked(id, fallback = false) {
  const el = $(id);
  return el ? el.checked : fallback;
}
export function setChecked(id, value) {
  const el = $(id);
  if (el) el.checked = !!value;
  return !!el;
}
export const exists = (id) => !!$(id);

export function setHidden(id, hidden) {
  const el = typeof id === 'string' ? $(id) : id;
  if (el) el.hidden = !!hidden;
}

// ---------------------------------------------------------------------------
// Status line + live data + connection badge

let statusListener = null;
export function onStatus(fn) {
  statusListener = fn;
}

/** Status text, optional { kind: 'info'|'ok'|'warn'|'error'|'busy', link: {text, href} }. */
export function setStatus(text, opts = {}) {
  const el = $('status');
  if (!el) return;
  el.className = `status status-${opts.kind || 'info'}`;
  el.textContent = '';
  const span = document.createElement('span');
  span.textContent = text;
  if (opts.link) {
    const a = document.createElement('a');
    a.href = opts.link.href;
    a.textContent = opts.link.text;
    a.target = '_blank';
    a.rel = 'noopener';
    span.append(' ', a);
  }
  el.appendChild(span);
  if (statusListener) statusListener(text);
}

/** Live measurements: array of [label, value] pairs, or a plain string. */
export function setLive(parts, source = '') {
  const el = $('live');
  if (!el) return;
  if (parts == null) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = '';
  const list = typeof parts === 'string' ? [[null, parts]] : parts;
  for (const [label, value] of list) {
    const chip = document.createElement('span');
    chip.className = 'reading';
    if (label) {
      const l = document.createElement('small');
      l.textContent = label;
      chip.appendChild(l);
    }
    const v = document.createElement('b');
    v.textContent = value;
    chip.appendChild(v);
    el.appendChild(chip);
  }
  const ts = document.createElement('span');
  ts.className = 'reading-time';
  ts.textContent = `${source ? source + ' · ' : ''}${new Date().toLocaleTimeString()}`;
  el.appendChild(ts);
}

export function setBadge(phase) {
  const el = $('conn-badge');
  if (!el) return;
  const map = {
    idle: ['Disconnected', 'pill'],
    connecting: ['Connecting…', 'pill pill-busy'],
    connected: ['Connected', 'pill pill-ok'],
    flashing: ['Flashing…', 'pill pill-warn'],
  };
  const [text, cls] = map[phase] || map.idle;
  el.textContent = text;
  el.className = cls;
}

// ---------------------------------------------------------------------------
// Dialogs (async replacements for alert/confirm) and toasts

export function confirmDialog(message, { title = 'Please confirm', ok = 'Continue', cancel = 'Cancel', danger = false, details = null } = {}) {
  const dlg = $('dialog');
  if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    $('dialog-title').textContent = title;
    const body = $('dialog-body');
    body.textContent = '';
    for (const para of String(message).split('\n')) {
      const p = document.createElement('p');
      p.textContent = para;
      body.appendChild(p);
    }
    if (details) {
      const dl = document.createElement('dl');
      dl.className = 'kv';
      for (const [k, v] of details) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      }
      body.appendChild(dl);
    }
    const okBtn = $('dialog-ok');
    const cancelBtn = $('dialog-cancel');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
    cancelBtn.textContent = cancel;
    cancelBtn.hidden = cancel === null;
    const done = (v) => {
      okBtn.onclick = cancelBtn.onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    dlg.onclose = () => done(false);
    dlg.showModal();
    (cancel === null ? okBtn : cancelBtn).focus();
  });
}

export const alertDialog = (message, title = 'Notice') => confirmDialog(message, { title, ok: 'OK', cancel: null });

export function toast(message, kind = 'info', ms = 2600) {
  const host = $('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} to clipboard`, 'ok');
  } catch {
    toast('Clipboard is not available', 'warn');
  }
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ---------------------------------------------------------------------------
// Event delegation: <button data-action="name" data-arg="x"> and <button data-cmd="55">.
const actions = Object.create(null);
export function registerActions(map) {
  Object.assign(actions, map);
}

export function bindDelegation(root, onCommand, onError) {
  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action],[data-cmd]');
    if (!el || !root.contains(el) || el.disabled) return;
    if (el.tagName === 'A' && !el.dataset.action) return;
    ev.preventDefault();
    try {
      if (el.dataset.confirm) {
        const ok = await confirmDialog(el.dataset.confirm, { danger: el.classList.contains('danger'), ok: el.dataset.confirmOk || 'Continue' });
        if (!ok) return;
      }
      if (el.dataset.cmd !== undefined) {
        await onCommand(el.dataset.cmd);
      } else {
        const fn = actions[el.dataset.action];
        if (!fn) throw new Error(`Unknown action "${el.dataset.action}"`);
        await fn(el.dataset.arg, el, ev);
      }
    } catch (err) {
      onError(err);
    }
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = actions[el.dataset.change];
    if (fn) {
      try {
        fn(el.value, el, ev);
      } catch (err) {
        onError(err);
      }
    }
  });
  root.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('[data-enter]');
    if (!el || ev.key !== 'Enter') return;
    const fn = actions[el.dataset.enter];
    if (fn) {
      ev.preventDefault();
      Promise.resolve(fn(el.value, el, ev)).catch(onError);
    }
  });
}

/** File picker + drag & drop on a drop zone; calls onFile(File). */
export function bindFileDrop(drop, input, onFile) {
  input.addEventListener('change', () => {
    if (input.files[0]) onFile(input.files[0]);
  });
  const stop = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  for (const t of ['dragenter', 'dragover']) {
    drop.addEventListener(t, (ev) => {
      stop(ev);
      drop.classList.add('dragging');
    });
  }
  for (const t of ['dragleave', 'drop']) {
    drop.addEventListener(t, (ev) => {
      stop(ev);
      drop.classList.remove('dragging');
    });
  }
  drop.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer && ev.dataTransfer.files[0];
    if (file) onFile(file);
  });
}
