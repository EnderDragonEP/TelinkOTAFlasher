// Firmware card: index of downloadable firmware, local/URL loading, preparation
// (validation, signature), and the flashing workflow with progress reporting.
import { S } from './state.js';
import { SOURCES } from './config.js';
import { log } from './log.js';
import { $, html, render, setStatus, setBadge, confirmDialog, alertDialog, toast, bindFileDrop } from './ui.js';
import { hex, formatBytes } from './util.js';
import { validateOtaImage, appendSignature, padTo16, fetchBinary, fetchJson, isValidEntry, resolveFirmwareUrl, firmwareFileName } from './firmware.js';
import { runOta, describeOtaResult, OtaError } from './ota.js';
import { setBusy, showProgress, progressState } from './progress.js';
import { writeChar } from './ble.js';
import { hwName } from './custom.js';

const INFO = {
  custom: { title: 'Custom firmware', desc: 'pvvx custom BLE firmware: configurable advertising (BTHome / ATC / PVVX / Mi), history, triggers.', href: SOURCES.project },
  beta: { title: 'Beta firmware', desc: 'Pre-release build of the custom BLE firmware.', href: SOURCES.project },
  zigbee: {
    title: 'Zigbee firmware',
    desc: 'Converts the device to Zigbee (ZigbeeTLc). Further updates via Zigbee OTA only.',
    href: SOURCES.zigbeeProject,
    warn: 'Zigbee firmware converts the thermometer to the Zigbee protocol! All data for Mi Home and the measurement memory will be erased!',
  },
  zb: {
    title: 'ZB firmware (Zigbee + BLE OTA)',
    desc: 'Zigbee firmware that keeps BLE OTA, for coordinators without Zigbee OTA.',
    href: SOURCES.zigbeeProject + '/blob/master/ZBdevices.md',
    warn:
      "Attention: this is a 'trial' firmware. It was created to test operation with Zigbee while keeping BLE OTA for those whose Zigbee coordinator does not allow Zigbee OTA (relevant for closed gateways of different brands). ZB firmware converts the thermometer to the Zigbee protocol with BLE OTA only! All data for Mi Home and the measurement memory will be erased!",
  },
  original: { title: 'Original firmware', desc: 'Return to the stock manufacturer firmware.', href: SOURCES.project },
  signed: {
    title: 'Original firmware (signed)',
    desc: 'Signed stock firmware for devices locked to version 2.1.1_0159.',
    href: 'https://github.com/pvvx/ATC_MiThermometer/issues/602#issue-2786915630',
  },
};

// ---------------------------------------------------------------------------
// Firmware index

export async function loadIndexes() {
  renderIndexStatus('loading');
  log.debug("Load index file 'firmware.json'...");
  try {
    const x = await fetchJson(resolveFirmwareUrl(SOURCES.index));
    if (!x.version) throw new Error('index has no version');
    S.index.ota = { ...x, loaded: true };
    S.index.error = null;
    log.debug('Firmware index v' + x.version + ' loaded');
    const subs = [];
    if (x.zbjson != null && String(x.zbjson).slice(0, 6) === 'https:') {
      subs.push(
        fetchJson(x.zbjson)
          .then((z) => z.version && (S.index.z = { ...z, loaded: true }))
          .catch((err) => log.debug('Zigbee index:', err)),
      );
    }
    if (x.zbdjson != null && String(x.zbdjson).slice(0, 6) === 'https:') {
      subs.push(
        fetchJson(x.zbdjson)
          .then((z) => z.version && (S.index.zb = { ...z, loaded: true }))
          .catch((err) => log.debug('ZB index:', err)),
      );
    }
    await Promise.all(subs);
  } catch (err) {
    S.index.error = err.message || String(err);
    log.warn('Could not load the firmware index (' + S.index.error + '). You can still flash a local file.');
  }
  renderIndexStatus();
  renderFirmwarePanel();
}

let indexRequest = null;

/** Load the firmware index once per visit of the app; later calls only redraw its state. */
export function ensureIndexes() {
  if (!indexRequest) indexRequest = loadIndexes();
  else if (S.index.ota.loaded || S.index.error) {
    renderIndexStatus();
    renderFirmwarePanel();
  } else renderIndexStatus('loading');
  return indexRequest;
}

function renderIndexStatus(state) {
  const el = $('fw-index');
  if (!el) return;
  if (state === 'loading') {
    el.textContent = 'Loading firmware index…';
    return;
  }
  if (S.index.error) {
    el.innerHTML = '';
    el.append('Firmware index unavailable · ');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.dataset.action = 'reloadIndex';
    b.textContent = 'retry';
    el.append(b);
    return;
  }
  const o = S.index.ota;
  const parts = [`index v${o.version}`];
  if (o.betaver != null) parts.push(`beta v${o.betaver}`);
  if (S.index.z.loaded) parts.push(`Zigbee ${S.index.z.version}`);
  if (S.index.zb.loaded) parts.push(`ZB ${S.index.zb.version}`);
  el.textContent = parts.join(' · ');
}

function firmwareOptions() {
  const hw = S.hwverId;
  const idx = S.index;
  const opts = [];
  if (hw == null || !idx.ota.loaded || !idx.ota.version) return opts;
  const ota = idx.ota;
  const add = (kind, list) => {
    if (list && isValidEntry(list[hw])) opts.push({ kind, file: list[hw], ...INFO[kind] });
  };
  add('custom', ota.custom);
  if (ota.betaver != null) add('beta', ota.betafw);
  if (S.fsignota === '') {
    if (ota.zbjson != null && idx.z.loaded) add('zigbee', idx.z.bin);
    if (ota.zbdjson != null && idx.zb.loaded) add('zb', idx.zb.bin);
    if (!S.cfg.zbdevice) add('original', ota.original);
  } else {
    add('signed', ota.signed);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Rendering (equivalent of the original menuUpgrade())

export function renderFirmwarePanel() {
  const card = $('card-firmware');
  if (!card) return;
  const show = !!S.server && S.otaEnabled && S.phase !== 'idle';
  card.hidden = !show;
  if (!show) return;

  const opts = firmwareOptions();
  render(
    'fw-options',
    opts.length
      ? html`<p class="muted small">Available for <b>${hwName(S.hwverId)}</b>:</p>
        <div class="fw-grid">
          ${opts.map(
            (o) => html`<div class="fw-option${o.warn ? ' fw-warn' : ''}">
              <div>
                <b>${o.title}</b>
                <code>${firmwareFileName(o.file)}</code>
                <small>${o.desc} <a href="${o.href}" target="_blank" rel="noopener">Info ↗</a></small>
              </div>
              <button type="button" class="btn${o.kind === 'custom' ? ' primary' : ''}" data-action="loadIndexed" data-arg="${o.kind}" ${S.fwLoading || S.phase === 'flashing' ? 'disabled' : ''}>Load</button>
            </div>`,
          )}
        </div>`
      : S.hwverId == null
        ? html`<p class="muted small">Recommended firmware appears here once the hardware version is known${S.miConnected ? ' (after activation / login)' : ''}. You can always flash a local file.</p>`
        : html`<p class="muted small">No downloadable firmware listed for this hardware (${hwName(S.hwverId)}). You can flash a local file.</p>`,
  );

  const hint = $('fw-hint');
  if (S.miConnected && !S.isLoggedIn) {
    hint.hidden = false;
    hint.textContent = 'Stock Xiaomi firmware: do the activation (or log in with the token) in the Mi Home panel below before flashing.';
  } else if (S.fsignota) {
    hint.hidden = false;
    hint.textContent = 'This device runs the locked stock firmware 2.1.1_0159: log in with the device token first. Custom firmware will be signed automatically.';
  } else hint.hidden = true;

  renderSelected();
}

function renderSelected() {
  const fw = S.fw;
  const el = $('fw-selected');
  if (!el) return;
  el.hidden = !fw;
  if (!fw) return;
  const type = fw.zigbee ? `Zigbee OTA image (type ${hex(fw.zigbee.imageType, 4)})` : fw.signed ? 'Telink OTA image + signature' : 'Telink OTA image';
  render(
    'fw-meta',
    html`<div class="fw-name"><b>${fw.name}</b></div>
      <div class="fw-facts">
        <span>${formatBytes(fw.data.length)}</span>
        <span>${fw.blockCount} blocks</span>
        <span>${type}</span>
        <span class="ok">CRC OK</span>
      </div>`,
  );
  const flashBtn = $('btn-flash');
  if (flashBtn) flashBtn.disabled = S.phase === 'flashing';
}

// ---------------------------------------------------------------------------
// Loading firmware

async function withLoading(label, fn) {
  if (S.fwLoading) return;
  S.fwLoading = true;
  renderFirmwarePanel();
  setStatus(label, { kind: 'busy' });
  try {
    await fn();
  } catch (err) {
    log.error(err.message || String(err));
    setStatus(err.message || String(err), { kind: 'error' });
  } finally {
    S.fwLoading = false;
    renderFirmwarePanel();
  }
}

export async function loadIndexed(kind) {
  const hw = S.hwverId;
  if (hw == null) return;
  const lists = {
    custom: S.index.ota.custom,
    beta: S.index.ota.betafw,
    zigbee: S.index.z.bin,
    zb: S.index.zb.bin,
    original: S.index.ota.original,
    signed: S.index.ota.signed,
  };
  const fn = lists[kind] && lists[kind][hw];
  if (!isValidEntry(fn)) return;
  const info = INFO[kind];
  if (info.warn) {
    const ok = await confirmDialog(info.warn, { title: info.title, ok: 'Load firmware', danger: true });
    if (!ok) return;
  }
  await withLoading(`Downloading ${firmwareFileName(fn)}…`, async () => {
    log.info(`Load firmware file '${fn}'...`);
    const buf = await fetchBinary(resolveFirmwareUrl(fn));
    await prepareFirmware(buf, firmwareFileName(fn), kind === 'signed' ? 1 : 0);
  });
}

export async function loadLocalFile(file) {
  if (!file) {
    log.info('No file selected');
    return;
  }
  await withLoading(`Reading ${file.name}…`, async () => {
    const buf = await file.arrayBuffer();
    await prepareFirmware(buf, file.name, 0);
  });
}

export async function loadFromUrl(url) {
  url = String(url || '').trim();
  if (!/^https:\/\//i.test(url)) {
    toast('Enter an https:// URL of a .bin or .zigbee file', 'warn');
    return;
  }
  await withLoading('Downloading firmware…', async () => {
    log.info(`Load firmware from '${url}'...`);
    const buf = await fetchBinary(url);
    await prepareFirmware(buf, firmwareFileName(url) || 'firmware.bin', 0);
  });
}

/** Validate, optionally sign, pad and store the firmware (port of getFwArray()). */
async function prepareFirmware(buffer, filename, flg) {
  log.info('File: ' + filename);
  const res = validateOtaImage(buffer, { bigOtaEnabled: S.bigOtaEnabled, fwMaxSize: S.fwMaxSize }, log);
  if (res.status !== 'ok') {
    if (res.status === 'sign') flg = 1;
    else {
      S.fw = null;
      renderSelected();
      log.error(res.status);
      setStatus(res.status, { kind: 'error' });
      await alertDialog(res.status, 'Firmware rejected');
      return;
    }
  }
  let data = res.zigbee ? new Uint8Array(buffer, 0x3e, res.zigbee.size).slice() : new Uint8Array(buffer).slice();
  log.info('File size: ' + data.length + ' bytes');
  let signed = flg === 1;
  if (flg === 0 && S.fsignota !== '') {
    log.info('Add signature file.');
    const sign = await fetchBinary(SOURCES.rawBase + SOURCES.signDir + S.fsignota);
    data = appendSignature(data, sign);
    signed = true;
    log.debug('OTA File size: ' + data.length + ' bytes');
  }
  data = padTo16(data);
  S.fw = { name: filename, data, blockCount: data.length / 16, zigbee: res.zigbee, signed, deviceId: S.device ? S.device.id : null };
  log.info('Count: ' + S.fw.blockCount);
  setStatus(`Firmware ready: ${filename} (${formatBytes(data.length)}). Press “Start flashing”.`, { kind: 'ok' });
  renderFirmwarePanel();
}

export function clearFirmware() {
  S.fw = null;
  const input = $('file');
  if (input) input.value = '';
  renderFirmwarePanel();
}

// ---------------------------------------------------------------------------
// Flashing (startDFU / updateBegin)

export async function startDFU() {
  const fw = S.fw;
  if (!fw) {
    log.info('No file selected');
    return;
  }
  if (S.phase === 'flashing') return;
  log.info('Start DFU');
  if (S.miConnected && !S.isLoggedIn) {
    log.warn('Please do the activation (or login) first!');
    toast('Do the Mi activation / login first', 'warn');
    return;
  }
  const bytes = fw.blockCount * 16;
  let szk = (bytes + 1023) >> 10;
  const needExt = !!fw.zigbee || bytes > S.fwMaxSize;
  const extToOriginal = !needExt && [12, 13, 49].includes(S.hwverId) && S.customEnabled && bytes > 0x1c000;
  if (needExt && !(S.bigOtaEnabled && S.settingsChar)) {
    const s = `OTA size ${szk} KiB (over ${S.fwMaxSize >> 10}k) is not supported! Use custom firmware version 4.6 or higher.`;
    setStatus(s, { kind: 'error' });
    log.error(s);
    return;
  }
  const details = [
    ['Device', S.device ? S.device.name || '(unnamed)' : '?'],
    ['Firmware', fw.name],
    ['Size', `${formatBytes(bytes)} · ${fw.blockCount} blocks`],
  ];
  let msg = 'Keep this page open and the device close to the computer until flashing finishes. The device reboots when done.';
  if (needExt || extToOriginal) msg = 'All data for Mi Home and the measurement memory will be erased!\n' + msg;
  const ok = await confirmDialog(msg, { title: 'Start flashing?', ok: 'Start flashing', details, danger: needExt || extToOriginal });
  if (!ok) return;
  if (needExt || extToOriginal) {
    const s = `Clear Ext.OTA region (${szk} KiB)...`;
    log.info(s);
    setStatus(s, { kind: 'busy' });
    if (needExt && S.cfg.ver <= 0x53 && szk <= 128) szk = 129; // firmware workaround
    await writeChar(S.settingsChar, new Uint8Array([0x73, 0, 0, 4, 0, szk & 0xff, (szk >> 8) & 0xff, (szk >> 16) & 0xff, (szk >> 24) & 0xff]));
    return; // continues in onExtOtaStatus() when the device reports "ready"
  }
  await beginOta();
}

/** Response to command 0x73 (extended OTA region). */
export function onExtOtaStatus(e, faddr, fszk) {
  let s = `OTA region: 0x${hex(faddr, 6)}, size: ${fszk} kbytes`;
  if (e === 0) s = 'Information: Current ' + s;
  else if (e === 1) s += ' -> OTA works';
  else if (e === 2) s += ' -> Ext.OTA busy';
  else if (e === 3) s += ' -> Ext.OTA ready';
  else if (e === 4) s += ' -> Ext.OTA event';
  else if (e > 0x80) s += ' -> Ext.OTA error!';
  else s += ` (${e})`;
  log.debug(s);
  if (!S.bigOtaEnabled) {
    s = 'Error! Ext.OTA is not supported!';
    setStatus(s, { kind: 'error' });
    log.debug(s);
    return;
  }
  if (e === 4) {
    s = `Erase the Flash sector at: 0x${hex(faddr, 6)}...`;
    setStatus(s, { kind: 'busy' });
    log.debug(s);
  } else if (e === 3) {
    s = `Clean Flash OTA region: 0x${hex(faddr, 6)}, size: ${fszk} kbytes. Go OTA...`;
    setStatus(s, { kind: 'busy' });
    log.info(s);
    S.fwMaxSize = (fszk << 10) + 4096;
    if (S.phase !== 'flashing') beginOta();
  } else if (e === 2) {
    s = 'Waiting Start ext.OTA...';
    setStatus(s, { kind: 'busy' });
    log.info(s);
  } else {
    log.info(s);
  }
}

export async function beginOta() {
  const fw = S.fw;
  if (!fw || fw.blockCount <= 0) {
    log.warn('No file selected aborting');
    return;
  }
  if (fw.blockCount * 16 > S.fwMaxSize) {
    await alertDialog('EXT OTA is not supported! Update to a newer custom firmware version (4.6 or higher)!', 'Firmware too large');
    return;
  }
  if (!S.otaChar) {
    log.error('Telink OTA characteristic is not available');
    return;
  }
  const ctrl = new AbortController();
  S.ota = ctrl;
  S.phase = 'flashing';
  setBadge('flashing');
  setBusy(true);
  renderFirmwarePanel();
  showProgress(null);
  progressState('reset');
  setStatus(`Flashing ${fw.name}…`, { kind: 'busy' });
  try {
    const { seconds } = await runOta({
      otaChar: S.otaChar,
      data: fw.data,
      speedChar: S.miEnabled ? S.speedChar : null,
      signal: ctrl.signal,
      onProgress: showProgress,
    });
    const s = describeOtaResult(0, seconds.toFixed(2));
    log.ok(s + '. The device will now reboot.');
    setStatus(s + '. The device reboots with the new firmware.', { kind: 'ok' });
    progressState('done');
    S.justFlashed = true;
    toast('Flashing finished', 'ok', 4000);
  } catch (err) {
    const s = err instanceof OtaError ? err.message : 'Update error: ' + (err.message || err);
    log.error(s);
    setStatus(s, { kind: 'error' });
    progressState('failed');
  } finally {
    S.ota = null;
    setBusy(false);
    if (S.phase === 'flashing') {
      S.phase = S.server && S.device && S.device.gatt.connected ? 'connected' : 'idle';
      setBadge(S.phase);
    }
    renderFirmwarePanel();
  }
}

export async function abortOta() {
  if (!S.ota) return;
  const ok = await confirmDialog('Abort flashing? The device keeps its current firmware and restarts after a timeout.', { title: 'Abort flashing', ok: 'Abort', danger: true });
  if (ok && S.ota) S.ota.abort();
}

// ---------------------------------------------------------------------------
// File input, drag & drop

export function initFirmwareInputs() {
  bindFileDrop($('fw-drop'), $('file'), loadLocalFile);
}
