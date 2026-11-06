// Single-page shell. Every page (index.html, settings.html, live.html, …) loads this module.
// It keeps one document alive and switches views in place, so the Bluetooth connection (and an
// open serial port) survive switching tabs. Each HTML file stays a complete page: it is the
// entry point for direct links and reloads, and the source of its view's markup (.col-main).
import { NAV } from './config.js';
import { initShell } from './site.js';
import { updateIndicator } from './device-hub.js';
import { log } from './log.js';

const VIEWS = {
  flasher: () => import('./pages/flasher.js'),
  settings: () => import('./pages/flasher.js'),
  live: () => import('./pages/live.js'),
  history: () => import('./pages/history.js'),
  ota: () => import('./pages/generic-ota.js'),
  uart: () => import('./pages/uart.js'),
};
const UPLOT = { css: 'assets/vendor/uplot/uPlot.min.css', js: 'assets/vendor/uplot/uPlot.iife.min.js' };

const pages = new Map(); // view id -> { title, description, main }
const current = { id: null, view: null, url: location.href };
let navigating = false;
let uplotLoading = null;

const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);

/** View id of a same-site page URL, or null for anything else. */
function pageIdOf(url) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin || dirOf(u.pathname) !== dirOf(location.pathname)) return null;
  const file = u.pathname.slice(u.pathname.lastIndexOf('/') + 1) || 'index.html';
  const entry = NAV.find((p) => p.href === file);
  return entry ? entry.id : null;
}

function snapshot(doc) {
  const main = doc.querySelector('.col-main');
  const meta = doc.querySelector('meta[name="description"]');
  return { title: doc.title, description: meta ? meta.content : '', main: main ? main.innerHTML : null };
}

async function loadPage(id, url) {
  if (pages.has(id)) return pages.get(id);
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const page = snapshot(new DOMParser().parseFromString(await res.text(), 'text/html'));
  if (page.main == null) throw new Error('the page has no .col-main');
  pages.set(id, page);
  return page;
}

/** uPlot is only needed by the chart views: load it on first use (before app.css, which overrides it). */
function ensureUplot() {
  if (window.uPlot) return Promise.resolve();
  if (!document.querySelector(`link[href="${UPLOT.css}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = UPLOT.css;
    document.head.insertBefore(link, document.querySelector('link[href$="app.css"]'));
  }
  uplotLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = UPLOT.js;
    s.onload = resolve;
    s.onerror = () => {
      uplotLoading = null;
      reject(new Error('uPlot failed to load'));
    };
    document.head.appendChild(s);
  });
  return uplotLoading;
}

async function show(id) {
  const mod = await VIEWS[id]();
  if (mod.view.uplot) await ensureUplot();
  current.id = id;
  current.view = mod.view;
  document.body.dataset.page = id;
  mod.view.mount(id);
}

/** Switch to the view of `url` without reloading the document. */
async function navigate(url, { push = true } = {}) {
  const id = pageIdOf(url);
  if (!id) {
    location.href = url;
    return;
  }
  if (navigating) return;
  if (id === current.id) {
    window.scrollTo(0, 0);
    return;
  }
  navigating = true;
  try {
    if (current.view && current.view.canLeave && !(await current.view.canLeave())) {
      if (!push) history.pushState({ page: current.id }, '', current.url); // undo Back / Forward
      return;
    }
    let page;
    try {
      page = await loadPage(id, url);
    } catch (err) {
      log.debug(`Could not load ${url} in place (${err.message}); opening it normally.`);
      location.href = url;
      return;
    }
    if (current.view) current.view.unmount();
    current.view = null;
    document.querySelector('.col-main').innerHTML = page.main;
    document.title = page.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = page.description;
    if (push) history.pushState({ page: id }, '', url);
    current.url = location.href;
    window.scrollTo(0, 0);
    await show(id);
  } catch (err) {
    log.error(`Could not open the page: ${err.message || err}`);
  } finally {
    navigating = false;
  }
}

// Same-site page links switch views in place; new-tab clicks and other links behave normally.
document.addEventListener('click', (ev) => {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const a = ev.target.closest('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const url = new URL(a.getAttribute('href'), location.href);
  if (url.hash && url.pathname === location.pathname) return;
  if (!pageIdOf(url.href)) return;
  ev.preventDefault();
  navigate(url.href);
});

window.addEventListener('popstate', () => navigate(location.href, { push: false }));

// Boot: remember the markup of the page we were loaded with, then show its view.
const initialId = document.body.dataset.page || pageIdOf(location.href) || 'flasher';
pages.set(initialId, snapshot(document));
history.replaceState({ page: initialId }, '');
initShell(initialId);
updateIndicator();
show(initialId).catch((err) => log.error(`Could not start the page: ${err.message || err}`));
