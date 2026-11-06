// Live data view: merges pvvx's GraphAtc / GraphAtc1 / GraphAtc2 (live chart) and DevPoint
// (dew point, optionally shown on the device LCD). The recorder keeps running while another tab
// is shown (it listens to notifications as its own owner); the chart is rebuilt on return.
import { mountView } from '../site.js';
import { hub } from '../device-hub.js';
import { BleSession } from '../ble-session.js';
import { onNotify, releaseNotify, writeChar } from '../ble.js';
import { log } from '../log.js';
import { $, getVal, setVal, getChecked, setChecked, setStatus, setLive, toast, downloadText } from '../ui.js';
import { ChartGroup } from '../chart.js';
import { parseCustomMeasure, parseEssHumidity, parseEssTemperature, dewPoint, dewPointLcdCommand, liveCsv } from '../measure.js';

const MAX_SAMPLES = 20000;
const L = { rows: [], paused: false, source: null, temp: null, humi: null, vbat: null, ch: null, dirty: false, chart: null, receiving: false };
// Options outlive the view (its controls are recreated whenever the tab is shown).
const O = { source: 'auto', autoReconnect: true, follow: true, showDew: true, dewLcd: false };
let mounted = false;
let timer = null;

const deviceName = () => (hub.device && hub.device.name) || 'the device';

function updateButtons() {
  if (!mounted) return;
  const phase = session.phase;
  $('btn-connect').disabled = phase !== 'idle';
  $('btn-reconnect').disabled = phase !== 'idle' || !hub.device;
  $('btn-disconnect').disabled = phase === 'idle';
  $('dewLcd').disabled = L.source !== 'custom';
  $('btn-pause').textContent = L.paused ? 'Resume' : 'Pause';
}

function showReadings() {
  if (!mounted || L.temp == null) return;
  const dew = L.humi != null && L.humi > 0 ? dewPoint(L.temp, L.humi) : null;
  const parts = [['Temperature', `${L.temp.toFixed(2)} °C`]];
  if (L.humi != null) parts.push(['Humidity', `${L.humi.toFixed(2)} %`]);
  if (dew != null) parts.push(['Dew point', `${dew.toFixed(2)} °C`]);
  if (L.vbat != null) parts.push(['Battery', `${L.vbat} mV`]);
  setLive(parts, L.source === 'custom' ? 'custom firmware' : 'Environmental Sensing');
}

function push() {
  if (L.paused || L.temp == null) return;
  const dew = L.humi != null && L.humi > 0 ? dewPoint(L.temp, L.humi) : null;
  if (!L.receiving) {
    L.receiving = true;
    if (mounted) setStatus(`Receiving measurements from ${deviceName()}.`, { kind: 'ok' });
  }
  L.rows.push([Date.now(), L.temp, L.humi, L.vbat, dew]);
  if (L.rows.length > MAX_SAMPLES) L.rows.shift();
  L.dirty = true;
  showReadings();
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
  if (O.dewLcd && m.humi > 0) {
    writeChar(L.ch, dewPointLcdCommand(dewPoint(m.temp, m.humi), m.humi)).catch((err) => log.debug('LCD write: ' + err));
  }
}

async function connectCustom(server) {
  const svc = await server.getPrimaryService(0x1f10);
  L.ch = await svc.getCharacteristic(0x1f1f);
  log.debug('Characteristic 0x1F1F found');
  onNotify(L.ch, onCustom, 'live');
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
    onNotify(
      hum,
      (v) => {
        L.humi = parseEssHumidity(v);
        if (!temp) push();
      },
      'live',
    );
    await hum.readValue().catch(() => {});
    await hum.startNotifications();
  }
  if (temp) {
    onNotify(
      temp,
      (v) => {
        L.temp = parseEssTemperature(v, tempId);
        push();
      },
      'live',
    );
    await temp.readValue().catch(() => {});
    await temp.startNotifications();
  }
  L.ch = null;
  L.source = 'ess';
}

function stopRecording() {
  releaseNotify('live');
  L.source = null;
  L.ch = null;
  L.receiving = false;
}

const session = new BleSession({
  optionalServices: [0x1f10, 0x181a, 0xfe95],
  autoReconnect: () => O.autoReconnect,
  onState: () => updateButtons(),
  onDisconnected: () => {
    stopRecording();
    updateButtons();
  },
  onConnected: async (server) => {
    const pref = O.source;
    stopRecording();
    if (pref !== 'ess') {
      try {
        await connectCustom(server);
      } catch (err) {
        if (pref === 'custom') throw err;
        log.debug('Custom service not available, using Environmental Sensing: ' + err.message);
      }
    }
    if (!L.source) await connectEss(server);
    if (L.chart) L.chart.setVisible('vbat', L.source === 'custom');
    log.info(`Receiving measurements (${L.source === 'custom' ? 'custom firmware' : 'Environmental Sensing'}).`);
    if (mounted) setStatus(`Connected to ${deviceName()} — waiting for measurements…`, { kind: 'ok' });
    updateButtons();
  },
});

// Another view's setup on the shared connection may change the measurement stream (the
// Flasher / Settings setup asks for 200 measurements only): keep it running while recording.
hub.on('setup-done', (who) => {
  if (who === 'live' || L.source !== 'custom' || !L.ch || !session.connected) return;
  log.debug('Live data: keep the measurement notifications on (0x33,0xff)');
  writeChar(L.ch, new Uint8Array([0x33, 0xff])).catch((err) => log.debug(err));
});

function togglePause() {
  L.paused = !L.paused;
  updateButtons();
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
  const name = (hub.device && hub.device.name) || 'device';
  downloadText(`live-${name.replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, liveCsv(L.rows, ['Temp', 'Humi', 'Vbat', 'DewPoint']), 'text/csv');
}

const actions = {
  connect: () => session.connect(),
  reconnect: () => session.connect({ reuse: true }),
  disconnect: () => session.disconnect(),
  togglePause,
  clearData,
  resetZoom: () => L.chart && L.chart.resetZoom(),
  downloadCsv,
};

const PANELS = [
  { key: 'temp', title: 'Temperature', unit: '°C', decimals: 2, series: [{ label: 'Temperature', color: 1 }, { label: 'Dew point', color: 2 }] },
  { key: 'humi', title: 'Relative humidity', unit: '%', decimals: 2, series: [{ label: 'Humidity', color: 1 }] },
  { key: 'vbat', title: 'Battery voltage', unit: 'V', decimals: 3, series: [{ label: 'Battery', color: 1 }] },
];

export const view = {
  needs: 'bluetooth',
  uplot: true,

  mount() {
    mounted = true;
    const supported = mountView({ page: 'live', needs: 'bluetooth', actions });
    setVal('source', O.source);
    setChecked('autoReconnect', O.autoReconnect);
    setChecked('follow', O.follow);
    setChecked('showDew', O.showDew);
    setChecked('dewLcd', O.dewLcd);
    $('source').addEventListener('change', () => (O.source = getVal('source')));
    $('autoReconnect').addEventListener('change', () => (O.autoReconnect = getChecked('autoReconnect')));
    $('dewLcd').addEventListener('change', () => (O.dewLcd = getChecked('dewLcd')));
    $('follow').addEventListener('change', () => {
      O.follow = getChecked('follow');
      L.chart.setFollow(O.follow);
    });
    $('showDew').addEventListener('change', () => {
      O.showDew = getChecked('showDew');
      L.chart.setVisible('temp:Dew point', O.showDew);
    });
    L.chart = new ChartGroup($('charts'), PANELS, { follow: O.follow, emptyText: 'No measurements yet. Connect a device to start the live chart.' });
    L.chart.setVisible('vbat', L.source === 'custom' || L.rows.some((r) => r[3] != null));
    L.chart.setVisible('temp:Dew point', O.showDew);
    L.dirty = true;
    render();
    timer = setInterval(render, 500);
    session.setActive(true);
    if (session.connected) {
      setStatus(L.receiving ? `Receiving measurements from ${deviceName()}.` : `Connected to ${deviceName()} — waiting for measurements…`, { kind: 'ok' });
      showReadings();
    } else if (hub.connected) {
      session.connect({ reuse: true });
    } else {
      setStatus(hub.device ? `Press Reconnect to connect to ${deviceName()} again, or Connect to pick a device.` : 'Waiting for you to connect a device.');
    }
    updateButtons();
    if (!supported) $('btn-connect').disabled = true;
  },

  unmount() {
    mounted = false;
    clearInterval(timer);
    timer = null;
    if (L.chart) L.chart.destroy();
    L.chart = null;
    session.setActive(false);
  },
};
