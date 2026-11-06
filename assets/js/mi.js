// Xiaomi "Mi" BLE authorisation (activation / registration + login) and the stock
// firmware Mi service (temperature notifications, clock, connection speed).
// The register/login state machine is a line-by-line port of the original page;
// notifications are processed strictly in arrival order through a serial queue so
// the asynchronous WebCrypto calls cannot reorder protocol steps.
import { S } from './state.js';
import { UUID, writeChar, onNotify } from './ble.js';
import { hub } from './device-hub.js';
import { log } from './log.js';
import { $, html, render, setStatus, setLive, getVal, setVal, confirmDialog, toast, copyText, downloadText, setHidden, setPanelTitle } from './ui.js';
import { bytesToHex, hexToBytes, hex2ascii, parseHex } from './util.js';
import { hkdfSha256, hmacSha256, aesCcmEncrypt, ecdhGenerate, ecdhSharedSecret } from './crypto.js';
import { SOURCES } from './config.js';
import { renderFirmwarePanel } from './flasher.js';

const M = () => S.mi;

// ---------------------------------------------------------------------------
// UI

const ACTIVATION_NOTE = 'After activating here, the device has to be activated again in the Mi Home app if you want to keep using it there.';

/**
 * Render the Mi activation / login panel into #custcfg.
 * opts: { intro?, warning?: html, register?, skip?, login?, extra?: html }
 */
export function renderMiPanel({ intro = ACTIVATION_NOTE, hint = null, warning = null, register = true, skip = false, login = true, extra = null } = {}) {
  setPanelTitle('Mi Home activation');
  render(
    'custcfg',
    html`
      <div class="panel">
        ${warning ? html`<div class="callout callout-warn">${warning}</div>` : ''}
        ${intro ? html`<p class="muted">${intro}</p>` : ''}
        ${hint ? html`<p class="callout">${hint}</p>` : ''}
        <div class="actions">
          ${register ? html`<button type="button" class="btn primary" data-action="miRegister">Do activation</button>` : ''}
          ${skip ? html`<button type="button" class="btn" data-action="miSkip">Skip activation</button>` : ''}
          ${login ? html`<button type="button" class="btn" data-action="miLogin" title="Log in with an existing token (e.g. from the Xiaomi cloud)">Login with token</button>` : ''}
        </div>
        <div class="form-grid">
          ${keyField('known_id', 'Device known ID', 'Device id registered in the Mi cloud', 40)}
          ${keyField('mi_token', 'Mi token', '24 hex characters (12 bytes)', 24)}
          ${keyField('mi_bind_key', 'Mi bind key', '32 hex characters (16 bytes)', 32)}
        </div>
        <div class="actions">
          <button type="button" class="btn small ghost" data-action="miDownloadKeys">Download keys (.json)</button>
        </div>
        <p class="muted small">Keep the <b>bind key</b>: Home Assistant, ESPHome and other receivers need it to decrypt the device's encrypted advertisements.</p>
        ${extra || ''}
      </div>
    `,
  );
}

export function keyField(id, label, title, maxlength, value = '') {
  return html`<label class="field span-2">
    <span>${label}</span>
    <span class="input-group">
      <input type="text" id="${id}" class="mono" maxlength="${maxlength}" title="${title}" value="${value}" autocomplete="off" spellcheck="false">
      <button type="button" class="btn small ghost" data-action="copyField" data-arg="${id}" title="Copy">Copy</button>
    </span>
  </label>`;
}

function warnLoginOnly(text, helpHref, helpText = 'Help') {
  return html`<b>Warning:</b> ${text} <a href="${helpHref}" target="_blank" rel="noopener">${helpText}</a>`;
}

export const MI_PANELS = {
  standard: () => renderMiPanel({}),
  unknown: () => renderMiPanel({ skip: true }),
  mjwsd07: () =>
    renderMiPanel({
      register: false,
      intro: null,
      warning: html`<b>Warning:</b> MJWSD07MMC firmware requires registration in Mi Home and obtaining the device keys.
        Use the <a href="${SOURCES.tokenExtractor}" target="_blank" rel="noopener">Xiaomi cloud tokens extractor</a> to get the token and bind key, then log in.`,
    }),
  lywsd03Locked: () =>
    renderMiPanel({
      register: false,
      intro: null,
      warning: warnLoginOnly(
        'LYWSD03MMC firmware version 2.1.1_0159 requires registration in Mi Home and obtaining the device keys (token & bind key) before it can be flashed.',
        'https://github.com/pvvx/ATC_MiThermometer/issues/602',
      ),
    }),
  mjwsd06Locked: () =>
    renderMiPanel({
      register: false,
      intro: null,
      warning: warnLoginOnly(
        'MJWSD06MMC firmware version 2.1.1_0009 requires registration in Mi Home and obtaining the device keys (token & bind key) before it can be flashed.',
        'https://github.com/pvvx/ATC_MiThermometer/issues/636',
      ),
    }),
};

// ---------------------------------------------------------------------------
// Mi main service (stock Xiaomi firmware)

export async function miAction() {
  S.speedChar = null;
  const service = await S.server.getPrimaryService(UUID.MI_MAIN_SERVICE);
  log.debug('Found MiMain service');
  const characteristics = await service.getCharacteristics();
  log.debug('Check Mi characteristics:', characteristics.map((c) => c.uuid).join(', '));
  for (const ch of characteristics) {
    if (ch.uuid === UUID.MI_SPEED_CHAR) {
      log.debug('Found MiSet characteristic Speed');
      S.speedChar = ch;
    } else if (ch.uuid === UUID.MI_TEMP_CHAR) {
      log.debug('Found MiTemp characteristic');
      S.tempChar = ch;
      try {
        await ch.startNotifications();
        onNotify(ch, onMiTemp);
      } catch (err) {
        log.debug('MiTemp notifications failed:', err);
      }
    } else if (ch.uuid === UUID.MI_CLOCK_CHAR) {
      log.debug('Found MiClock characteristic');
      S.clockChar = ch;
      try {
        showMiClock(await ch.readValue());
      } catch (err) {
        log.debug('MiClock read failed:', err);
      }
    }
  }
  await miAuthorization();
}

function onMiTemp(value) {
  if (value.byteLength < 5) return;
  const temp = value.getInt16(0, true) / 100;
  const hum = value.getUint8(2);
  const vbat = value.getUint16(3, true);
  const parts = [['Temperature', `${temp} °C`], ['Humidity', `${hum} %`], ['Battery', `${vbat} mV`]];
  let s = `Temp: ${temp}°C, Humi: ${hum}%, Bat: ${vbat} mV`;
  if (value.byteLength === 7) {
    const co2 = value.getUint16(5, true);
    parts.push(['CO₂', `${co2} ppm`]);
    s += `, CO₂: ${co2} ppm`;
  }
  setLive(parts, 'Mi');
  log.debug(s);
}

// Mi clock --------------------------------------------------------------------

function updateMiClock() {
  const el = $('miclk');
  if (el) el.textContent = new Date(S.miClockOffset + Date.now()).toLocaleString();
}

export function showMiClock(value) {
  if (value.byteLength < 6) return;
  setHidden('miclock', false);
  log.debug('MiClock value: ' + bytesToHex(value.buffer));
  const tz = new Date().getTimezoneOffset();
  const miclk = value.getUint32(0, true) * 1000;
  let tzh = value.getUint8(4); // local time step: 1 h
  if (tzh > 12) tzh -= 24; // negative offsets are stored as 24 + offset
  S.miClockOffset = miclk + tzh * 3600000 - Date.now() + tz * 60000;
  log.info('Get MiClock: ' + new Date(miclk).toLocaleString());
  updateMiClock();
  S.miClockTimer ??= setInterval(updateMiClock, 1000);
}

export async function getMiClock() {
  if (!S.clockChar) return;
  showMiClock(await S.clockChar.readValue());
}

export async function setMiClock() {
  if (!S.clockChar) return;
  let tzh = -new Date().getTimezoneOffset() / 60;
  const ut = Math.floor(Date.now() / 1000);
  if (tzh < 0) tzh += 24;
  const buffer = new Uint8Array([ut & 0xff, (ut >> 8) & 0xff, (ut >> 16) & 0xff, (ut >> 24) & 0xff, tzh, 0]);
  log.debug(bytesToHex(buffer));
  await S.clockChar.writeValue(buffer);
  S.miClockOffset = 0;
  log.ok('Set MiTime: ' + new Date(ut * 1000).toLocaleString() + ' - ok');
}

// ---------------------------------------------------------------------------
// Authorisation (service 0xFE95, characteristics 0x0010 / 0x0019)

let queue = Promise.resolve();
const enqueue = (fn) => {
  queue = queue.then(fn).catch((err) => protocolFail(err));
};

function protocolFail(err) {
  const msg = err && err.message ? err.message : String(err);
  log.error('Mi protocol error: ' + msg);
  setStatus('Mi protocol error: ' + msg, { kind: 'error' });
}

const send = (data, ch) => {
  log.debug('Send: ' + data);
  return writeChar(ch, data);
};

const ENC10_MESSAGES = {
  '11000000': ['Registration successful', 'ok'],
  '12000000': ['Registration failed!', 'error'],
  '13000000': ['Registration verify successful', 'ok'],
  '14000000': ['Registration verify failed!', 'error'],
  '21000000': ['Login successful', 'ok'],
  '22000000': ['Login invalid LTMK!', 'error'],
  '23000000': ['Login failed!', 'error'],
  e0000000: ['Not registered!', 'warn'],
  e1000000: ['Error: registered!', 'warn'],
  e2000000: ['Repeat login!', 'ok'],
  e3000000: ['Error: invalid OOB!', 'error'],
};

async function onEnc10(value) {
  log.debug('Enc_10: ' + value);
  const known = ENC10_MESSAGES[value];
  if (!known) return;
  const [text, kind] = known;
  log[kind === 'warn' ? 'warn' : kind === 'error' ? 'error' : 'ok'](text);
  setStatus(text, { kind });
  if (value === '11000000') {
    await sendLogin();
  } else if (value === '21000000' || value === 'e2000000') {
    S.isLoggedIn = true;
    renderFirmwarePanel();
  }
}

async function onEnc19(value) {
  const m = M();
  log.debug('Enc_19: ' + value);
  if (value.substring(0, 6) === '000004') {
    if (value.substring(6, 8) === '00') {
      await send('00000500' + value.substring(8), S.enc19);
    } else if (value.substring(6, 8) === '01') {
      await send('00000501' + value.substring(8), S.enc19);
      setTimeout(() => sendLogin().catch(protocolFail), 250);
    }
  } else if (m.mode === 1) {
    // ---------------- registration (activation)
    if (value.substring(0, 16) === '0000020001000000') {
      m.deviceNewId = value.substring(16);
      setVal('known_id', hex2ascii(m.deviceNewId.substring(2)));
      await send('00000100', S.enc19);
      setTimeout(() => startRegister().catch(protocolFail), 250);
    } else if (value === '000000000100') {
      m.isActivated = false;
      await send('00000101', S.enc19);
    } else if (value === '000000000200') {
      m.isActivated = true;
      await send('00000101', S.enc19);
    } else if (m.isActivated === true && m.state === 0 && value.substring(0, 4) === '0100') {
      m.deviceKnownId = value.substring(4);
    } else if (m.isActivated === true && m.state === 0 && value.substring(0, 4) === '0200') {
      m.deviceKnownId += value.substring(4);
      m.deviceNewId = m.deviceKnownId.substring(8);
      setVal('known_id', hex2ascii(m.deviceKnownId.substring(10)));
      await send('00000100', S.enc19);
      setTimeout(() => startRegister().catch(protocolFail), 250);
    } else if (value === '010001000000') {
      await send('00000100', S.enc19);
      setTimeout(() => startRegister().catch(protocolFail), 250);
    } else if (m.state === 1 && value === '00000101') {
      m.state = 2;
      const pk = m.ownPublicKey;
      await send('0100' + pk.substring(2, 38), S.enc19);
      await send('0200' + pk.substring(38, 74), S.enc19);
      await send('0300' + pk.substring(74, 110), S.enc19);
      await send('0400' + pk.substring(110, 146), S.enc19);
    } else if (value === '000000030400') {
      await send('00000101', S.enc19);
    } else if (m.state === 2 && value.substring(0, 4) === '0100') {
      m.devicePublicKey = '04' + value.substring(4);
    } else if (m.state === 2 && value.substring(0, 4) === '0200') {
      m.devicePublicKey += value.substring(4);
    } else if (m.state === 2 && value.substring(0, 4) === '0300') {
      m.devicePublicKey += value.substring(4);
    } else if (m.state === 2 && value.substring(0, 4) === '0400') {
      m.devicePublicKey += value.substring(4);
      await send('00000100', S.enc19);
      await makeSharedKey();
    } else if (m.state === 2 && value === '00000101') {
      m.state = 3;
      await send('0100' + m.writeDid.substring(0, 36), S.enc19);
      await send('0200' + m.writeDid.substring(36, 72), S.enc19);
    } else if (m.state === 3 && value === '00000100') {
      m.state = 0;
      await send('13000000', S.enc10); // REG_VERIFY_SUCC
    } else if (value === '000001050100') {
      log.warn('Received Timeout from device');
    } else if (value === '12000000') {
      log.error('Register Failed!');
    } else if (value === '11000000') {
      log.ok('Register successful');
    }
  } else {
    // ---------------- login
    if (m.state === 0 && value === '00000101') {
      m.state = 1;
      await send('0100' + m.randomKey, S.enc19);
    } else if (m.state === 1 && value === '0000000d0100') {
      m.state = 2;
      await send('00000101', S.enc19);
    } else if (m.state === 1 && value.substring(0, 8) === '0000020d') {
      m.state = 12;
      m.randomKeyRecv = value.substring(8);
      await loginGenerate();
      await send('00000300', S.enc19);
    } else if (m.state === 2 && value.substring(0, 4) === '0100') {
      m.state = 3;
      m.randomKeyRecv = value.substring(4);
      await loginGenerate();
      await send('00000100', S.enc19);
    } else if (m.state === 3 && value === '0000000c0200') {
      m.state = 4;
      await send('00000101', S.enc19);
    } else if (m.state === 12 && value.substring(0, 8) === '0000020c') {
      m.state = 13;
      m.deviceInfoRecv = value.substring(8);
      await send('00000300', S.enc19);
      if (m.expectedDeviceInfo === m.deviceInfoRecv) {
        log.ok('Received device infos are correct');
        await send('0000000a0100', S.enc19);
      } else {
        log.error('Received device infos are not correct (wrong token?)');
        m.state = 0;
        await send('00000100', S.enc19);
      }
    } else if (m.state === 4 && value.substring(0, 4) === '0100') {
      m.state = 5;
      m.deviceInfoRecv = value.substring(4);
    } else if (m.state === 5 && value.substring(0, 4) === '0200') {
      m.state = 6;
      m.deviceInfoRecv += value.substring(4);
      if (m.expectedDeviceInfo === m.deviceInfoRecv) log.ok('Received device infos are correct');
      else log.error('Received device infos are not correct (wrong token?)');
      await send('00000100', S.enc19);
      await send('0000000a0200', S.enc19);
    } else if (m.state === 6 && value === '00000101') {
      m.state = 7;
      await send('0100' + m.deviceInfoSend.substring(0, 36), S.enc19);
      await send('0200' + m.deviceInfoSend.substring(36, 72), S.enc19);
    } else if (m.state === 13 && value === '00000101') {
      m.state = 14;
      await send('0100' + m.deviceInfoSend, S.enc19);
    } else if (m.state === 14 && value === '00000100') {
      m.state = 0;
      log.debug('Waiting for terminating code ...');
    }
  }
}

async function doGenerate() {
  const { keyPair, publicRaw } = await ecdhGenerate();
  M().keyPair = keyPair;
  M().ownPublicKey = bytesToHex(publicRaw);
}

async function makeSharedKey() {
  const m = M();
  const shared = await ecdhSharedSecret(m.keyPair.privateKey, hexToBytes(m.devicePublicKey));
  // deriveTheKey()
  const derived = bytesToHex(await hkdfSha256(shared, null, 'mible-setup-info', 64));
  const token = derived.substring(0, 24);
  const bindKey = derived.substring(24, 56);
  const bindA = derived.substring(56, 88);
  setVal('mi_token', token);
  setVal('mi_bind_key', bindKey);
  log.ok('Mi token: ' + token + ', bind key: ' + bindKey);
  // key = bind A, nonce = 101112..1B, plaintext = device id, adata = "devID", 4-byte tag
  const did = await aesCcmEncrypt(hexToBytes(bindA), hexToBytes('101112131415161718191A1B'), hexToBytes(m.deviceNewId), hexToBytes('6465764944'), 4);
  m.writeDid = bytesToHex(did);
  await send('000000000200', S.enc19);
}

async function loginGenerate() {
  const m = M();
  const salt = hexToBytes(m.randomKey + m.randomKeyRecv);
  const salt1 = hexToBytes(m.randomKeyRecv + m.randomKey);
  const token = hexToBytes(getVal('mi_token').trim());
  const derived = bytesToHex(await hkdfSha256(token, salt, 'mible-login-info', 64));
  m.expectedDeviceInfo = bytesToHex(await hmacSha256(hexToBytes(derived.substring(0, 32)), salt1));
  m.deviceInfoSend = bytesToHex(await hmacSha256(hexToBytes(derived.substring(32, 64)), salt));
}

async function startRegister() {
  const m = M();
  await send('15000000', S.enc10);
  m.mode = 1;
  m.state = 1;
  await doGenerate();
  await send('000000030400', S.enc19);
}

export async function sendRegister() {
  if (!S.miConnected) {
    log.warn('Not connected');
    return;
  }
  log.info('Activating now, please wait...');
  setStatus('Activating…', { kind: 'busy' });
  const m = M();
  m.state = 0;
  m.mode = 1;
  await doGenerate();
  await send('a2000000', S.enc10);
}

export async function sendLogin() {
  log.info('Send Login, please wait...');
  const m = M();
  m.randomKey = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  m.state = 0;
  m.mode = 0;
  await send('24000000', S.enc10);
  await send('0000000b0100', S.enc19);
}

export async function keyMiLogin() {
  const tk = getVal('mi_token').trim();
  const bk = getVal('mi_bind_key').trim();
  if (tk.length === 32 && bk.length === 24) {
    log.error('It looks like you swapped the token and the bind key!');
    toast('Token and bind key look swapped', 'warn');
    return;
  }
  if (!parseHex(tk, 12)) {
    log.error('Mi token must be 24 hex characters (12 bytes)!');
    toast('Mi token must be 24 hex characters', 'warn');
    return;
  }
  if (!parseHex(bk, 16)) {
    log.error('Mi bind key must be 32 hex characters (16 bytes)!');
    toast('Mi bind key must be 32 hex characters', 'warn');
    return;
  }
  if (!S.miConnected) {
    log.warn('Not connected');
    return;
  }
  await sendLogin();
}

export function skipActivation() {
  if (S.cus017 && S.qingpingEnabled) {
    setPanelTitle('Qingping CGPR1');
    render('custcfg', qingpingExtraTemplate());
  } else {
    render('custcfg', '');
  }
  S.isLoggedIn = true;
  renderFirmwarePanel();
}

/** Extra controls for the Qingping CGPR1 (also shown after "Skip activation"). */
export function qingpingExtraTemplate() {
  return html`<div class="panel">
    <h3 class="panel-title">Qingping CGPR1</h3>
    <div class="actions">
      <button type="button" class="btn danger" data-action="qpClear" data-confirm="Clear all settings and reset the device into Qingping mode?">Clear all settings and reset (Qingping mode)</button>
    </div>
    <div class="row">
      <label class="field"><span>Motion timer (ms)</span><input type="number" id="mtimer" value="" placeholder="?"></label>
      <div class="actions">
        <button type="button" class="btn" data-action="qpGetTimer">Get</button>
        <button type="button" class="btn" data-action="qpSetTimer">Set</button>
      </div>
    </div>
  </div>`;
}

export function downloadMiKeys() {
  const data = {
    device: S.device ? S.device.name : null,
    mac: S.advMac || null,
    known_id: getVal('known_id'),
    token: getVal('mi_token'),
    bind_key: getVal('mi_bind_key'),
    saved: new Date().toISOString(),
  };
  if (!data.token && !data.bind_key) {
    toast('No keys to save yet', 'warn');
    return;
  }
  downloadText(`mi-keys-${(data.device || 'device').replace(/[^\w.-]+/g, '_')}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export const copyField = (id) => copyText(getVal(id), 'Copied');

/**
 * Subscribe to the Mi authorisation characteristics and determine the hardware
 * version from the device name (port of the original miAuthorization()).
 */
export async function miAuthorization() {
  S.miAuthConn = hub.connectionId; // a Mi session is tied to this connection (see connection.attach)
  const service = await S.server.getPrimaryService(0xfe95);
  log.debug('Found Mi auth service');
  S.enc10 = await service.getCharacteristic(0x0010);
  log.debug('Found enc_10 char');
  S.enc19 = await service.getCharacteristic(0x0019);
  log.debug('Found enc_19 char');
  S.miConnected = true;
  await S.enc10.startNotifications();
  onNotify(S.enc10, (value) => {
    const v = bytesToHex(value);
    enqueue(() => onEnc10(v));
  });
  await S.enc19.startNotifications();
  onNotify(S.enc19, (value) => {
    const v = bytesToHex(value);
    enqueue(() => onEnc19(v));
  });
  log.info('Connected');

  const name = S.device.name || '';
  const hr = S.devinfo.hrstr || '';
  const cfg = S.cfg;
  if (name === 'LYWSD03MMC') {
    const shwsr = hr.substr(0, 4);
    if (shwsr === 'B1.4' || shwsr === '0000') cfg.hver = 0x80; // sensor SHTC3
    else if (shwsr === 'B1.5') cfg.hver = 10;
    else if (shwsr === 'B1.6') cfg.hver = 3;
    else if (shwsr === 'B1.9') cfg.hver = 4;
    else if (shwsr === 'B1.7' || shwsr === 'B2.0') cfg.hver = 5;
    else if (shwsr === 'B1.1') cfg.hver = 14; // B1.6 (2025)
    else cfg.hver = 0;
  } else if (name.substr(0, 8) === 'MHO-C401') {
    const isNew = await confirmDialog('Is this an MHO-C401 with the new (2022) hardware version?', {
      title: 'MHO-C401 hardware version',
      ok: 'Yes, new (2022)',
      cancel: 'No, old version',
    });
    cfg.hver = isNew ? 8 : 1;
  } else if (name.substr(0, 4) === 'C121') cfg.hver = 11; // MHO-C122
  else if (name.substr(0, 20) === 'Qingping Temp & RH M') cfg.hver = 2;
  else if (name.substr(0, 18) === 'Qingping Temp RH M') cfg.hver = 7;
  else if (name.substr(0, 21) === 'Qingping Temp RH Lite') cfg.hver = 6;
  else if (name === 'MJWSD05MMC') {
    cfg.hver = (S.devinfo.frstr || '').substr(0, 4) === '0005' ? 12 : 9;
  } else {
    cfg.hver = null;
  }
  if (cfg.hver != null) S.hwverId = cfg.hver & 0x0f;
  if (name === 'MJWSD07MMC') {
    cfg.hver = 62;
    S.hwverId = 62;
  }
  let s = `'${name}'`;
  if (S.devinfo.hrstr) s += ' HW: ' + S.devinfo.hrstr;
  s += ' connected. You can now do the activation to get the token';
  if (S.otaEnabled) s += ' or flash a new firmware';
  setStatus(s + '.', { kind: 'ok' });
  log.debug('hwver_id: ' + S.hwverId);
  renderFirmwarePanel();
}

