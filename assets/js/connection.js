// Connection lifecycle: device chooser, service discovery, routing to the right
// firmware handler, retries and disconnect handling (port of connect()/doConnect()).
import { S, resetConnectionState, resetServiceFlags, MAX_BLE_OTA_SIZE, MAX_EXT_OTA_SIZE } from './state.js';
import { UUID, OPTIONAL_SERVICES, webBluetoothSupport, isUserCancel } from './ble.js';
import { log, logLink } from './log.js';
import { $, html, render, setStatus, setLive, setBadge, setHidden, onStatus, setPageHint } from './ui.js';
import { sleep, formatMac } from './util.js';
import { describeServiceData } from './advertising.js';
import { SOURCES } from './config.js';
import { MI_PANELS, miAction, miAuthorization } from './mi.js';
import { customAction, zbdeviceAction, getTestCharacteristic, hwName } from './custom.js';
import { renderCommandPanel } from './settings.js';
import { cgpr1Action, cgdk2Action, cgg1Action } from './qingping.js';
import { renderFirmwarePanel } from './flasher.js';

const MAX_RETRIES = 5;
let fwType = '';

// ---------------------------------------------------------------------------
// UI state

export function updateButtons() {
  const flashing = S.phase === 'flashing';
  $('btn-connect').disabled = flashing;
  $('btn-disconnect').disabled = S.phase === 'idle';
  $('btn-reconnect').disabled = !S.device || flashing;
}

function clean(s) {
  return s == null ? '' : String(s).replace(/\0+$/, '').trim();
}

export function renderDeviceInfo() {
  const box = $('device-info');
  if (!box) return;
  if (!S.device) {
    box.hidden = true;
    return;
  }
  const rows = [['Name', S.device.name || '(unnamed)']];
  if (S.advMac) rows.push(['MAC', formatMac(S.advMac)]);
  if (S.hwverId != null) rows.push(['Hardware', hwName(S.hwverId)]);
  if (fwType) rows.push(['Firmware', fwType]);
  if (S.cfg.ver && (S.customEnabled || S.cfg.zbdevice)) rows.push(['Version', `${S.cfg.ver >> 4}.${S.cfg.ver & 0x0f}`]);
  if (S.devinfo.hrstr) rows.push(['HW revision', clean(S.devinfo.hrstr)]);
  if (S.devinfo.frstr) rows.push(['FW revision', clean(S.devinfo.frstr)]);
  if (S.devinfo.srstr) rows.push(['SW revision', clean(S.devinfo.srstr)]);
  render(box, html`${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}`);
  box.hidden = false;
}

onStatus(() => renderDeviceInfo());

function setPhase(phase) {
  S.phase = phase;
  setBadge(phase);
  updateButtons();
}

function clearDeviceUi() {
  render('custcfg', '');
  setPageHint(null);
  setLive(null);
  setHidden('miclock', true);
  updateButtons();
}

// ---------------------------------------------------------------------------
// Connect

export async function connect() {
  const support = webBluetoothSupport();
  if (!support.ok) {
    setStatus(support.reason === 'insecure' ? 'Web Bluetooth needs HTTPS (or localhost).' : 'This browser does not support Web Bluetooth. Use Chrome, Edge or Opera.', { kind: 'error' });
    return;
  }
  const options = { optionalServices: OPTIONAL_SERVICES, acceptAllDevices: true };
  const prefixes = $('namePrefix')
    .value.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (prefixes.length) {
    options.acceptAllDevices = false;
    options.filters = prefixes.map((namePrefix) => ({ namePrefix }));
  }
  log.debug('requestDevice', options);
  log.info('Searching for devices');
  let device;
  try {
    device = await navigator.bluetooth.requestDevice(options);
  } catch (err) {
    if (isUserCancel(err)) log.info('Device selection cancelled.');
    else log.error(err);
    return;
  }
  // Leave the previous device only once a new one was picked.
  if (S.device && S.device !== device) {
    S.retrying = true;
    S.session++;
    try {
      S.device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    S.retrying = false;
  }
  if (S.fw && S.fw.deviceId && S.fw.deviceId !== device.id) S.fw = null;
  if (S.device !== device) S.advMac = null;
  S.device = device;
  if (!device.__flasherListener) {
    device.addEventListener('gattserverdisconnected', onDisconnected);
    device.__flasherListener = true;
  }
  S.connectTrys = 0;
  S.noRetry = false;
  log.info('Connecting to: ' + (device.name || device.id));
  setStatus(`Connecting to ${device.name || 'device'}…`, { kind: 'busy' });
  if ($('advmac').checked) catchAdvertisement(device);
  else doConnect();
}

/** Read the advertisement once (needs Chrome's experimental web platform features) to learn the MAC. */
function catchAdvertisement(device) {
  if (typeof device.watchAdvertisements !== 'function') {
    log.warn('Reading advertisements needs chrome://flags/#enable-experimental-web-platform-features - connecting without it.');
    doConnect();
    return;
  }
  log.info('Get Advertising MAC (Web Experimental Features!)');
  setPhase('connecting');
  const ac = new AbortController();
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ac.abort();
    doConnect();
  };
  timer = setTimeout(() => {
    log.warn('No advertisement received within 10 s - connecting anyway.');
    finish();
  }, 10000);
  device.addEventListener(
    'advertisementreceived',
    (event) => {
      log.debug(`Received advertisement from "${device.name}"`);
      event.serviceData.forEach((dv, uuid) => {
        const r = describeServiceData(uuid, dv);
        if (r.mac) S.advMac = r.mac;
        log.info(r.text);
      });
      if (S.advMac) log.info('MAC: ' + formatMac(S.advMac));
      finish();
    },
    { once: true },
  );
  log.debug(`Catching advertisement from "${device.name}"...`);
  device.watchAdvertisements({ signal: ac.signal }).catch((err) => {
    log.debug('watchAdvertisements: ' + err);
    finish();
  });
}

export async function doConnect() {
  const dev = S.device;
  if (!dev) return;
  const sid = ++S.session;
  S.retrying = false;
  S.userDisconnect = false;
  resetConnectionState();
  resetServiceFlags();
  S.fsignota = '';
  fwType = '';
  clearDeviceUi();
  setPhase('connecting');
  renderDeviceInfo();
  try {
    await setup(sid);
    if (sid !== S.session) return;
    if (S.phase === 'connecting') setPhase('connected');
    renderDeviceInfo();
    renderFirmwarePanel();
    updateButtons();
  } catch (err) {
    if (sid !== S.session) return;
    await handleError(err, sid);
  }
}

async function handleError(err, sid) {
  if (S.retrying || S.userDisconnect || sid !== S.session) return;
  log.error(err && err.message ? `${err.name ? err.name + ': ' : ''}${err.message}` : String(err));
  if (S.noRetry) {
    disconnect();
    return;
  }
  if (S.connectTrys < MAX_RETRIES) {
    S.connectTrys++;
    log.warn(`Reconnect ${S.connectTrys} of ${MAX_RETRIES}`);
    setStatus(`Connection problem, retrying (${S.connectTrys}/${MAX_RETRIES})…`, { kind: 'busy' });
    S.retrying = true;
    try {
      if (S.device.gatt.connected) S.device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    await sleep(600);
    if (!S.retrying || sid !== S.session) return; // user acted meanwhile
    doConnect();
  } else {
    log.error('Something went wrong, too many reconnects.');
    setStatus('Could not set up the connection. Move the device closer and try again.', { kind: 'error' });
    S.connectTrys = 0;
    disconnect();
  }
}

// ---------------------------------------------------------------------------
// Device detection (equivalent of the body of the original doConnect())

async function getDevVersion() {
  S.devinfo = { hrstr: null, srstr: null, frstr: null, flg: 0 };
  if (!S.devInfEnabled) return;
  let svc;
  try {
    svc = await S.server.getPrimaryService(0x180a);
    log.debug('Found Device Information Service');
  } catch (err) {
    log.debug(err);
    return;
  }
  const read = async (uuid, flag) => {
    try {
      const ch = await svc.getCharacteristic(uuid);
      const v = new TextDecoder('utf-8').decode(await ch.readValue());
      S.devinfo.flg |= flag;
      return v;
    } catch (err) {
      log.debug(err);
      return null;
    }
  };
  S.devinfo.frstr = await read(0x2a26, 1);
  S.devinfo.hrstr = await read(0x2a27, 2);
  S.devinfo.srstr = await read(0x2a28, 4);
  if (S.devinfo.hrstr) log.info('Hardware Revision String: ' + S.devinfo.hrstr);
  if (S.devinfo.srstr) log.info('Software Revision String: ' + S.devinfo.srstr);
  if (S.devinfo.frstr) log.info('Firmware Revision String: ' + S.devinfo.frstr);
}

async function setup(sid) {
  const dev = S.device;
  const server = await dev.gatt.connect();
  if (sid !== S.session) return;
  log.debug('Found GATT server');
  S.server = server;
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    const u = svc.uuid;
    log.debug('Services: ' + u);
    if (u === UUID.OTA_SERVICE) S.otaEnabled = true;
    else if (u === UUID.CUSTOM_SERVICE) S.customEnabled = true;
    else if (u === UUID.QINGPING_SERVICE) S.qingpingEnabled = true;
    else if (u === UUID.MI_MAIN_SERVICE) S.miEnabled = true;
    else if (u === UUID.ENV_SENSING) S.devIdEnabled = true;
    else if (u === UUID.TEST_SERVICE) S.devTest = true;
    else if (u === UUID.BTHOME) S.bthomeEnabled = true;
    else if (u === UUID.DEVICE_INFO) S.devInfEnabled = true;
  }
  const name = dev.name || '';
  const fr = () => S.devinfo.frstr || '';

  if (S.page === 'settings') {
    await setupSettings(sid);
    return;
  }

  if (!S.otaEnabled) {
    log.warn('Not found Telink OTA service!');
    S.noRetry = true; // like the original: no automatic reconnects for these devices
    await getDevVersion();
    if (S.bthomeEnabled) {
      fwType = 'THB (PHY62x2 BTHome)';
      log.info('Detected THB device');
      setStatus('Detected a THB device (PHY62x2). Use the dedicated flasher:', { kind: 'warn', link: { text: 'PHY62x2BTHome', href: SOURCES.thbFlasher } });
      log.info('GitHub:', logLink('THB2', SOURCES.thbProject), 'or use:', logLink('PHY62x2BTHome', SOURCES.thbFlasher));
    } else if (S.miEnabled) {
      fwType = 'Stock Xiaomi (no Telink OTA)';
      log.info('Detected Mi device, no Telink OTA service');
      setStatus('Detected Mi device, no Telink OTA service', { kind: 'warn' });
      if (name.substr(0, 10) === 'LYWSD02MMC') {
        S.hwverId = 49;
        MI_PANELS.standard();
        await miAction();
      }
    } else {
      setStatus('Connected, but the device has no Telink OTA service.', { kind: 'warn' });
    }
    return;
  }

  const otaService = await server.getPrimaryService(UUID.OTA_SERVICE);
  log.debug('Found Telink OTA service');
  S.otaChar = await otaService.getCharacteristic(UUID.OTA_CHAR);
  log.debug('Found Telink OTA write characteristic');
  await getDevVersion();
  if (sid !== S.session) return;

  if (S.miEnabled) {
    fwType = 'Stock Xiaomi';
    log.info('Detected Mi device');
    setStatus('Detected Mi device', { kind: 'ok' });
    if (name.substr(0, 10) === 'LYWSD02MMC') {
      S.hwverId = 49;
      S.fwMaxSize = MAX_BLE_OTA_SIZE;
    } else if (name.substr(0, 10) === 'MJWSD05MMC') {
      S.fwMaxSize = MAX_EXT_OTA_SIZE;
    }
    if (name.substr(0, 10) === 'MJWSD07MMC') {
      MI_PANELS.mjwsd07();
      S.fwMaxSize = MAX_EXT_OTA_SIZE;
      S.hwverId = 62;
    } else if (name.substr(0, 10) === 'LYWSD03MMC' && fr().substr(0, 10) === '2.1.1_0159') {
      MI_PANELS.lywsd03Locked();
      S.fwMaxSize = MAX_BLE_OTA_SIZE;
      S.fsignota = 'sign_2.1.1_0159c.bin';
    } else if (name.substr(0, 10) === 'MJWSD06MMC' && fr().substr(0, 4) === '0009') {
      MI_PANELS.mjwsd06Locked();
      S.fwMaxSize = MAX_EXT_OTA_SIZE;
      S.hwverId = 13;
    } else {
      MI_PANELS.standard();
    }
    updateButtons();
    await miAction();
  } else if (S.bthomeEnabled || S.customEnabled) {
    await setupCustom();
  } else if (S.qingpingEnabled) {
    fwType = 'Stock Qingping';
    if (name.substr(0, 15) === 'Qingping Motion') await cgpr1Action();
    else if (name.substr(0, 21) === 'Qingping Temp RH Lite' || name.substr(0, 23) === 'Qingping Temp & RH Lite' || name.substr(0, 20) === 'Qingping Alarm Clock') await cgdk2Action();
    else if (name.substr(0, 20) === 'Qingping Temp & RH M') await cgg1Action('2020-2021');
    else if (name.substr(0, 18) === 'Qingping Temp RH M') await cgg1Action('2022');
    else {
      log.warn('Unknown Qingping Firmware');
      setStatus('Unknown Qingping firmware', { kind: 'warn' });
    }
  } else {
    fwType = 'Unknown (Mi auth assumed)';
    setStatus('Connected.', { kind: 'ok' });
    S.miEnabled = true;
    MI_PANELS.unknown();
    updateButtons();
    await miAuthorization();
  }
  updateButtons();
}

/** ZigbeeTLc (BLE mode), test or custom firmware: open the command channel (both pages). */
async function setupCustom() {
  if (S.bthomeEnabled) {
    fwType = 'ZigbeeTLc (BLE mode)';
    setStatus('Detected ZBdevice', { kind: 'ok' });
    log.info('Detected ZBdevice');
    renderCommandPanel({ getCmd: '57', title: 'Zigbee device (BLE mode)', note: 'Reading the configuration…' });
    updateButtons();
    await zbdeviceAction();
  } else if (S.devTest) {
    fwType = 'Test firmware';
    log.info('Detected Test device');
    setStatus('Detected Test device', { kind: 'warn' });
    renderCommandPanel({ title: 'Test firmware', link: { text: 'Generic OTA ↗', href: 'ota.html' } });
    updateButtons();
    await getTestCharacteristic();
  } else {
    fwType = S.devIdEnabled ? 'pvvx custom' : 'ATC1441 custom';
    log.info('Detected custom Firmware');
    setStatus('Detected custom firmware', { kind: 'ok' });
    renderCommandPanel({ note: 'Reading the configuration…' });
    updateButtons();
    await customAction();
  }
}

/**
 * Settings page (settings.html): classify the device exactly like the flasher does, but only
 * open the command channel of configurable firmware; everything else is pointed to the flasher.
 */
async function setupSettings(sid) {
  const configurable = S.otaEnabled && !S.miEnabled && (S.bthomeEnabled || S.customEnabled);
  if (!S.otaEnabled) S.noRetry = true;
  await getDevVersion();
  if (sid !== S.session) return;
  if (configurable) {
    await setupCustom();
  } else if (!S.otaEnabled && S.bthomeEnabled) {
    fwType = 'THB (PHY62x2 BTHome)';
    log.info('Detected THB device');
    setStatus('Detected a THB device (PHY62x2). Use the dedicated flasher:', { kind: 'warn', link: { text: 'PHY62x2BTHome', href: SOURCES.thbFlasher } });
  } else {
    fwType = S.miEnabled ? 'Stock Xiaomi' : S.qingpingEnabled ? 'Stock Qingping' : 'Unknown';
    const what = S.miEnabled ? 'the stock Xiaomi firmware' : S.qingpingEnabled ? 'the stock Qingping firmware' : 'a firmware without the custom command service';
    log.info(`No custom firmware settings on this device (${fwType}).`);
    setStatus('Connected — this firmware has no settings to change here.', { kind: 'warn' });
    setPageHint(
      html`<div class="hint-body">
          <p>This device runs <b>${what}</b>. Use the <b>Flasher</b> to activate it or to install the custom firmware, then come back here to configure it.</p>
          <p class="muted small">Leaving this page disconnects the device.</p>
        </div>
        <a class="btn" href="index.html">Open Flasher</a>`,
      'warn',
    );
  }
  updateButtons();
}

// ---------------------------------------------------------------------------
// Disconnect

function cleanupAfterDisconnect() {
  const flashedOk = S.justFlashed;
  S.justFlashed = false;
  resetConnectionState();
  resetServiceFlags();
  setPhase('idle');
  clearDeviceUi();
  renderFirmwarePanel();
  renderDeviceInfo();
  if (flashedOk) {
    setStatus('Disconnected - the device is restarting with the new firmware. Reconnect to check it.', { kind: 'ok' });
  } else {
    setStatus('Disconnected', { kind: 'info' });
  }
}

function onDisconnected(ev) {
  if (ev.target !== S.device || S.retrying || S.phase === 'idle') return;
  log.info('Disconnected.');
  if (S.phase === 'connecting' && !S.userDisconnect) {
    // Let the pending setup step fail and trigger the retry logic.
    handleError(new Error('Device disconnected during setup'), S.session);
    return;
  }
  S.session++;
  cleanupAfterDisconnect();
}

export function disconnect() {
  S.userDisconnect = true;
  S.retrying = false;
  S.session++;
  if (S.ota) S.ota.abort();
  if (S.device) {
    try {
      S.device.gatt.disconnect();
    } catch {
      /* ignore */
    }
  }
  if (S.phase !== 'idle') {
    log.info('Disconnected.');
    cleanupAfterDisconnect();
  }
}

export async function reconnect() {
  if (!S.device || S.phase === 'flashing') return;
  S.retrying = true;
  S.session++;
  try {
    if (S.device.gatt.connected) S.device.gatt.disconnect();
  } catch {
    /* ignore */
  }
  log.info('Reconnect to: ' + (S.device.name || S.device.id));
  S.connectTrys = 0;
  S.noRetry = false;
  await sleep(300);
  doConnect();
}
