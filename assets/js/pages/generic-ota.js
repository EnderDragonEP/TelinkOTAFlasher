// Generic Telink OTA page (port of pvvx's TelinkOTA.html): same OTA protocol as the flasher,
// user-defined service / characteristic UUIDs, any image with the "KNLT" signature.
import { initSite, store } from '../site.js';
import { BleSession } from '../ble-session.js';
import { log } from '../log.js';
import { $, html, render, getVal, setVal, setStatus, confirmDialog, alertDialog, toast, bindFileDrop } from '../ui.js';
import { formatBytes } from '../util.js';
import { validateOtaImage, padTo16, hasTelinkMagic } from '../firmware.js';
import { runOta, describeOtaResult, OtaError } from '../ota.js';
import { setBusy, showProgress, progressState } from '../progress.js';

const DEFAULT_SERVICE = '00010203-0405-0607-0809-0a0b0c0d1912';
const DEFAULT_CHAR = '00010203-0405-0607-0809-0a0b0c0d2b12';

const P = { otaChar: null, fw: null, ctrl: null };

/** Full 128-bit UUID, or a 16/32-bit alias written as hex (e.g. 1912, 0x1F10). */
function parseUuid(text) {
  const t = String(text).trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) return t;
  const m = t.match(/^(?:0x)?([0-9a-f]{4}|[0-9a-f]{8})$/);
  return m ? parseInt(m[1], 16) : null;
}

const uuids = () => ({ service: parseUuid(getVal('iPServ')), char: parseUuid(getVal('iPChar')) });

function updateButtons() {
  const busy = !!P.ctrl;
  const phase = session.phase;
  $('btn-connect').disabled = busy || phase === 'connecting';
  $('btn-reconnect').disabled = busy || !session.device;
  $('btn-disconnect').disabled = phase === 'idle';
  $('btn-flash').disabled = busy || !P.fw || !session.connected || !P.otaChar;
}

const session = new BleSession({
  optionalServices: () => [uuids().service].filter((u) => u !== null),
  hideUnnamed: () => $('hideUnknown').checked,
  onState: () => updateButtons(),
  onDisconnected: () => {
    P.otaChar = null;
    updateButtons();
  },
  onConnected: async (server) => {
    const { service, char } = uuids();
    const svc = await server.getPrimaryService(service);
    log.debug('Found OTA service');
    P.otaChar = await svc.getCharacteristic(char);
    log.info('Found OTA write characteristic');
    setStatus(`Connected to ${session.device.name || 'device'}. ${P.fw ? 'Press “Start flashing”.' : 'Choose a firmware file.'}`, { kind: 'ok' });
  },
});

async function connect(reuse = false) {
  const { service, char } = uuids();
  if (service === null || char === null) {
    toast('Enter valid service and characteristic UUIDs', 'warn');
    log.error('Invalid UUID: use the 128-bit form (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) or a 16-bit hex alias.');
    return;
  }
  store.set('otaService', getVal('iPServ').trim());
  store.set('otaChar', getVal('iPChar').trim());
  await session.connect({ reuse });
  updateButtons();
}

async function loadFile(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  log.info(`File was selected: ${file.name}, size: ${u8.length} bytes`);
  if (!hasTelinkMagic(u8)) {
    P.fw = null;
    renderFw();
    log.error('The selected file is not a Telink firmware .bin (no "KNLT" signature).');
    await alertDialog('The selected file is not a Telink firmware .bin (no "KNLT" signature at offset 8).', 'Not a Telink image');
    return;
  }
  const check = validateOtaImage(buf, { bigOtaEnabled: false, fwMaxSize: Infinity });
  const data = padTo16(u8.slice());
  P.fw = { name: file.name, data, blockCount: data.length / 16, size: u8.length, check: check.status };
  log.info('Count: ' + P.fw.blockCount);
  if (check.status !== 'ok' && check.status !== 'sign') log.warn(`Image check: ${check.status} The device may reject it.`);
  renderFw();
  if (session.connected) setStatus('Firmware ready. Press “Start flashing”.', { kind: 'ok' });
}

function renderFw() {
  $('fw-selected').hidden = !P.fw;
  if (P.fw) {
    const okCrc = P.fw.check === 'ok' || P.fw.check === 'sign';
    render(
      'fw-meta',
      html`<div class="fw-name"><b>${P.fw.name}</b></div>
        <div class="fw-facts">
          <span>${formatBytes(P.fw.size)}</span><span>${P.fw.blockCount} blocks</span>
          ${okCrc ? html`<span class="ok">CRC OK</span>` : html`<span class="warn-text" title="${P.fw.check}">CRC not verified</span>`}
        </div>`,
    );
  }
  updateButtons();
}

async function startDFU() {
  if (!P.fw) {
    log.warn('No file selected aborting');
    return;
  }
  if (!P.otaChar) {
    log.warn('Not connected');
    return;
  }
  const ok = await confirmDialog('Keep this page open and the device close until flashing finishes.', {
    title: 'Start flashing?',
    ok: 'Start flashing',
    details: [
      ['Device', session.device.name || '(unnamed)'],
      ['Firmware', P.fw.name],
      ['Size', `${formatBytes(P.fw.size)} · ${P.fw.blockCount} blocks`],
    ],
  });
  if (!ok) return;
  P.ctrl = new AbortController();
  updateButtons();
  setBusy(true);
  progressState('reset');
  showProgress(null);
  setStatus(`Flashing ${P.fw.name}…`, { kind: 'busy' });
  try {
    const { seconds } = await runOta({ otaChar: P.otaChar, data: P.fw.data, signal: P.ctrl.signal, onProgress: showProgress, checkStatus: false });
    const s = describeOtaResult(0, seconds.toFixed(2));
    log.ok(s);
    setStatus(s + '.', { kind: 'ok' });
    progressState('done');
    toast('Flashing finished', 'ok', 4000);
  } catch (err) {
    const s = err instanceof OtaError ? err.message : 'Update error: ' + (err.message || err);
    log.error(s);
    setStatus(s, { kind: 'error' });
    progressState('failed');
  } finally {
    P.ctrl = null;
    setBusy(false);
    updateButtons();
  }
}

async function abortOta() {
  if (!P.ctrl) return;
  const ok = await confirmDialog('Abort flashing? The device keeps its current firmware and restarts after a timeout.', { title: 'Abort flashing', ok: 'Abort', danger: true });
  if (ok && P.ctrl) P.ctrl.abort();
}

const supported = initSite({
  page: 'ota',
  needs: 'bluetooth',
  actions: {
    connect: () => connect(false),
    reconnect: () => connect(true),
    disconnect: () => session.disconnect(),
    pickFile: () => $('file').click(),
    startDFU,
    abortOta,
    clearFirmware: () => {
      P.fw = null;
      $('file').value = '';
      renderFw();
    },
    resetUuids: () => {
      setVal('iPServ', DEFAULT_SERVICE);
      setVal('iPChar', DEFAULT_CHAR);
    },
  },
});
setVal('iPServ', store.get('otaService') || DEFAULT_SERVICE);
setVal('iPChar', store.get('otaChar') || DEFAULT_CHAR);
bindFileDrop($('fw-drop'), $('file'), loadFile);
updateButtons();
if (!supported) $('btn-connect').disabled = true;
setStatus('Waiting for you to connect a device.');
