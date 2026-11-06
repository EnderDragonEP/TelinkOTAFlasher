// Shared page shell: header/navigation, theme, support banner, name filter, log controls and
// action delegation. Every page calls initSite() from its entry module.
import { APP, NAV, EXTERNAL_TOOLS, NAME_PREFIXES } from './config.js';
import { installGattQueue, webBluetoothSupport } from './ble.js';
import { log, initLog, clearLog, logAsText } from './log.js';
import { $, html, render, getVal, registerActions, bindDelegation, toast, copyText, downloadText } from './ui.js';

export const store = {
  get(k, d = null) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

// ---------------------------------------------------------------------------
// Theme: pages follow the device's light/dark setting. The header button flips it for the
// current page only (nothing is stored); a change of the device theme takes over again.

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const SUN_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const MOON_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill="currentColor"/></svg>`;

const deviceTheme = () => (darkQuery.matches ? 'dark' : 'light');

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : deviceTheme();
}

/** The icon shows the theme a click switches to. */
function syncThemeButton() {
  const btn = $('theme-toggle');
  if (!btn) return;
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  render(btn, next === 'light' ? SUN_ICON : MOON_ICON);
  btn.setAttribute('aria-label', `Switch to ${next} theme`);
  btn.title = `Switch to ${next} theme`;
}

/** 'light' | 'dark' | null (follow the device). An override equal to the device theme is dropped. */
function setTheme(theme) {
  const root = document.documentElement;
  if (theme && theme !== deviceTheme()) root.dataset.theme = theme;
  else delete root.dataset.theme;
  syncThemeButton();
  document.dispatchEvent(new CustomEvent('themechange'));
}

function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  syncThemeButton();
  darkQuery.addEventListener('change', () => setTheme(null));
}

// ---------------------------------------------------------------------------
// Header

function renderHeader(pageId) {
  const host = $('site-header');
  if (!host) return;
  host.className = 'topbar';
  render(
    host,
    html`<a class="brand" href="index.html" title="${APP.name}">
        <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M11 10.5l10 9-5 4.5V8l5 4.5-10 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="brand-name">${APP.name}</span>
        <span class="badge">v${APP.version}</span>
      </a>
      <nav class="topnav" aria-label="Pages">
        <div class="navtabs">
          ${NAV.map(
            (p) => html`<a class="navtab${p.id === pageId ? ' active' : ''}" href="${p.href}" title="${p.title}"${p.id === pageId ? html` aria-current="page"` : ''}>${p.label}</a>`,
          )}
        </div>
        <details class="menu">
          <summary>More</summary>
          <div class="menu-list">
            <span class="menu-head menu-pages">This site</span>
            ${NAV.map((p) => html`<a class="menu-pages${p.id === pageId ? ' active' : ''}" href="${p.href}">${p.label}</a>`)}
            ${EXTERNAL_TOOLS.map(
              ([head, links]) => html`<span class="menu-head">${head}</span>${links.map(([label, href]) => html`<a href="${href}" target="_blank" rel="noopener">${label} ↗</a>`)}`,
            )}
          </div>
        </details>
        <button type="button" class="icon-btn" id="theme-toggle" data-action="toggleTheme" aria-label="Switch theme"></button>
      </nav>`,
  );
  // Close the "More" menu when clicking elsewhere.
  document.addEventListener('click', (ev) => {
    const menu = host.querySelector('details.menu');
    if (menu && menu.open && !menu.contains(ev.target)) menu.open = false;
  });
}

// ---------------------------------------------------------------------------
// Browser support

export function webSerialSupport() {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!('serial' in navigator)) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

/** Show the support banner; returns true when the required API is available. */
function checkSupport(kind) {
  const el = $('support-banner');
  const support = kind === 'serial' ? webSerialSupport() : kind === 'bluetooth' ? webBluetoothSupport() : { ok: true };
  if (support.ok || !el) return support.ok;
  el.hidden = false;
  if (support.reason === 'insecure') {
    el.innerHTML = '<b>This page needs a secure context.</b> Open it over <code>https://</code> (GitHub Pages does this) or from <code>http://localhost</code>.';
  } else if (kind === 'serial') {
    el.innerHTML =
      '<b>This browser does not support Web Serial.</b> Use desktop Chrome, Edge or Opera (Windows, macOS, Linux, ChromeOS). ' +
      'Android and iOS browsers cannot access USB-UART adapters.';
  } else {
    el.innerHTML =
      '<b>This browser does not support Web Bluetooth.</b> Use Chrome, Edge or Opera on Windows, macOS, Linux, ChromeOS or Android. ' +
      'On iOS use the <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy</a> browser. ' +
      'On Linux you may need to enable <code>chrome://flags/#enable-experimental-web-platform-features</code>.';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Device name filter (shared across pages through localStorage['namePrefix'])

function prefixList() {
  return getVal('namePrefix')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function syncChips() {
  const list = prefixList();
  for (const c of document.querySelectorAll('#prefix-chips .chip')) c.classList.toggle('on', list.includes(c.dataset.arg));
}

function togglePrefix(p) {
  const list = prefixList();
  const i = list.indexOf(p);
  if (i >= 0) list.splice(i, 1);
  else list.push(p);
  $('namePrefix').value = list.join(',');
  store.set('namePrefix', $('namePrefix').value);
  syncChips();
}

function initPrefix() {
  const input = $('namePrefix');
  if (!input) return;
  input.value = store.get('namePrefix', '');
  input.addEventListener('change', () => store.set('namePrefix', input.value.trim()));
  input.addEventListener('input', syncChips);
  const chips = $('prefix-chips');
  if (chips) {
    for (const p of NAME_PREFIXES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p;
      b.dataset.action = 'togglePrefix';
      b.dataset.arg = p;
      chips.appendChild(b);
    }
  }
  syncChips();
}

/** requestDevice() filter options from the name filter input. */
export function nameFilterOptions(optionalServices, { hideUnnamed = false } = {}) {
  const options = { optionalServices, acceptAllDevices: true };
  const prefixes = $('namePrefix') ? prefixList() : [];
  if (prefixes.length) {
    options.acceptAllDevices = false;
    options.filters = prefixes.map((namePrefix) => ({ namePrefix }));
  } else if (hideUnnamed) {
    // Any device with a name (the original pages' "hide unknown" trick).
    options.acceptAllDevices = false;
    options.filters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz0123456789_#@!*';,.<>{}[]".split('').map((namePrefix) => ({ namePrefix }));
  }
  return options;
}

// ---------------------------------------------------------------------------
// Log

function initLogControls() {
  const box = $('log');
  const verbose = $('log-verbose');
  if (!box || !verbose) return;
  verbose.checked = store.get('verbose') === '1';
  box.classList.toggle('hide-debug', !verbose.checked);
  verbose.addEventListener('change', () => {
    box.classList.toggle('hide-debug', !verbose.checked);
    store.set('verbose', verbose.checked ? '1' : '0');
  });
}

export function onActionError(err) {
  const msg = err && err.message ? err.message : String(err);
  log.error(msg);
  toast(msg, 'error', 4000);
}

/**
 * Common page setup.
 * opts: { page: NAV id, needs: 'bluetooth' | 'serial' | null, onCommand?(hex), actions?: {} }
 * Returns whether the required browser API is available.
 */
export function initSite({ page, needs = 'bluetooth', onCommand = async () => {}, actions = {} }) {
  renderHeader(page);
  initTheme();
  if (needs === 'bluetooth') installGattQueue();
  if ($('log-list')) initLog({ list: $('log-list'), scroll: $('log-list'), count: $('log-count') });
  initLogControls();
  initPrefix();
  registerActions({
    toggleTheme,
    togglePrefix,
    copyLog: () => copyText(logAsText({ includeDebug: !!($('log-verbose') && $('log-verbose').checked) }), 'Log copied'),
    downloadLog: () => downloadText(`telink-${page}-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, logAsText()),
    clearLog,
    ...actions,
  });
  bindDelegation(document.body, onCommand, onActionError);
  const ok = checkSupport(needs);
  const nav = NAV.find((n) => n.id === page);
  if (page !== 'flasher' && nav) log.info(`${nav.label} · ${APP.name} v${APP.version}`);
  window.flasherLog = log;
  return ok;
}
