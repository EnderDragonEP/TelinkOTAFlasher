// History page: merges pvvx's GraphMemo (custom firmware, command 0x35) and
// GraphMemoOriginal (stock LYWSD03MMC hourly log on the Mi service).
import { initSite } from '../site.js';
import { BleSession } from '../ble-session.js';
import { UUID, onNotify, writeChar } from '../ble.js';
import { log } from '../log.js';
import { $, html, render, getVal, getChecked, setStatus, toast, downloadText } from '../ui.js';
import { hex, dump, le32 } from '../util.js';
import { ChartGroup } from '../chart.js';
import { showProgress, progressState } from '../progress.js';
import { parseMemoRecord, parseStockRecord, plausibleTime, memoCsv, stockCsv, stats, localDateTime } from '../measure.js';

const MAX_MEMORES = 65535;
const MI = {
  count: 'ebe0ccb9-7a0a-4b0c-8a1a-6ff2997da3a6',
  index: 'ebe0ccba-7a0a-4b0c-8a1a-6ff2997da3a6',
  data: 'ebe0ccbc-7a0a-4b0c-8a1a-6ff2997da3a6',
  time: UUID.MI_CLOCK_CHAR,
};

const H = { kind: null, records: [], requested: 0, end: 0, t0: 0, ch: null, accept: false, startTime: 0, chart: null, chartKind: null, dirty: false, finished: false };

function updateButtons() {
  $('btn-connect').disabled = session.phase !== 'idle';
  $('btn-disconnect').disabled = session.phase === 'idle';
}

function requestedCount() {
  let n = parseInt(getVal('LoadSamples'), 10);
  if (Number.isNaN(n) || n > MAX_MEMORES) n = MAX_MEMORES;
  else if (n < 5) n = 5;
  return n;
}

function progress() {
  const n = H.records.length;
  const elapsed = (performance.now() - H.t0) / 1000;
  if (H.kind === 'custom') {
    const all = H.requested >= MAX_MEMORES;
    showProgress({ done: n, total: all ? Math.max(n, 1) : H.requested, elapsed, unit: 'records', known: !all, text: all ? `${n} records` : undefined });
  } else {
    showProgress({ done: n, total: Math.max(H.end, 1), elapsed, unit: 'records' });
  }
  H.dirty = true;
}

// ---------------------------------------------------------------------------
// Custom firmware (0x1F10 / 0x1F1F)

function finishCustom() {
  log.info(`Read count: ${H.records.length}, read time: ${((performance.now() - H.t0) / 1000).toFixed(3)} sec`);
  H.finished = true;
  progressState('done');
  H.dirty = true;
  if (getChecked('setDevTime')) {
    const time = Math.floor(Date.now() / 1000 - new Date().getTimezoneOffset() * 60);
    const blk = new Uint8Array([0x23, ...le32(time)]);
    log.debug(`Send cmd Set DevTime (${dump(blk)})...`);
    writeChar(H.ch, blk).then(
      () => log.info('Device clock set.'),
      (err) => {
        log.error('Set time failed: ' + err);
        session.disconnect();
      },
    );
  } else {
    session.disconnect();
  }
  setStatus(`Read ${H.records.length} records.`, { kind: 'ok' });
}

function onCustomNotify(value) {
  const len = value.byteLength;
  if (!len) return;
  const blkid = value.getUint8(0);
  if (blkid === 0x35) {
    if (len >= 13) {
      H.records.push(parseMemoRecord(value));
      progress();
    } else if (len >= 3) {
      finishCustom();
    }
  } else if (blkid === 0x23 && len >= 4) {
    const t = value.getUint32(1, true);
    log.debug('Device Time: 0x' + hex(t, 8));
    session.disconnect();
  } else if (blkid === 0x55) {
    if (len >= 12) {
      H.records = [];
      H.requested = requestedCount();
      log.info(H.requested === MAX_MEMORES ? 'Send command "get-memo all samples"...' : `Send command "get-memo ${H.requested} samples"...`);
      H.t0 = performance.now();
      progressState('reset');
      progress();
      writeChar(H.ch, new Uint8Array([0x35, H.requested & 0xff, (H.requested >> 8) & 0xff, 0, 0])).catch((err) => {
        log.error(err);
        session.disconnect();
      });
    } else {
      log.error('Error device config!');
      session.disconnect();
    }
  } else {
    log.debug('msg: ' + dump(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
  }
}

async function readCustom(server, ses) {
  const svc = await server.getPrimaryService(0x1f10);
  H.ch = await svc.getCharacteristic(0x1f1f);
  onNotify(H.ch, onCustomNotify);
  await H.ch.startNotifications();
  H.kind = 'custom';
  setStatus('Connected (custom firmware). Reading the configuration…', { kind: 'busy' });
  log.info('Get device config...');
  setTimeout(() => {
    if (!ses.alive()) return;
    log.debug('Send command "get config"...');
    writeChar(H.ch, new Uint8Array([0x55])).catch((err) => {
      log.error(err);
      session.disconnect();
    });
  }, 1500);
}

// ---------------------------------------------------------------------------
// Stock Xiaomi LYWSD03MMC (Mi service)

function onStockRecord(value) {
  if (!H.accept) return;
  const r = parseStockRecord(value);
  if (!r) return;
  r.ms = H.startTime + r.time * 1000;
  H.records.push(r);
  log.debug(`Index: ${r.index}, DevTime: ${r.time}, Temp: ${r.temp.toFixed(2)}, Humi: ${r.humi.toFixed(2)}%`);
  progress();
  if (r.index >= H.end) {
    log.info('Count: ' + r.index);
    H.finished = true;
    progressState('done');
    setStatus(`Read ${H.records.length} hourly records.`, { kind: 'ok' });
    session.disconnect();
  }
}

async function readStock(server) {
  const svc = await server.getPrimaryService(UUID.MI_MAIN_SERVICE);
  H.kind = 'stock';
  const countCh = await svc.getCharacteristic(MI.count);
  const cv = await countCh.readValue();
  if (cv.byteLength < 8) throw new Error('Unexpected data count format');
  H.end = cv.getUint32(0, true);
  log.info(`Data Count: ${H.end}:${cv.getUint32(4, true)}`);
  if (H.end <= 0) {
    setStatus('The device has no stored records yet.', { kind: 'warn' });
    session.disconnect();
    return;
  }
  const dataCh = await svc.getCharacteristic(MI.data);
  const indexCh = await svc.getCharacteristic(MI.index);
  H.records = [];
  H.accept = false;
  onNotify(dataCh, onStockRecord);
  await dataCh.startNotifications();
  const timeCh = await svc.getCharacteristic(MI.time);
  const tv = await timeCh.readValue();
  if (tv.byteLength >= 4) {
    const timeDev = tv.getUint32(0, true);
    H.startTime = Date.now() - timeDev * 1000;
    log.debug('Time device: ' + timeDev);
  }
  H.t0 = performance.now();
  progressState('reset');
  progress();
  setStatus('Reading the stock firmware history…', { kind: 'busy' });
  log.debug('Send start index 0...');
  await indexCh.writeValue(new Uint8Array([0, 0, 0, 0]));
  H.accept = true;
}

// ---------------------------------------------------------------------------

const session = new BleSession({
  optionalServices: [0x1f10, UUID.MI_MAIN_SERVICE, 0xfe95],
  onState: () => updateButtons(),
  onDisconnected: () => {
    H.accept = false;
    if (!H.finished && H.records.length) {
      setStatus(`Stopped after ${H.records.length} records.`, { kind: 'warn' });
      progressState('failed');
    }
    H.dirty = true;
    updateButtons();
  },
  onConnected: async (server, ses) => {
    H.finished = false;
    H.kind = null;
    const services = (await server.getPrimaryServices()).map((s) => s.uuid);
    if (services.includes(UUID.CUSTOM_SERVICE)) await readCustom(server, ses);
    else if (services.includes(UUID.MI_MAIN_SERVICE)) await readStock(server);
    else throw new Error('This device has neither the custom firmware command service nor the Mi history service.');
  },
});

// ---------------------------------------------------------------------------
// Chart, statistics, CSV

function ensureChart(kind) {
  if (H.chartKind === kind) return;
  if (H.chart) H.chart.destroy();
  H.chartKind = kind;
  const panels =
    kind === 'stock'
      ? [
          { key: 'temp', title: 'Temperature (hourly)', unit: '°C', decimals: 1, band: [1, 2], series: [{ label: 'Average', color: 1 }, { label: 'Maximum', color: 'faint', width: 1 }, { label: 'Minimum', color: 'faint', width: 1 }] },
          { key: 'humi', title: 'Relative humidity (hourly)', unit: '%', decimals: 1, band: [1, 2], series: [{ label: 'Average', color: 1 }, { label: 'Maximum', color: 'faint', width: 1 }, { label: 'Minimum', color: 'faint', width: 1 }] },
        ]
      : [
          { key: 'temp', title: 'Temperature', unit: '°C', decimals: 2, series: [{ label: 'Temperature', color: 1 }] },
          { key: 'humi', title: 'Relative humidity', unit: '%', decimals: 2, series: [{ label: 'Humidity', color: 1 }] },
          { key: 'vbat', title: 'Battery voltage', unit: 'V', decimals: 3, series: [{ label: 'Battery', color: 1 }] },
        ];
  H.chart = new ChartGroup($('charts'), panels, { follow: false, emptyText: 'No records read yet.' });
}

function visibleRecords() {
  const hide = getChecked('hideLoDate');
  if (H.kind === 'stock') return [...H.records].sort((a, b) => a.ms - b.ms);
  const tz = new Date().getTimezoneOffset() * 60; // device clock is local time
  return H.records
    .filter((r) => !hide || plausibleTime(r.time))
    .map((r) => ({ ...r, x: r.time + tz }))
    .sort((a, b) => a.x - b.x);
}

function renderStats(rows) {
  if (!rows.length) {
    render('stats', '');
    return;
  }
  const f = (s, d, unit) => (s.n ? html`<td>${s.min.toFixed(d)} ${unit}</td><td>${s.avg.toFixed(d)} ${unit}</td><td>${s.max.toFixed(d)} ${unit}</td>` : html`<td colspan="3">–</td>`);
  const first = H.kind === 'stock' ? rows[0].ms : rows[0].x * 1000;
  const last = H.kind === 'stock' ? rows[rows.length - 1].ms : rows[rows.length - 1].x * 1000;
  const lines =
    H.kind === 'stock'
      ? [
          ['Temperature', { min: stats(rows.map((r) => r.tempLo)).min, avg: stats(rows.map((r) => r.temp)).avg, max: stats(rows.map((r) => r.tempHi)).max, n: rows.length }, 1, '°C'],
          ['Humidity', { min: stats(rows.map((r) => r.humiLo)).min, avg: stats(rows.map((r) => r.humi)).avg, max: stats(rows.map((r) => r.humiHi)).max, n: rows.length }, 1, '%'],
        ]
      : [
          ['Temperature', stats(rows.map((r) => r.temp)), 2, '°C'],
          ['Humidity', stats(rows.map((r) => r.humi)), 2, '%'],
          ['Battery', stats(rows.map((r) => r.vbat / 1000)), 3, 'V'],
        ];
  render(
    'stats',
    html`<p class="muted small">${rows.length} records · ${localDateTime(first)} → ${localDateTime(last)}</p>
      <table class="stats-table">
        <thead><tr><th scope="col">Measure</th><th scope="col">Minimum</th><th scope="col">Average</th><th scope="col">Maximum</th></tr></thead>
        <tbody>${lines.map(([name, s, d, unit]) => html`<tr><th scope="row">${name}</th>${f(s, d, unit)}</tr>`)}</tbody>
      </table>`,
  );
}

function redraw() {
  if (!H.dirty || !H.kind) return;
  H.dirty = false;
  ensureChart(H.kind);
  const rows = visibleRecords();
  $('sample-count').textContent = String(rows.length);
  if (H.kind === 'stock') {
    H.chart.setData(
      rows.map((r) => r.ms / 1000),
      { temp: [rows.map((r) => r.temp), rows.map((r) => r.tempHi), rows.map((r) => r.tempLo)], humi: [rows.map((r) => r.humi), rows.map((r) => r.humiHi), rows.map((r) => r.humiLo)] },
    );
  } else {
    H.chart.setData(
      rows.map((r) => r.x),
      { temp: [rows.map((r) => r.temp)], humi: [rows.map((r) => r.humi)], vbat: [rows.map((r) => r.vbat / 1000)] },
    );
  }
  if (H.finished || session.phase === 'idle') renderStats(rows);
}

function downloadCsv() {
  if (!H.records.length) {
    toast('No records yet', 'warn');
    return;
  }
  const name = (session.device && session.device.name) || 'device';
  const file = `history-${name.replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
  if (H.kind === 'stock') downloadText(file, stockCsv([...H.records].sort((a, b) => a.ms - b.ms)), 'text/csv');
  else downloadText(file, memoCsv(name, H.records), 'text/csv');
}

const supported = initSite({
  page: 'history',
  needs: 'bluetooth',
  actions: {
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),
    resetZoom: () => H.chart && H.chart.resetZoom(),
    downloadCsv,
  },
});
$('hideLoDate').addEventListener('change', () => {
  H.dirty = true;
  redraw();
});
$('LoadSamples').addEventListener('change', () => {
  if (getVal('LoadSamples').trim() === '') return;
  $('LoadSamples').value = String(Math.max(3, Math.min(MAX_MEMORES, parseInt(getVal('LoadSamples'), 10) || MAX_MEMORES)));
});
setInterval(redraw, 400);
render('charts', html`<p class="chart-empty">No records read yet. Press “Connect &amp; read”.</p>`);
updateButtons();
if (!supported) $('btn-connect').disabled = true;
setStatus('Waiting for you to connect a device.');
