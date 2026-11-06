// USB-COM (UART -> SWire) flasher view: port of pvvx's USBCOMFlashTx.html and
// USBCOMFlashTx8269.html, merged with a chip selector. The serial port stays open while
// other tabs are shown.
import { mountView, store, webSerialSupport } from '../site.js';
import { log } from '../log.js';
import { $, html, render, getVal, setVal, setStatus, confirmDialog, alertDialog, toast, bindFileDrop } from '../ui.js';
import { formatBytes, until } from '../util.js';
import { validateOtaImage, hasTelinkMagic } from '../firmware.js';
import { SwireFlasher, CHIPS } from '../swire.js';
import { setBusy, showProgress, progressState } from '../progress.js';

const P = { port: null, writer: null, fw: null, busy: false, ctrl: null };
let mounted = false;

function updateButtons() {
  if (!mounted) return;
  const open = !!P.port;
  $('btn-open').textContent = open ? 'Close port' : 'Open port';
  $('btn-open').classList.toggle('primary', !open);
  $('btn-open').disabled = P.busy;
  $('btn-write').disabled = P.busy || !open || !P.fw;
  $('btn-erase').disabled = P.busy || !open;
  $('btn-reset').disabled = P.busy || !open;
  for (const id of ['ubaud', 'uchip']) $(id).disabled = open || P.busy;
  $('uatime').disabled = P.busy;
  const badge = $('conn-badge');
  badge.textContent = P.busy ? 'Working…' : open ? 'Open' : 'Closed';
  badge.className = P.busy ? 'pill pill-warn' : open ? 'pill pill-ok' : 'pill';
}

// ---------------------------------------------------------------------------
// Serial port

async function openPort() {
  try {
    const port = await navigator.serial.requestPort();
    const baudRate = Number(getVal('ubaud'));
    // A small buffer keeps the adapter's FIFO from smearing the SWire timing (multiple of 10, >= 60).
    await port.open({ baudRate, bufferSize: 240 });
    P.port = port;
    P.writer = port.writable.getWriter();
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    log.info(`USB-COM opened at ${baudRate} baud.`);
    setStatus(P.fw ? 'Port open. Press “Write to flash”.' : 'Port open. Choose a firmware file.', { kind: 'ok' });
    store.set('uartBaud', String(baudRate));
    store.set('uartChip', getVal('uchip'));
  } catch (err) {
    if (err && err.name === 'NotFoundError') log.info('No port selected.');
    else {
      log.error('There was an error opening the serial port: ' + (err.message || err));
      setStatus('Could not open the port: ' + (err.message || err), { kind: 'error' });
    }
    P.port = null;
    P.writer = null;
  }
  updateButtons();
}

async function closePort() {
  const { port, writer } = P;
  P.port = null;
  P.writer = null;
  try {
    if (writer) {
      await writer.close().catch(() => {});
      writer.releaseLock();
    }
    if (port) await port.close();
  } catch (err) {
    log.debug(err);
  }
  log.info('USB-COM closed.');
  if (mounted) setStatus('Port closed.');
  updateButtons();
}

const io = {
  write: (bytes) => P.writer.write(bytes),
  setSignals: (s) => P.port.setSignals(s),
};

// ---------------------------------------------------------------------------
// Operations

async function run(label, fn) {
  if (P.busy || !P.port) return;
  P.busy = true;
  P.ctrl = new AbortController();
  updateButtons();
  setBusy(true);
  const t0 = performance.now();
  const flasher = new SwireFlasher(io, getVal('uchip'));
  const activationMs = Number(getVal('uatime'));
  store.set('uartActivation', String(activationMs));
  try {
    await fn(flasher, activationMs, t0);
    const s = `${label} done (${((performance.now() - t0) / 1000).toFixed(1)} s).`;
    log.ok(s);
    setStatus(s, { kind: 'ok' });
    return true;
  } catch (err) {
    const s = `${label} failed: ${err.message || err}`;
    log.error(s);
    setStatus(s, { kind: 'error' });
    if (!P.port || (err && /lost|closed|disconnect/i.test(err.message || ''))) await closePort();
    return false;
  } finally {
    P.busy = false;
    P.ctrl = null;
    setBusy(false);
    updateButtons();
  }
}

const status = (s) => {
  log.debug(s);
  setStatus(s, { kind: 'busy' });
};

async function writeFlash() {
  if (!P.fw) return;
  const ok = await confirmDialog('The firmware is written from address 0, erasing each 4 KiB sector first. Do not disconnect the adapter while writing.', {
    title: 'Write to flash?',
    ok: 'Write',
    details: [
      ['Chip', CHIPS[getVal('uchip')].label],
      ['Firmware', P.fw.name],
      ['Size', formatBytes(P.fw.data.length)],
    ],
  });
  if (!ok) return;
  progressState('reset');
  showProgress(null);
  log.info(`Write ${P.fw.data.length} bytes in to Flash...`);
  const done = await run('Write', async (f, activationMs, t0) => {
    await f.writeFirmware(P.fw.data, {
      activationMs,
      signal: P.ctrl.signal,
      onStatus: status,
      onProgress: (addr, total) => {
        showProgress({ done: addr, total, bytes: addr, totalBytes: total, elapsed: (performance.now() - t0) / 1000, text: `${formatBytes(addr)} / ${formatBytes(total)} · 0x${addr.toString(16).padStart(6, '0')}` });
        setStatus(`Writing… ${Math.floor((addr / total) * 100)}%`, { kind: 'busy' });
      },
    });
    log.info('Soft Reset MCU');
  });
  progressState(done ? 'done' : 'failed');
  if (done) toast('Firmware written', 'ok', 4000);
}

async function eraseFlash() {
  const ok = await confirmDialog('Erase the whole flash? The device will not work until a firmware is written again.', { title: 'Erase all flash', ok: 'Erase', danger: true });
  if (!ok) return;
  await run('Erase', (f, activationMs) => f.eraseAll({ activationMs, onStatus: status }));
}

async function resetMcu() {
  await run('Soft reset', (f, activationMs) => f.reset({ activationMs, onStatus: status }));
}

async function abortWrite() {
  if (!P.ctrl) return;
  const ok = await confirmDialog('Abort writing? The flash will be left incomplete; write the firmware again before using the device.', { title: 'Abort', ok: 'Abort', danger: true });
  if (ok && P.ctrl) P.ctrl.abort();
}

// ---------------------------------------------------------------------------
// Firmware file

async function loadFile(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  log.info(`File was selected: ${file.name}, size: ${u8.length} bytes`);
  if (!hasTelinkMagic(u8)) {
    P.fw = null;
    renderFw();
    log.error('The selected file is not a Telink firmware .bin (no "KNLT" signature).');
    await alertDialog('The selected file is not a Telink firmware .bin (no "KNLT" signature at offset 8).', 'Not a Telink image');
    return;
  }
  const check = validateOtaImage(u8.slice().buffer, { bigOtaEnabled: false, fwMaxSize: Infinity });
  P.fw = { name: file.name, data: u8, check: check.status };
  if (check.status !== 'ok' && check.status !== 'sign') log.info(`Note: ${check.status} (normal for full flash dumps).`);
  renderFw();
  if (P.port) setStatus('Ready. Press “Write to flash”.', { kind: 'ok' });
}

function renderFw() {
  if (!mounted) return;
  $('fw-selected').hidden = !P.fw;
  if (P.fw) {
    const okCrc = P.fw.check === 'ok' || P.fw.check === 'sign';
    render(
      'fw-meta',
      html`<div class="fw-name"><b>${P.fw.name}</b></div>
        <div class="fw-facts">
          <span>${formatBytes(P.fw.data.length)}</span>
          <span>${Math.ceil(P.fw.data.length / 4096)} sectors</span>
          ${okCrc ? html`<span class="ok">OTA image, CRC OK</span>` : html`<span class="muted" title="${P.fw.check}">raw image (no OTA CRC)</span>`}
        </div>`,
    );
  }
  updateButtons();
}

const actions = {
  togglePort: () => (P.port ? closePort() : openPort()),
  writeFlash,
  eraseFlash,
  resetMcu,
  abortWrite,
  pickFile: () => $('file').click(),
  clearFirmware: () => {
    P.fw = null;
    $('file').value = '';
    renderFw();
  },
};

if (webSerialSupport().ok) {
  navigator.serial.addEventListener('disconnect', (ev) => {
    if (P.port && ev.target === P.port) {
      log.warn('The USB-UART adapter was unplugged.');
      P.port = null;
      P.writer = null;
      updateButtons();
    }
  });
}

export const view = {
  needs: 'serial',

  mount() {
    mounted = true;
    const supported = mountView({ page: 'uart', needs: 'serial', actions });
    setVal('ubaud', store.get('uartBaud') || '460800');
    setVal('uchip', store.get('uartChip') || 'tlsr825x');
    setVal('uatime', store.get('uartActivation') || '5000');
    bindFileDrop($('fw-drop'), $('file'), loadFile);
    renderFw();
    updateButtons();
    if (!supported) $('btn-open').disabled = true;
    if (!supported) setStatus('Web Serial is not available in this browser.');
    else if (P.port) setStatus(P.fw ? 'Port open. Press “Write to flash”.' : 'Port open. Choose a firmware file.', { kind: 'ok' });
    else setStatus('Connect the wires, then open the USB-UART port.');
  },

  unmount() {
    mounted = false;
  },

  /** Leaving while writing aborts it (after confirmation). */
  async canLeave() {
    if (!P.busy) return true;
    const ok = await confirmDialog('The adapter is still busy. Leaving this tab aborts the operation; write the firmware again before using the device.', {
      title: 'Operation in progress',
      ok: 'Abort and leave',
      cancel: 'Stay',
      danger: true,
    });
    if (!ok) return false;
    if (P.ctrl) P.ctrl.abort();
    await until(() => !P.busy, 15000);
    return true;
  },
};
