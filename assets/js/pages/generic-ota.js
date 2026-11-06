// Generic Telink OTA view (port of pvvx's TelinkOTA.html): same OTA protocol as the flasher,
// user-defined service / characteristic UUIDs, any image with the "KNLT" signature.
import { mountView, store } from '../site.js';
import { hub } from '../device-hub.js';
import { BleSession } from '../ble-session.js';
import { parseUuid } from '../ble.js';
import { log } from '../log.js';
import { $, html, render, getVal, setVal, getChecked, setChecked, setStatus, confirmDialog, alertDialog, toast, bindFileDrop } from '../ui.js';
import { formatBytes, until } from '../util.js';
import { validateOtaImage, padTo16, hasTelinkMagic } from '../firmware.js';
import { runOta, describeOtaResult, OtaError } from '../ota.js';
import { setBusy, showProgress, progressState } from '../progress.js';

const DEFAULT_SERVICE = '00010203-0405-0607-0809-0a0b0c0d1912';
const DEFAULT_CHAR = '00010203-0405-0607-0809-0a0b0c0d2b12';

const P = { otaChar: null, fw: null, ctrl: null, hideUnknown: true };
let mounted = false;

const uuids = () => ({ service: parseUuid(getVal('iPServ')), char: parseUuid(getVal('iPChar')) });

function updateButtons() {
  if (!mounted) return;
  const busy = !!P.ctrl;
  const phase = session.phase;
  $('btn-connect').disabled = busy || phase === 'connecting';
  $('btn-reconnect').disabled = busy || !hub.device || phase !== 'idle';
  $('btn-disconnect').disabled = phase === 'idle';
  $('btn-flash').disabled = busy || !P.fw || !session.connected || !P.otaChar;
}

const session = new BleSession({
  optionalServices: () => [uuids().service].filter((u) => u !== null),
  hideUnnamed: () => P.hideUnknown,
  onState: () => updateButtons(),
  onDisconnected: () => {
    P.otaChar = null;
    updateButtons();
  },
  onConnected: async (server) => {
    const { service, char } = uuids();
    if (service === null || char === null) throw new Error('Enter valid service and characteristic UUIDs');
    const svc = await server.getPrimaryService(service);
    log.debug('Found OTA service');
    P.otaChar = await svc.getCharacteristic(char);
    log.info('Found OTA write characteristic');
    if (mounted) setStatus(`Connected to ${session.device.name || 'device'}. ${P.fw ? 'Press “Start flashing”.' : 'Choose a firmware file.'}`, { kind: 'ok' });
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

const actions = {
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
};

export const view = {
  needs: 'bluetooth',

  mount() {
    mounted = true;
    const supported = mountView({ page: 'ota', needs: 'bluetooth', actions });
    setVal('iPServ', store.get('otaService') || DEFAULT_SERVICE);
    setVal('iPChar', store.get('otaChar') || DEFAULT_CHAR);
    setChecked('hideUnknown', P.hideUnknown);
    $('hideUnknown').addEventListener('change', () => (P.hideUnknown = getChecked('hideUnknown')));
    bindFileDrop($('fw-drop'), $('file'), loadFile);
    renderFw();
    session.setActive(true);
    P.otaChar = null;
    if (hub.connected) session.connect({ reuse: true }).then(() => updateButtons());
    else setStatus(hub.device ? `Press Reconnect to connect to ${hub.device.name || 'the device'} again, or Connect to pick a device.` : 'Waiting for you to connect a device.');
    updateButtons();
    if (!supported) $('btn-connect').disabled = true;
  },

  unmount() {
    mounted = false;
    session.setActive(false);
  },

  /** Leaving while flashing aborts the transfer (after confirmation). */
  async canLeave() {
    if (!P.ctrl) return true;
    const ok = await confirmDialog('Firmware is being flashed. Leaving this tab aborts the transfer; the device keeps its current firmware.', {
      title: 'Flashing in progress',
      ok: 'Abort and leave',
      cancel: 'Stay',
      danger: true,
    });
    if (!ok) return false;
    if (P.ctrl) {
      P.ctrl.abort();
      await until(() => !P.ctrl, 10000);
    }
    return true;
  },
};
