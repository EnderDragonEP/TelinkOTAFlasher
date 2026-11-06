// Live data page: merges pvvx's GraphAtc / GraphAtc1 / GraphAtc2 (live chart) and DevPoint
// (dew point, optionally shown on the device LCD).
import { initSite } from '../site.js';
import { BleSession } from '../ble-session.js';
import { onNotify, writeChar } from '../ble.js';
import { log } from '../log.js';
import { $, getVal, getChecked, setStatus, setLive, toast, downloadText } from '../ui.js';
import { ChartGroup } from '../chart.js';
import { parseCustomMeasure, parseEssHumidity, parseEssTemperature, dewPoint, dewPointLcdCommand, liveCsv } from '../measure.js';

const MAX_SAMPLES = 20000;
const L = { rows: [], paused: false, source: null, temp: null, humi: null, vbat: null, ch: null, dirty: false, chart: null };

function updateButtons() {
  const phase = session.phase;
  $('btn-connect').disabled = phase !== 'idle';
  $('btn-disconnect').disabled = phase === 'idle';
  $('dewLcd').disabled = L.source !== 'custom';
}

function push() {
  if (L.paused || L.temp == null) return;
  const dew = L.humi != null && L.humi > 0 ? dewPoint(L.temp, L.humi) : null;
  if (!L.receiving) {
    L.receiving = true;
    setStatus(`Receiving measurements from ${(session.device && session.device.name) || 'the device'}.`, { kind: 'ok' });
  }
  L.rows.push([Date.now(), L.temp, L.humi, L.vbat, dew]);
  if (L.rows.length > MAX_SAMPLES) L.rows.shift();
  L.dirty = true;
  const parts = [['Temperature', `${L.temp.toFixed(2)} °C`]];
  if (L.humi != null) parts.push(['Humidity', `${L.humi.toFixed(2)} %`]);
  if (dew != null) parts.push(['Dew point', `${dew.toFixed(2)} °C`]);
  if (L.vbat != null) parts.push(['Battery', `${L.vbat} mV`]);
  setLive(parts, L.source === 'custom' ? 'custom firmware' : 'Environmental Sensing');
}

function render() {
  if (!L.dirty || !L.chart) return;
  L.dirty = false;
  const r = L.rows;
  L.chart.setData(
    r.map((x) => x[0] / 1000),
    {
      temp: [r.map((x) => x[1]), r.map((x) => x[4])],
      humi: [r.map((x) => x[2])],
      vbat: [r.map((x) => (x[3] == null ? null : x[3] / 1000))],
    },
  );
  $('sample-count').textContent = String(r.length);
}

function onCustom(value) {
  const m = parseCustomMeasure(value);
  if (!m) return;
  L.vbat = m.vbat;
  L.temp = m.temp;
  L.humi = m.humi;
  log.debug(`Vbat: ${m.vbat} mV, Temp: ${m.temp}°C, Humi: ${m.humi}%, Count: ${m.count}`);
  push();
  if (getChecked('dewLcd') && m.humi > 0) {
    writeChar(L.ch, dewPointLcdCommand(dewPoint(m.temp, m.humi), m.humi)).catch((err) => log.debug('LCD write: ' + err));
  }
}

async function connectCustom(server) {
  const svc = await server.getPrimaryService(0x1f10);
  L.ch = await svc.getCharacteristic(0x1f1f);
  log.debug('Characteristic 0x1F1F found');
  onNotify(L.ch, onCustom);
  await L.ch.startNotifications();
  log.debug('Send command tx-measures on (0x33,0xff)...');
  await writeChar(L.ch, new Uint8Array([0x33, 0xff]));
  L.source = 'custom';
}

async function connectEss(server) {
  const svc = await server.getPrimaryService(0x181a);
  let hum = null;
  let temp = null;
  let tempId = 0x2a6e;
  try {
    hum = await svc.getCharacteristic(0x2a6f);
  } catch {
    log.debug('No Humidity (0x2A6F) characteristic');
  }
  for (const id of [0x2a6e, 0x2a1f]) {
    try {
      temp = await svc.getCharacteristic(id);
      tempId = id;
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!temp && !hum) throw new Error('No temperature or humidity characteristic in the Environmental Sensing service');
  if (hum) {
    onNotify(hum, (v) => {
      L.humi = parseEssHumidity(v);
      if (!temp) push();
    });
    await hum.readValue().catch(() => {});
    await hum.startNotifications();
  }
  if (temp) {
    onNotify(temp, (v) => {
      L.temp = parseEssTemperature(v, tempId);
      push();
    });
    await temp.readValue().catch(() => {});
    await temp.startNotifications();
  }
  L.ch = null;
  L.source = 'ess';
}

const session = new BleSession({
  optionalServices: [0x1f10, 0x181a, 0xfe95],
  autoReconnect: () => getChecked('autoReconnect'),
  onState: () => updateButtons(),
  onDisconnected: () => updateButtons(),
  onConnected: async (server) => {
    const pref = getVal('source');
    L.source = null;
    L.receiving = false;
    if (pref !== 'ess') {
      try {
        await connectCustom(server);
      } catch (err) {
        if (pref === 'custom') throw err;
        log.debug('Custom service not available, using Environmental Sensing: ' + err.message);
      }
    }
    if (!L.source) await connectEss(server);
    L.chart.setVisible('vbat', L.source === 'custom');
    log.info(`Receiving measurements (${L.source === 'custom' ? 'custom firmware' : 'Environmental Sensing'}).`);
    setStatus(`Connected to ${session.device.name || 'device'} — waiting for measurements…`, { kind: 'ok' });
    updateButtons();
  },
});

function togglePause() {
  L.paused = !L.paused;
  $('btn-pause').textContent = L.paused ? 'Resume' : 'Pause';
  toast(L.paused ? 'Recording paused' : 'Recording resumed');
}

function clearData() {
  L.rows = [];
  L.dirty = true;
  L.chart.resetZoom();
  render();
}

function downloadCsv() {
  if (!L.rows.length) {
    toast('No data yet', 'warn');
    return;
  }
  const name = (session.device && session.device.name) || 'device';
  downloadText(`live-${name.replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, liveCsv(L.rows, ['Temp', 'Humi', 'Vbat', 'DewPoint']), 'text/csv');
}

const supported = initSite({
  page: 'live',
  needs: 'bluetooth',
  actions: {
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),
    togglePause,
    clearData,
    resetZoom: () => L.chart.resetZoom(),
    downloadCsv,
  },
});

L.chart = new ChartGroup($('charts'), [
  { key: 'temp', title: 'Temperature', unit: '°C', decimals: 2, series: [{ label: 'Temperature', color: 1 }, { label: 'Dew point', color: 2 }] },
  { key: 'humi', title: 'Relative humidity', unit: '%', decimals: 2, series: [{ label: 'Humidity', color: 1 }] },
  { key: 'vbat', title: 'Battery voltage', unit: 'V', decimals: 3, series: [{ label: 'Battery', color: 1 }] },
], { emptyText: 'No measurements yet. Connect a device to start the live chart.' });
L.chart.setVisible('vbat', false);
$('follow').addEventListener('change', () => L.chart.setFollow($('follow').checked));
$('showDew').addEventListener('change', () => L.chart.setVisible('temp:Dew point', $('showDew').checked));
setInterval(render, 500);
updateButtons();
if (!supported) $('btn-connect').disabled = true;
setStatus('Waiting for you to connect a device.');
