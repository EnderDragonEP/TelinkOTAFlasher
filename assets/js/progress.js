// Shared progress panel + "busy" state (screen wake lock, leave-page warning) for the
// flashing pages. Expects the #fw-progress markup used by index.html / ota.html / uart.html.
import { $ } from './ui.js';
import { formatDuration } from './util.js';

let wakeLock = null;
const beforeUnload = (ev) => {
  ev.preventDefault();
  ev.returnValue = '';
};

async function holdWakeLock(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* not critical */
  }
}

/** Long-running operation in progress: keep the screen on and warn before leaving the page. */
export function setBusy(on) {
  document.body.classList.toggle('is-flashing', on);
  if (on) window.addEventListener('beforeunload', beforeUnload);
  else window.removeEventListener('beforeunload', beforeUnload);
  holdWakeLock(on);
}

/**
 * Update the progress panel. `info` is null (starting) or
 * { block|done, blockCount|total, bytes, totalBytes?, elapsed (s), text? }.
 */
export function showProgress(info) {
  const wrap = $('fw-progress');
  if (!wrap) return;
  wrap.hidden = false;
  const done = info ? (info.done ?? info.block) : 0;
  const total = info ? (info.total ?? info.blockCount) : 1;
  const pct = info && total ? Math.floor((done / total) * 100) : 0;
  $('fw-bar').style.width = pct + '%';
  $('fw-bar').parentElement.setAttribute('aria-valuenow', String(pct));
  $('fw-pct').textContent = pct + '%';
  if (info && info.unit) {
    // counting items (e.g. history records) instead of bytes
    const rate = info.elapsed > 0 ? done / info.elapsed : 0;
    const remain = rate > 0 && info.known !== false ? (total - done) / rate : NaN;
    $('fw-blocks').textContent = info.text ?? `${done} / ${total} ${info.unit}`;
    $('fw-speed').textContent = rate ? `${Math.round(rate)} ${info.unit}/s` : '';
    $('fw-eta').textContent = `elapsed ${formatDuration(info.elapsed)}${info.known === false ? '' : ` · left ${formatDuration(remain)}`}`;
  } else if (info) {
    const totalBytes = info.totalBytes ?? total * 16;
    const speed = info.elapsed > 0 ? info.bytes / info.elapsed : 0;
    const remain = speed > 0 ? (totalBytes - info.bytes) / speed : NaN;
    $('fw-blocks').textContent = info.text ?? `block ${done} / ${total}`;
    $('fw-speed').textContent = speed ? `${(speed / 1024).toFixed(1)} KiB/s` : '';
    $('fw-eta').textContent = `elapsed ${formatDuration(info.elapsed)} · left ${formatDuration(remain)}`;
  } else {
    $('fw-blocks').textContent = 'starting…';
    $('fw-speed').textContent = '';
    $('fw-eta').textContent = '';
  }
}

/** Reset the panel before a new run; mark it done / failed afterwards. */
export function progressState(state) {
  const wrap = $('fw-progress');
  if (!wrap) return;
  wrap.classList.remove('done', 'failed');
  if (state === 'done' || state === 'failed') wrap.classList.add(state);
}
