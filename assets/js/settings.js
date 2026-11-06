// Settings UI for pvvx custom firmware and ZigbeeTLc (BLE mode).
// Port of the original CustomConfig() / SendCustomConfig() / zbdeviceConfig() with the
// same firmware-version and hardware gating and the same element ids, reorganised
// into collapsible sections. Field-reading commands also live here.
import { S, HW } from './state.js';
import { log } from './log.js';
import { $, html, render, getVal, setVal, getChecked, setChecked, exists, toast, downloadText, confirmDialog, setPanelTitle, setPageHint } from './ui.js';
import { hex, dump, parseHex, le16, le32 } from './util.js';
import { RF_TX_POWER, LCD_DIGCODE } from './tables.js';
import { SOURCES } from './config.js';
import { writeSettings, sendCustomSetting } from './custom.js';
import { renderFirmwarePanel } from './flasher.js';
import { keyField } from './mi.js';

// ---------------------------------------------------------------------------
// Template helpers

const NB = ' ';
const GRAPH_MEMO = 'history.html';

function inp(id, { title = '', value = '', maxlength = 8, mode = 'decimal', mono = false, placeholder = '' } = {}) {
  return html`<input type="text" id="${id}" title="${title}" value="${value}" maxlength="${maxlength}" inputmode="${mode}" class="${mono ? 'mono' : ''}" placeholder="${placeholder}" autocomplete="off" spellcheck="false">`;
}
function field(label, control, { unit = '', hint = '', after = '', wide = false } = {}) {
  return html`<label class="field${wide ? ' span-2' : ''}">
    <span>${label}</span>
    <span class="input-unit">${control}${unit ? html`<em>${unit}</em>` : ''}</span>
    ${hint ? html`<small>${hint}</small>` : ''}${after}
  </label>`;
}
function check(id, label, title = '') {
  return html`<label class="check" title="${title}"><input type="checkbox" id="${id}"><span>${label}</span></label>`;
}
function select(id, options, selected) {
  return html`<select id="${id}">${options.map(([v, t]) => html`<option value="${v}"${v === selected ? html` selected` : ''}>${t}</option>`)}</select>`;
}
const btn = (label, { action = null, cmd = null, arg = null, title = '', kind = '', confirm = null } = {}) =>
  html`<button type="button" class="btn ${kind}"${action ? html` data-action="${action}"` : ''}${cmd ? html` data-cmd="${cmd}"` : ''}${
    arg !== null ? html` data-arg="${arg}"` : ''
  }${confirm ? html` data-confirm="${confirm}"` : ''} title="${title}">${label}</button>`;
const section = (key, title, body, { open = false, sub = '' } = {}) =>
  html`<details class="section" data-key="${key}"${open ? html` open` : ''}>
    <summary><span>${title}</span>${sub ? html`<small>${sub}</small>` : ''}</summary>
    <div class="section-body">${body}</div>
  </details>`;
const group = (title, body) => html`<fieldset class="group"><legend>${title}</legend><div class="form-grid">${body}</div></fieldset>`;

// Option labels mimic what the LCD shows; value 0 is "nothing shown".
const SMILEY_OPTS = [
  [0, 'off'], [1, `${NB}^_^${NB}`], [2, `${NB}-∧-${NB}`], [3, `${NB}Δ△Δ${NB}`], [4, `(${NB}${NB}${NB})`], [5, '(^_^)'], [6, '(-∧-)'], [7, '(Δ△Δ)'],
];
const LINE_OPTS = [[0, 'off'], [5, '---']];
const TMPSMB_A = [[0, 'blank'], [1, '°Г'], [2, '-'], [3, '°F'], [4, '_'], [5, '°C'], [6, '='], [7, '°E']];
const TMPSMB_B = [[0, 'blank'], [1, '°г'], [2, '-'], [3, '°C'], [4, 'i'], [5, '°Г'], [6, 'г'], [7, '°F']];

function consoleSection(extra = '') {
  return section(
    'console',
    'Command console',
    html`<p class="muted small">Send raw hex commands to the firmware's command characteristic (for example <code>55</code> reads the configuration).</p>
      <div class="input-group">
        <input type="text" id="cmdTXT" class="mono" placeholder="hex, e.g. 55" data-enter="sendCmdTxt" autocomplete="off" spellcheck="false">
        <button type="button" class="btn" data-action="sendCmdTxt">Send</button>
      </div>${extra}`,
  );
}

/**
 * Flasher page (index.html): the configuration forms live on settings.html, so show a
 * pointer there instead. Returns true when the caller should not render the forms.
 */
export function showSettingsLink() {
  if (S.page !== 'flasher') return false;
  const v = S.cfg.ver;
  const ver = v ? ` ${v >> 4}.${v & 0x0f}` : '';
  let what = `pvvx custom firmware${ver}`;
  if (S.devTest) what = 'test firmware';
  else if (S.bthomeEnabled) what = `ZigbeeTLc${ver} firmware (BLE mode)`;
  else if (!S.devIdEnabled) what = 'ATC1441 custom firmware';
  const tooOld = S.customEnabled && S.devIdEnabled && !S.devTest && v > 0 && v < 0x10;
  if (tooOld) {
    setPageHint(html`<div class="hint-body"><p>This device runs <b>${what}</b>, which is too old to configure. Flash a newer version below.</p></div>`, 'warn');
    return true;
  }
  let what2 = 'Advertising format, intervals, display, calibration and the other options are';
  if (S.devTest) what2 = 'Its command console is';
  else if (S.bthomeEnabled) what2 = 'Display, comfort zone, calibration offsets and the measurement interval are';
  else if (!S.devIdEnabled) what2 = 'Smiley, advertising type, units, interval and the LCD segment mapper are';
  setPageHint(html`<div class="hint-body">
      <p>This device runs <b>${what}</b>. ${what2} on the <b>Settings</b> page.</p>
      <p class="muted small">Leaving this page disconnects the device; connect it again there.</p>
    </div>
    <a class="btn" href="settings.html">Open Settings</a>`);
  return true;
}

/** Minimal panel shown while waiting for the configuration (and for test firmware). */
export function renderCommandPanel({ getCmd = '55', title = 'Custom firmware', note = '', link = null } = {}) {
  if (showSettingsLink()) return;
  setPanelTitle(title);
  render(
    'custcfg',
    html`<div class="panel">
      ${note ? html`<p class="muted">${note}</p>` : ''}
      <div class="actions">${btn('Get config', { cmd: getCmd })}${
        link ? html`<a class="btn ghost" href="${link.href}" target="_blank" rel="noopener">${link.text}</a>` : ''
      }</div>
      ${consoleSection()}
    </div>`,
  );
  const d = $('custcfg').querySelector('details[data-key="console"]');
  if (d) d.open = true;
}

// ---------------------------------------------------------------------------
// pvvx custom firmware configuration (cfg.ver >= 0x10)

export function CustomConfig() {
  renderFirmwarePanel();
  if (showSettingsLink()) return;
  setPanelTitle('Custom firmware settings');
  const cfg = S.cfg;
  const hw = S.hwverId;
  if (cfg.ver < 0x10) {
    render('custcfg', html`<div class="callout callout-warn">Unsupported device software version! Custom ATC version &gt;= 1.0 is required.</div>`);
    return;
  }
  const screen = HW.hasScreenUi(hw);
  const blocks = screen ? screenDeviceSections(cfg, hw) : plainDeviceSections(cfg, hw);
  render('custcfg', html`<div class="panel-stack">${blocks}</div>`);
  if (screen) applyScreenValues(cfg, hw);
  else applyPlainValues(cfg);
  InfoIntervals();
  cfg.enable = true;
}

/** Fields shared by both layouts: tx measures, offsets, PHY, advertising, RF power. */
function commonConfigFields(cfg, hw, { lpAlreadyShown }) {
  const lcdAdv = hw <= 15 || (hw >= 30 && hw <= 33) || hw === 38 || hw === 52;
  const offsets = [];
  if (cfg.ver < 0x47) {
    offsets.push(field('Temperature offset', inp('cfg_tmp_off', { title: '-12.7..12.7°, default 0', value: '0', maxlength: 5, mode: 'text' }), { unit: '°' }));
    offsets.push(field('Humidity offset', inp('cfg_hm_off', { title: '-12.7..12.7%, default 0', value: '0', maxlength: 5, mode: 'text' }), { unit: '%' }));
  }
  const radio = [];
  if (cfg.ver > 0x50) {
    radio.push(
      field(
        'Random delay added to the advertising interval',
        inp('cfg_flg3_adv_delay', {
          title: 'A pseudo-random value in the range from 0 to 10 ms is added to a fixed advInterval so that advertising events change over time. Value in 0.625 ms.',
          value: '10',
          maxlength: 5,
        }),
        { unit: '× 0.625 ms' },
      ),
    );
    radio.push(
      field('Event beacon duplicates', inp('cfg_event_adv_cnt', { title: 'Range: 5..255. Number of duplicates when transmitting events beacons, default 6', value: '6', maxlength: 5 }), {
        hint: '5..255, default 6',
      }),
    );
  }
  const phy = [];
  if (cfg.ver >= 0x36) {
    if (cfg.ver >= 0x42) {
      phy.push(check('bt5_flags', 'BT5+ PHY', 'Support BT5.0+ PHY (LE 2M/1M/500K/125K, CSA2)'));
      phy.push(check('longrange_flags', 'LE Long Range (BT5.0+ adapters only!)', 'Enable Extended Advertising Long Range (Coded PHY S8)'));
    } else if (cfg.ver >= 0x40) {
      phy.push(check('bt5_flags', 'BT5+ PHY', 'Support BT5.0+ PHY (LE 2M/1M/500K/125K, CSA2)'));
    } else {
      phy.push(check('bt5_flags', 'BT5+ PHY', 'Support BT5.0+ PHY (LE 2M/1M/500K/125K)'));
      phy.push(check('csa2_flags', 'CSA2', 'Channel Selection Algorithm 2 or 1'));
    }
  }
  const adv = [];
  const advInt = field('Advertising interval', inp('cfg_adv_int', { title: '62.5 ms .. 10 000 ms, step: 62.5 ms, default 2500 ms', value: '40', maxlength: 6 }), {
    unit: 'ms',
    hint: 'step 62.5 ms',
  });
  const measInt = field('Measure interval', inp('cfg_meas_int', { title: '1..25 (62.5 ms .. 250 sec), default 4 (10 sec)', value: '4', maxlength: 3 }), {
    unit: '× adv. interval',
    after: html`<small id="cfg_meas_int_val" class="computed"></small>`,
  });
  let lat;
  if (lcdAdv) {
    const last = cfg.ver >= 0x37 ? (cfg.ver >= 0x45 ? 'BTHome v2' : 'BTHome v1') : 'All';
    adv.push(field('Advertising type', select('cfg_flg_adv_type', [[0, 'ATC1441'], [1, 'PVVX (Custom)'], [2, 'MIJIA (MiHome)'], [3, last]], 3)));
    const flags = [];
    if (cfg.ver >= 0x30) flags.push(check('adv_flags', 'AdFlags', 'Toggle support for third-party software'));
    if (cfg.ver >= 0x22) flags.push(check('cfg_adv_crypto', 'Encrypted beacon', 'Bindkey encrypted beacon'));
    if (flags.length) adv.push(html`<div class="checks">${flags}</div>`);
    lat =
      cfg.ver > 0x40
        ? field('Connect latency', inp('cfg_con_lat', { title: '0..1000 ms, default 1000 ms', value: '1000', maxlength: 4 }), { unit: 'ms', hint: 'step 20 ms' })
        : field('Connect latency', inp('cfg_con_lat', { title: '0..4000 ms, default 2500 ms', value: '2500', maxlength: 4 }), { unit: 'ms', hint: 'step 20 ms' });
  } else {
    if (cfg.ver < 0x48) {
      adv.push(field('Advertising type', select('cfg_flg_adv_type', [[0, 'BTHome v2'], [1, 'PVVX (Custom)'], [2, 'MIJIA (MiHome)'], [3, 'BTHome v1']], 1)));
    } else {
      adv.push(field('Advertising type', select('cfg_flg_adv_type', [[0, 'ATC1441'], [1, 'PVVX (Custom)'], [2, 'MIJIA (MiHome)'], [3, 'BTHome v2']], 3)));
    }
    adv.push(
      html`<div class="checks">${check('adv_flags', 'AdFlags', 'Toggle support for third-party software')}${check('cfg_adv_crypto', 'Encrypted beacon', 'Bindkey encrypted beacon')}</div>`,
    );
    lat = field('Connect latency', inp('cfg_con_lat', { title: '0..1000 ms, default 1000 ms', value: '1000', maxlength: 4 }), { unit: 'ms', hint: 'step 20 ms' });
  }
  const lpExtra = !lcdAdv && cfg.ver >= 0x48 && !lpAlreadyShown ? check('cfg_flg_lp_meas', 'Sensor in low-power mode', 'Sensor measurements in Low Power mode') : '';
  const rf = field('RF TX power', select('cfg_rf_tx', RF_TX_POWER, 191));
  return {
    txButtons: html`<div class="actions">
      ${btn('Start Tx measure', { cmd: '33ff', title: 'Start transferring measurements. Only in the current connection.' })}
      ${btn('Stop Tx measure', { cmd: '3300', title: 'Stop transferring measurements. Only in the current connection.' })}
    </div>`,
    measurement: html`${offsets}${measInt}${lpExtra ? html`<div class="checks">${lpExtra}</div>` : ''}`,
    advertising: html`${adv}${advInt}${radio}${phy.length ? html`<div class="checks">${phy}</div>` : ''}${lat}${rf}`,
  };
}

function configFooter() {
  return html`<div class="actions sticky-actions">
    ${btn('Send config', { action: 'sendCustomConfig', kind: 'primary', title: 'Write the configuration above to the device' })}
    ${btn('Get config', { cmd: '55', title: 'Read the configuration from the device' })}
    ${btn('Set default', { cmd: '56', title: 'Restore the default configuration', confirm: 'Restore the default configuration on the device?' })}
  </div>
  <p id="cfg-pending" class="muted small" hidden>Waiting for the device to confirm the new configuration…</p>`;
}

function memoBlock(cfg, { deleteAll }) {
  return html`<div class="actions">
      ${deleteAll ? btn('Delete all records', { cmd: '36123400', kind: 'danger', confirm: 'Delete all measurement records stored on the device?' }) : ''}
      ${btn('Set time', { action: 'setDevTime', title: 'Set the device clock to this computer’s local time' })}
      <span class="input-group compact">
        <input type="text" id="memo_count" value="50" maxlength="5" inputmode="numeric" title="Number of records (1..19632)">
        ${btn('Get last records', { action: 'getMemo' })}
      </span>
      <a class="btn ghost" href="${GRAPH_MEMO}" target="_blank" rel="noopener" title="Read and chart the whole history (opens the History page)">History chart ↗</a>
    </div>
    <div id="memo-actions" class="actions" hidden>
      ${btn('Download records (.csv)', { action: 'downloadMemo', kind: 'small' })}
    </div>`;
}

function sensorSection(cfg, maxlength, withAddSensors) {
  if (cfg.ver < 0x47) return '';
  const k = (id, label, title) => field(label, inp(id, { title, maxlength, mode: 'text' }));
  return section(
    'sensor',
    'Sensor calibration',
    html`<p class="muted small"><span id="lblSensorInfo">Press “Get sensor settings” to read the current values.</span></p>
      <div class="form-grid">
        ${k('inpTempK', 'Temperature slope (Tk)', 'Tk: Slope factor (linear function) for temperature calculation (T=RegT*Tk/65536+Tz)')}
        ${k('inpTempZ', 'Temperature zero offset (Tz)', 'Tz: Zero offset with correction value for temperature calculation (T=RegT*Tk/65536+Tz)')}
        ${k('inpHumK', 'Humidity slope (Hk)', 'Hk: Slope factor (linear function) for humidity calculation (H=RegH*Hk/65536+Hz)')}
        ${k('inpHumZ', 'Humidity zero offset (Hz)', 'Hz: Zero offset with correction value for humidity calculation (H=RegH*Hk/65536+Hz)')}
      </div>
      <div class="actions">
        ${btn('Get sensor settings', { action: 'getSensCfg' })}
        ${btn('Send sensor settings', { action: 'setSensCfg', kind: 'primary' })}
        ${btn('Set default', { action: 'resetSensCfg', title: 'Restore default sensor settings', confirm: 'Restore the default sensor calibration?' })}
      </div>
      ${withAddSensors ? html`<div id="addSensors"></div>` : ''}`,
  );
}

function trgFields(cfg, { precise }) {
  return precise
    ? html`${field('Temperature hysteresis', inp('trg_tmp_hst', { title: 'Step 0.01°, default -0.55°, =0 off, if less than zero - activation on decrease, if more than zero - activation on excess', value: '-0.55', maxlength: 7, mode: 'text' }), { unit: '°' })}
        ${field('Humidity hysteresis', inp('trg_hm_hst', { title: 'Step 0.01%, default 0, =0 off, if less than zero - activation on decrease, if more than zero - activation on excess', value: '0.0', maxlength: 7, mode: 'text' }), { unit: '%' })}`
    : html`${field('Temperature hysteresis', inp('trg_tmp_hst', { title: '-12.7..12.7°, default -0.1, =0 off, if less than zero - activation on decrease, if more than zero - activation on excess', value: '-0.1', maxlength: 5, mode: 'text' }), { unit: '°' })}
        ${field('Humidity hysteresis', inp('trg_hm_hst', { title: '-12.7..12.7%, default 0, =0 off, if less than zero - activation on decrease, if more than zero - activation on excess', value: '0.0', maxlength: 5, mode: 'text' }), { unit: '%' })}`;
}
const trgThresholds = () =>
  html`${field('Temperature threshold', inp('trg_tmp_thr', { title: '-40.00..80.00°C, default 21.00°C', value: '21.00', maxlength: 6, mode: 'text' }), { unit: '°C' })}
    ${field('Humidity threshold', inp('trg_hm_thr', { title: '0..99.00%, default 50.00%', value: '50.00', maxlength: 6 }), { unit: '%' })}`;
const trgButtons = () =>
  html`<div class="actions">
    ${btn('Get TRG', { cmd: '44', title: 'Get/read current settings' })}
    ${btn('Set TRG', { action: 'sendTrg', kind: 'primary', title: 'Set/save current settings' })}
    ${btn('Set pin to “1”', { cmd: '4501', title: 'GPIO_TRG PullUp 10 kOhm. Works only with TRG off!' })}
    ${btn('Set pin to “0”', { cmd: '4500', title: 'GPIO_TRG PullDown 100 kOhm. Works only with TRG off!' })}
  </div>`;
const rsRpint = () => field('RS report interval', inp('rds_rpint', { title: '0 - Off, 1..65535 sec, default 3600 sec', value: '3600', maxlength: 6 }), { unit: 's' });

function macBlock(cfg, { setButtons }) {
  const mac = S.mikeys.mac;
  const value = mac ? hex(mac[5], 2) + hex(mac[4], 2) + hex(mac[3], 2) + hex(mac[2], 2) + hex(mac[1], 2) + hex(mac[0], 2) + hex(mac[7], 2) + hex(mac[6], 2) : '?';
  return html`<label class="field span-2">
      <span>Device MAC [+ 2 random bytes]</span>
      <span class="input-group">
        <input type="text" id="mi_mac" class="mono" maxlength="16" title="Must be 6 hex MAC digits [+ 2 hex RandMAC digits]!" value="${value}" autocomplete="off" spellcheck="false">
        ${mac ? '' : btn('Get MAC', { cmd: '10', title: 'Get MAC' })}
      </span>
    </label>
    ${setButtons
      ? html`<div class="actions span-2">
          ${btn('Set MAC', { action: 'sendMAC', kind: 'danger', title: 'Set custom MAC. Warning: if a PIN code is set, restart everything (software and device) before the next connection!' })}
          ${btn('Clean MAC', { action: 'cleanMAC', kind: 'danger', title: 'Restore the standard MAC (A4C138******). Warning: if a PIN code is set, restart everything before the next connection!', confirm: 'Restore the standard MAC address? You will have to reconnect.' })}
        </div>`
      : ''}`;
}

function pinBlock() {
  S.pincode.enable = true;
  return html`<label class="field">
      <span>PIN code</span>
      <span class="input-group">
        <input type="text" id="pincode" maxlength="6" inputmode="numeric" class="mono" title="000000..999999, 6 decimal digits, 000000 - PinCode Disable. Warning: If the PinCode is forgotten - only a hardware flasher!" value="000000" autocomplete="off">
        ${btn('Set PIN', { action: 'sendPinCode', kind: 'danger', title: 'Warning: if the PIN code is forgotten, only a hardware flasher can recover the device!' })}
      </span>
      <small>000000 disables the PIN. A forgotten PIN can only be cleared with a wired (UART) flasher.</small>
    </label>`;
}

function nameBlock(maxlength, defaultName) {
  S.dnm.enable = true;
  return html`<label class="field">
      <span>Device name</span>
      <span class="input-group">
        <input type="text" id="dev_name" maxlength="${maxlength}" title="Device name: 1..${maxlength} characters" value="" autocomplete="off" spellcheck="false">
        ${btn('Get', { cmd: '01' })}
      </span>
      <span class="actions">
        ${btn('Set new name', { action: 'sendDevName', kind: 'small' })}
        ${btn('Default name', { action: 'cleanDevName', kind: 'small', title: `Clean name: ${defaultName}` })}
      </span>
    </label>`;
}

function bindKeyBlock(label) {
  return html`<label class="field span-2">
      <span>${label}</span>
      <span class="input-group">
        <input type="text" id="cbind_key" class="mono" maxlength="32" title="Bind Key must be 32 hex characters (16 bytes)" value="?" autocomplete="off" spellcheck="false">
        ${btn('Get', { action: 'getBKey', title: 'Get BindKey' })}
        ${btn('Set', { action: 'setBKey', title: 'Set new BindKey', confirm: 'Write a new bind key to the device? Receivers using the old key will no longer decrypt its beacons.' })}
      </span>
    </label>`;
}

function screenDeviceSections(cfg, hw) {
  const out = [];
  // --- Show custom value on the screen
  let extInputs;
  if (HW.isQingpingLcd(hw)) {
    extInputs = html`${field('Big number', inp('extbignumb', { title: 'Big number: -99.5..1999.5', value: '123.4', maxlength: 5, mode: 'text' }))}
      ${field('Symbol', select('exttmpsmb', TMPSMB_A, 6))}
      ${field('Line', select('extsmiley', LINE_OPTS, 0))}
      ${field('Small number', inp('extsmalnumb', { title: 'Small number: -99.5..999.5', value: '56.7', maxlength: 5, mode: 'text' }))}`;
  } else if (hw === 9 || hw === 12 || hw === 49) {
    extInputs = html`${field('Big number', inp('extbignumb', { title: 'Big number: -999.50..19999.50', value: '123.45', maxlength: 8, mode: 'text' }))}
      ${field('Symbol', select('exttmpsmb', TMPSMB_B, 6))}
      ${field('Smiley', select('extsmiley', SMILEY_OPTS, 7))}`;
  } else {
    extInputs = html`${field('Big number', inp('extbignumb', { title: 'Big number: -99.5..1999.5', value: '123.4', maxlength: 5, mode: 'text' }))}
      ${field('Symbol', select('exttmpsmb', TMPSMB_A, 6))}
      ${field('Smiley', select('extsmiley', SMILEY_OPTS, 7))}
      ${field('Small number', inp('extsmalnumb', { title: 'Small number: -9..99', value: '99', maxlength: 2, mode: 'text' }))}`;
  }
  S.ext.enable = true;
  out.push(
    section(
      'ext',
      'Show a custom value on the screen',
      html`<div class="form-grid">
          ${extInputs}
          ${field('Show for', inp('extvtimed', { title: 'Validity time = Show time in sec: 1..65535', value: '600', maxlength: 5 }), { unit: 's' })}
          <div class="checks">${check('extpersent', '% sign')}${check('extbattery', 'Battery symbol')}</div>
        </div>
        <div class="actions">
          ${btn('Show', { action: 'sendExt', kind: 'primary' })}
          ${btn('Get previous', { cmd: '22', title: 'Read the last custom value sent to the device' })}
          ${hw === 0 ? html`${btn('LCD test: show clock', { action: 'lcdClock' })}${btn('Repair LCD', { action: 'lcdRestore' })}` : ''}
        </div>`,
    ),
  );

  // --- Configuration (everything written by "Send config")
  const scr = [];
  if (cfg.ver >= 0x43) scr.push(check('cfg_scr_off', 'Screen off', 'Screen Off'));
  const scrFields = [field('Temperature unit', select('cfg_flg_cf', [[0, '°C'], [1, '°F']], 0))];
  if (hw === 9 || hw === 12) {
    scr.push(check('cfg_flg_am_pm', '12-hour clock'), check('cfg_flg_x100', 'T & H with 2 decimals'));
    if (hw === 12) scr.push(check('cfg_flg3_ddmm', 'Date as DD/MM'));
  } else if (hw === 49) {
    scr.push(check('cfg_flg_am_pm', '12-hour clock'), check('cfg_flg3_weekday', 'Show weekday'));
  }
  if (HW.isQingpingLcd(hw)) scrFields.push(field('Line', select('cfg_smiley', LINE_OPTS, 0)));
  else if (hw === 9 || hw === 12)
    scrFields.push(field('Show', select('cfg_scr_type', [[0, 'Time'], [1, 'Temperature'], [2, 'Humidity'], [3, 'Battery %'], [4, 'Battery V'], [5, 'ExtNumber & symbols']], 0)));
  else scrFields.push(field('Smiley', select('cfg_smiley', SMILEY_OPTS, 0)));
  scr.push(check('cfg_flg_comfort', 'Comfort indicator'));
  if (hw === 9 || hw === 12) {
    if (cfg.ver > 0x48) scr.push(check('cfg_flg3_weekday', 'Show weekday'));
  } else scr.push(check('cfg_flg_show_batt', 'Show battery'));
  if (cfg.ver >= 0x18) {
    if (!(hw === 9 || hw === 12 || hw === 49)) scr.push(check('cfg_flg_blinking', 'Clock', 'Show the clock on the screen'));
  } else scr.push(check('cfg_flg_blinking', 'Blinking'));
  if (!(hw === 9 || hw === 12 || hw === 49)) {
    scrFields.push(field('Minimum LCD refresh period', inp('cfg_lcd_tint', { title: '0.5..12.75 sec, step: 0.05 s, default 2.45 s', value: '2.45', maxlength: 6 }), { unit: 's', hint: 'step 0.05 s' }));
  }
  const common = commonConfigFields(cfg, hw, { lpAlreadyShown: true });
  const meas = [];
  meas.push(html`<div class="checks span-2">${check('cfg_flg_lp_meas', 'Sensor in low-power mode', 'Sensor measurements in Low Power mode')}${check('cfg_flg_tx_meas', 'Tx measures on connect', 'When connected, start transferring measurements')}${
    cfg.ver === 0x19 ? check('cfg_flg2_memo', 'Record measurements to flash', 'Recording measurements to flash memory (cyclic buffer for 19632 measurements)') : ''
  }</div>`);
  meas.push(common.measurement);
  if (cfg.ver >= 0x20) {
    meas.push(
      field('Store averaged measurements every', inp('cfg_av_meas_mem', { title: '0..255, =0 - off, default 60. Set time/date!', value: '60', maxlength: 3 }), {
        unit: '× measure interval',
        hint: '0 = off. Set the device time first!',
        after: html`<small id="cfg_av_meas_mem_val" class="computed"></small>`,
      }),
    );
  }
  out.push(
    section(
      'config',
      'Configuration',
      html`${group('Screen', html`${scrFields}<div class="checks span-2">${scr}</div>`)}
        ${group('Measurements', meas)}
        ${common.txButtons}
        ${group('Advertising & radio', common.advertising)}
        ${configFooter()}`,
      { open: true, sub: 'written together with “Send config”' },
    ),
  );

  // --- Measurement history
  if (cfg.ver === 0x19 || cfg.ver >= 0x20) out.push(section('memo', 'Measurement history', memoBlock(cfg, { deleteAll: cfg.ver >= 0x23 })));

  // --- Sensor calibration
  out.push(sensorSection(cfg, 16, false));

  // --- Clock
  const clock = [];
  if (cfg.ver >= 0x18) clock.push(html`<div class="actions">${btn('Set time', { action: 'setDevTime', title: 'Set the device clock to local time' })}${btn('Get time', { cmd: '23' })}</div>`);
  if (cfg.ver >= 0x24 && hw !== 9 && hw !== 12 && hw !== 49) clock.push(deltaTimeBlock(cfg.ver >= 0x36, 16));
  if (clock.length) out.push(section('clock', 'Clock', clock));

  // --- TrSc (LYWSD03MMC, v5.3+)
  if (HW.isLywsd03(hw) && cfg.ver >= 0x53) {
    out.push(
      section(
        'trsc',
        'Transmit & scan timestamp',
        html`<div class="form-grid">
            ${field('Interval', inp('trsc_int', { title: '0 - Off, 1..4294967295 sec, default 0', value: '0', maxlength: 12 }), { unit: 's', hint: '0 = off' })}
            ${field('Scan device MAC', inp('trsc_mac', { title: 'Must be 6 hex MAC digits!', value: '', maxlength: 16, mode: 'text', mono: true }), { wide: true })}
          </div>
          <div class="actions">${btn('Get', { action: 'getTrScConfig', title: 'Get/read TrScIn settings' })}${btn('Set', { action: 'setTrScConfig', kind: 'primary', title: 'Set/save TrScIn settings' })}</div>`,
      ),
    );
  }

  // --- GPIO TRG / reed switch
  const rs = [];
  if (cfg.ver >= 0x37) {
    const opts = [[0, 'None'], [1, 'Switch'], [2, 'Counter']];
    if (cfg.ver >= 0x42 && hw !== 9 && hw !== 12) opts.push([3, 'Connect']);
    rs.push(field('Reed switch mode', select('rds_type', opts, opts.length === 4 ? 3 : 0)));
    if (cfg.ver >= 0x39) rs.push(html`<div class="checks">${check('rds_invert', 'Invert RS event')}</div>`);
    rs.push(rsRpint());
  }
  out.push(
    section(
      'trg',
      HW.isLywsd03(hw) ? 'GPIO TRG (pad marked “reset”) & reed switch' : 'GPIO TRG & reed switch',
      html`${group('Trigger output', html`${trgFields(cfg, { precise: cfg.ver >= 0x26 })}${trgThresholds()}`)}
        ${rs.length ? group('Reed switch (GPIO_RS)', rs) : ''}
        ${trgButtons()}`,
    ),
  );
  S.trg.enable = true;

  // --- Comfort parameters
  if (cfg.ver >= 0x13 && hw !== 31 && hw !== 38) {
    out.push(section('comfort', 'Comfort parameters', comfortFields(true)));
    S.cmf.enable = true;
  }

  // --- Keys & security
  const keys = [];
  if (hw < 30 || hw === 49) keys.push(html`<div class="actions span-2">${btn('Show all Mi keys', { cmd: '15' })}</div>`);
  if (cfg.ver >= 0x11) {
    keys.push(pinBlock());
    if (cfg.ver >= 0x14) keys.push(nameBlock(18, 'ATC_xxxx'));
  }
  keys.push(macBlock(cfg, { setButtons: !S.mikeys.mac || cfg.ver >= 0x14 }));
  if (S.mikeys.id) {
    const str = new TextDecoder('utf-8').decode(S.mikeys.id.slice(1));
    keys.push(keyField('known_id', 'Device known ID', 'Device id', 19, str));
  }
  if (S.mikeys.bindkey && S.mikeys.token) {
    keys.push(keyField('mi_token', 'Mi token', '24 hex characters', 24, dump(S.mikeys.token, 12)));
    keys.push(keyField('mi_bind_key', 'Mi bind key', '32 hex characters', 32, dump(S.mikeys.bindkey, 16)));
    keys.push(html`<div class="actions span-2">
      ${btn('Set new token & bind key', { action: 'setNewTBKey', title: 'Set new Mi token and bind key' })}
      ${cfg.ver >= 0x21 ? btn('Erase all Mi keys', { cmd: '17', kind: 'danger', confirm: 'Erase all Mi keys stored on the device?' }) : ''}
      ${S.mikeys.restore ? btn('Swap previous token + bind key', { cmd: '16' }) : ''}
    </div>`);
  }
  if (cfg.ver >= 0x28) keys.push(bindKeyBlock('Beacon bind key'));
  out.push(section('keys', 'Keys & security', html`<div class="form-grid">${keys}</div>`));

  out.push(consoleSection());
  return out;
}

function plainDeviceSections(cfg, hw) {
  const out = [];
  const common = commonConfigFields(cfg, hw, { lpAlreadyShown: false });
  const meas = [];
  meas.push(html`<div class="checks span-2">${check('cfg_flg_tx_meas', 'Tx measures on connect', 'When connected, start transferring measurements')}</div>`);
  meas.push(common.measurement);
  meas.push(
    field('Store averaged measurements every', inp('cfg_av_meas_mem', { title: '0..255, =0 - off, default 60. Set time/date!', value: '60', maxlength: 3 }), {
      unit: '× measure interval',
      hint: '0 = off. Set the device time first!',
      after: html`<small id="cfg_av_meas_mem_val" class="computed"></small>`,
    }),
  );
  out.push(
    section(
      'config',
      'Configuration',
      html`${group('Measurements', meas)}
        ${common.txButtons}
        ${group('Advertising & radio', common.advertising)}
        ${configFooter()}`,
      { open: true, sub: 'written together with “Send config”' },
    ),
  );
  out.push(section('memo', 'Measurement history', memoBlock(cfg, { deleteAll: true })));
  out.push(section('clock', 'Clock', html`<div class="actions">${btn('Set time', { action: 'setDevTime' })}${btn('Get time', { cmd: '23' })}</div>${deltaTimeBlock(true, 6)}`));
  out.push(sensorSection(cfg, 8, true));
  if (cfg.ver >= 0x48) {
    const rs = [];
    if (hw === 18) {
      rs.push(field('RS1 mode', select('rds_type', [[0, 'None'], [1, 'Switch'], [2, 'Counter']], 0)), html`<div class="checks">${check('rds_invert', 'Invert RS1 event')}</div>`);
      rs.push(field('RS2 mode', select('rds2_type', [[0, 'None'], [1, 'Switch'], [2, 'Counter']], 0)), html`<div class="checks">${check('rds2_invert', 'Invert RS2 event')}</div>`);
      S.trg.rds2_enable = true;
    } else {
      rs.push(field('RS mode', select('rds_type', [[0, 'None'], [1, 'Switch'], [2, 'Counter']], 0)), html`<div class="checks">${check('rds_invert', 'Invert RS event')}</div>`);
      S.trg.rds2_enable = false;
    }
    rs.push(rsRpint());
    out.push(
      section(
        'trg',
        'GPIO TRG & reed switch',
        html`${group('Trigger output', html`${trgFields(cfg, { precise: true })}${trgThresholds()}`)}${group('Reed switch (GPIO_RS)', rs)}${trgButtons()}`,
      ),
    );
    S.trg.enable = true;
  }
  out.push(
    section(
      'keys',
      'Keys & security',
      html`<div class="form-grid">${bindKeyBlock('EEP bind key')}${pinBlock()}${nameBlock(10, 'DEV_xxxx')}${macBlock(cfg, { setButtons: true })}</div>`,
    ),
  );
  out.push(consoleSection());
  return out;
}

function deltaTimeBlock(withCalc, maxlength) {
  return html`<div class="form-grid">
      ${field('Clock drift adjustment', inp('cfg_time_step', { title: '-32767..32767, in 1/16 us for 1 sec, default 0', value: '0', maxlength, mode: 'text' }), { unit: '1/16 µs per s' })}
    </div>
    <div class="actions">
      ${btn('Get delta time', { cmd: '24', title: 'Get time clock delta' })}
      ${btn('Set delta time', { action: 'sendDeltaTime', kind: 'primary' })}
      ${withCalc ? btn('Calculate delta time', { action: 'calkDeltaTime', title: 'The minimum period for calculation is 3 hours since the clock was last set!' }) : ''}
    </div>`;
}

function comfortFields(withButtons) {
  return html`<div class="form-grid">
      ${field('Temperature low', inp('cmf_tmp_lo', { title: '-40.00..125.00°C, default 21.00°C', value: '21.00', maxlength: 6, mode: 'text' }), { unit: '°C' })}
      ${field('Temperature high', inp('cmf_tmp_hi', { title: '-40.00..125.00°C, default 26.00°C', value: '26.00', maxlength: 6, mode: 'text' }), { unit: '°C' })}
      ${field('Humidity low', inp('cmf_hm_lo', { title: '0.0..99.99%, default 30.00', value: '30.00', maxlength: 5 }), { unit: '%' })}
      ${field('Humidity high', inp('cmf_hm_hi', { title: '0.0..99.99%, default 60.00%', value: '60.00', maxlength: 5 }), { unit: '%' })}
    </div>
    ${withButtons
      ? html`<p class="muted small">Used when “Comfort indicator” is enabled in the configuration.</p>
        <div class="actions">${btn('Get comfort parameters', { cmd: '20' })}${btn('Set comfort parameters', { action: 'sendCmf', kind: 'primary' })}</div>`
      : ''}`;
}

function applyScreenValues(cfg, hw) {
  if (cfg.ver >= 0x43) setChecked('cfg_scr_off', cfg.flg2 & 0x80);
  setVal('cfg_flg_adv_type', cfg.flg & 3);
  setChecked('cfg_flg_comfort', cfg.flg & 4);
  if (hw === 9 || hw === 12) {
    setChecked('cfg_flg_am_pm', cfg.flg & 32);
    setChecked('cfg_flg_x100', cfg.flg & 8);
    setVal('cfg_scr_type', cfg.flg2 & 7);
    if (cfg.ver > 0x48) {
      setChecked('cfg_flg3_weekday', (cfg.temp_offset & 128) === 0);
      if (hw === 12) setChecked('cfg_flg3_ddmm', cfg.temp_offset & 64);
    }
    setChecked('adv_flags', cfg.flg2 & 0x10);
    setChecked('bt5_flags', cfg.flg2 & 0x20);
    setChecked('longrange_flags', cfg.flg2 & 0x40);
  } else if (hw === 49) {
    setChecked('cfg_flg_am_pm', cfg.flg & 32);
    setChecked('cfg_flg_show_batt', cfg.flg & 8);
    setVal('cfg_smiley', cfg.flg2 & 7);
    setChecked('cfg_flg3_weekday', cfg.temp_offset & 128);
    setChecked('adv_flags', cfg.flg2 & 0x10);
    setChecked('bt5_flags', cfg.flg2 & 0x20);
    setChecked('longrange_flags', cfg.flg2 & 0x40);
  } else {
    setChecked('cfg_flg_blinking', cfg.flg & 8);
    setChecked('cfg_flg_show_batt', cfg.flg & 32);
    setVal('cfg_smiley', cfg.flg2 & 7);
    if (cfg.ver === 0x19) setChecked('cfg_flg2_memo', cfg.flg2 & 8);
    if (cfg.ver >= 0x30) setChecked('adv_flags', cfg.flg2 & 0x10);
    if (cfg.ver >= 0x36) {
      setChecked('bt5_flags', cfg.flg2 & 0x20);
      if (cfg.ver >= 0x42) setChecked('longrange_flags', cfg.flg2 & 0x40);
      else if (cfg.ver < 0x40) setChecked('csa2_flags', cfg.flg2 & 0x40);
    }
    setVal('cfg_lcd_tint', (cfg.lcd_tint * 0.05).toFixed(2));
  }
  setVal('cfg_flg_cf', (cfg.flg & 16) !== 0 ? 1 : 0);
  setChecked('cfg_flg_tx_meas', cfg.flg & 64);
  setChecked('cfg_flg_lp_meas', cfg.flg & 128);
  if (cfg.ver >= 0x22) setChecked('cfg_adv_crypto', cfg.flg2 & 0x08);
  if (cfg.ver >= 0x20) setVal('cfg_av_meas_mem', String(cfg.av_meas_mem));
  applyCommonValues(cfg);
}

function applyPlainValues(cfg) {
  setVal('cfg_flg_adv_type', cfg.flg & 3);
  setChecked('adv_flags', cfg.flg2 & 0x10);
  setChecked('bt5_flags', cfg.flg2 & 0x20);
  setChecked('longrange_flags', cfg.flg2 & 0x40);
  setChecked('cfg_flg_tx_meas', cfg.flg & 64);
  if (cfg.ver >= 0x48) setChecked('cfg_flg_lp_meas', cfg.flg & 128);
  setChecked('cfg_adv_crypto', cfg.flg2 & 0x08);
  setVal('cfg_av_meas_mem', String(cfg.av_meas_mem));
  applyCommonValues(cfg);
}

function applyCommonValues(cfg) {
  if (cfg.ver < 0x47) {
    setVal('cfg_tmp_off', (cfg.temp_offset / 10.0).toFixed(1));
    setVal('cfg_hm_off', (cfg.humi_offset / 10.0).toFixed(1));
  } else if (cfg.ver > 0x50) {
    setVal('cfg_flg3_adv_delay', String(cfg.temp_offset & 15));
    setVal('cfg_event_adv_cnt', String(cfg.humi_offset));
  }
  setVal('cfg_adv_int', (cfg.advertising_interval * 62.5).toFixed(1));
  setVal('cfg_meas_int', String(cfg.measure_interval));
  setVal('cfg_rf_tx', String(cfg.rf_tx_power));
  setVal('cfg_con_lat', String((cfg.connect_latency + 1) * 20));
  for (const id of ['cfg_adv_int', 'cfg_meas_int', 'cfg_av_meas_mem']) {
    const el = $(id);
    if (el) el.dataset.change = 'infoIntervals';
  }
}

/** Show the effective measurement and history periods next to the inputs. */
export function InfoIntervals() {
  let advn = parseFloat(getVal('cfg_adv_int'));
  const meas = parseInt(getVal('cfg_meas_int'), 10);
  const mEl = $('cfg_meas_int_val');
  if (!Number.isFinite(advn) || !Number.isFinite(meas) || advn === 0 || meas === 0) {
    if (mEl) mEl.textContent = '';
    return;
  }
  advn = Math.round(advn / 62.5) * 62.5;
  if (mEl) mEl.textContent = `= ${((advn * meas) / 1000).toFixed(1)} s`;
  const aEl = $('cfg_av_meas_mem_val');
  if (S.cfg.ver >= 0x20 && aEl) {
    const memo = parseInt(getVal('cfg_av_meas_mem'), 10);
    if (Number.isFinite(memo) && memo !== 0) {
      const x = (advn * meas * memo) / 1000;
      aEl.textContent = x < 60 ? `= ${x.toFixed(1)} s` : `= ${x.toFixed(1)} s = ${(x / 60).toFixed(1)} min`;
    } else aEl.textContent = '= off';
  }
}

// ---------------------------------------------------------------------------
// Sending the configuration (port of SendCustomConfig)

const num = (id, parse, fallback) => {
  const v = parse(getVal(id, ''));
  return Number.isFinite(v) ? v : fallback;
};
const flt = (id, fallback) => num(id, parseFloat, fallback);
const int = (id, fallback) => num(id, (s) => parseInt(s, 10), fallback);
/** Checkbox bit; when the control does not exist keep the current bit. */
const bit = (id, mask, current) => {
  const el = $(id);
  return el ? (el.checked ? mask : 0) : current & mask;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function buildCustomConfig() {
  const cfg = S.cfg;
  const hw = S.hwverId;
  // Values as read from the device: used when a control is not present in the form.
  const f0 = cfg.flg;
  const g0 = cfg.flg2;
  const t0 = cfg.temp_offset;
  const advType = int('cfg_flg_adv_type', f0 & 3) & 3;
  if (HW.hasScreenUi(hw)) {
    const cf = getVal('cfg_flg_cf', (f0 & 16) !== 0 ? '1' : '0') !== '0' ? 16 : 0;
    if (hw === 49) {
      cfg.flg = advType + bit('cfg_flg_comfort', 4, f0) + bit('cfg_flg_show_batt', 8, f0) + cf + bit('cfg_flg_am_pm', 32, f0) + bit('cfg_flg_tx_meas', 64, f0) + bit('cfg_flg_lp_meas', 128, f0);
      cfg.flg2 = (int('cfg_smiley', g0 & 7) & 7) + bit('cfg_adv_crypto', 0x08, g0) + bit('adv_flags', 0x10, g0) + bit('bt5_flags', 0x20, g0) + bit('longrange_flags', 0x40, g0) + bit('cfg_scr_off', 0x80, g0);
      cfg.temp_offset = bit('cfg_flg3_weekday', 128, t0);
    } else if (hw === 9 || hw === 12) {
      cfg.flg = advType + bit('cfg_flg_comfort', 4, f0) + bit('cfg_flg_x100', 8, f0) + cf + bit('cfg_flg_am_pm', 32, f0) + bit('cfg_flg_tx_meas', 64, f0) + bit('cfg_flg_lp_meas', 128, f0);
      cfg.flg2 = (int('cfg_scr_type', g0 & 7) & 7) + bit('cfg_adv_crypto', 0x08, g0) + bit('adv_flags', 0x10, g0) + bit('bt5_flags', 0x20, g0) + bit('longrange_flags', 0x40, g0);
      if (cfg.ver >= 0x43) cfg.flg2 += bit('cfg_scr_off', 0x80, g0);
      if (cfg.ver > 0x48) {
        // weekday is stored inverted (bit 7 set = hide weekday)
        cfg.temp_offset = exists('cfg_flg3_weekday') ? (getChecked('cfg_flg3_weekday') ? 0 : 128) : t0 & 128;
        if (hw === 12) cfg.temp_offset += bit('cfg_flg3_ddmm', 64, t0);
      }
    } else {
      cfg.flg = advType + bit('cfg_flg_comfort', 4, f0) + bit('cfg_flg_blinking', 8, f0) + cf + bit('cfg_flg_show_batt', 32, f0) + bit('cfg_flg_tx_meas', 64, f0) + bit('cfg_flg_lp_meas', 128, f0);
      let flg2 = int('cfg_smiley', g0 & 7) & 7;
      if (cfg.ver === 0x19) flg2 += bit('cfg_flg2_memo', 8, g0);
      if (cfg.ver >= 0x22) flg2 += bit('cfg_adv_crypto', 0x08, g0);
      if (cfg.ver >= 0x30) flg2 += bit('adv_flags', 0x10, g0);
      if (cfg.ver >= 0x36) {
        flg2 += bit('bt5_flags', 0x20, g0);
        if (cfg.ver >= 0x42) {
          flg2 += bit('longrange_flags', 0x40, g0);
          if (cfg.ver >= 0x43) flg2 += bit('cfg_scr_off', 0x80, g0);
        } else if (cfg.ver < 0x40) flg2 += bit('csa2_flags', 0x40, g0);
      }
      cfg.flg2 = flg2;
      cfg.lcd_tint = clamp(Math.round(flt('cfg_lcd_tint', cfg.lcd_tint * 0.05) / 0.05), 10, 255);
    }
  } else {
    cfg.flg = (f0 & 0xbc) + advType + bit('cfg_flg_tx_meas', 64, f0);
    if (cfg.ver >= 0x48) cfg.flg = (cfg.flg & 0x7f) + bit('cfg_flg_lp_meas', 128, f0);
    cfg.flg2 = (g0 & 0x87) + bit('cfg_adv_crypto', 0x08, g0) + bit('adv_flags', 0x10, g0) + bit('bt5_flags', 0x20, g0) + bit('longrange_flags', 0x40, g0);
  }
  if (cfg.ver >= 0x20) cfg.av_meas_mem = clamp(int('cfg_av_meas_mem', cfg.av_meas_mem), 0, 255);
  if (cfg.ver < 0x47) {
    cfg.temp_offset = clamp(Math.round(10.0 * flt('cfg_tmp_off', cfg.temp_offset / 10)), -127, 127);
    cfg.humi_offset = clamp(Math.round(10.0 * flt('cfg_hm_off', cfg.humi_offset / 10)), -127, 127);
  } else if (cfg.ver > 0x50) {
    const advDelay = clamp(int('cfg_flg3_adv_delay', cfg.temp_offset & 15), 0, 15);
    cfg.temp_offset = advDelay | (cfg.temp_offset & 0x0f0);
    let eventCnt = int('cfg_event_adv_cnt', cfg.humi_offset & 0xff);
    if (eventCnt < 6) eventCnt = 5;
    else if (eventCnt > 255) eventCnt = 255;
    cfg.humi_offset = eventCnt;
  }
  cfg.advertising_interval = clamp(Math.round(flt('cfg_adv_int', cfg.advertising_interval * 62.5) / 62.5), 1, 255);
  cfg.measure_interval = clamp(int('cfg_meas_int', cfg.measure_interval), 1, 255);
  let rf = int('cfg_rf_tx', cfg.rf_tx_power);
  if (rf & 0x80) rf = clamp(rf, 130, 191); // VANT
  else rf = clamp(rf, 23, 63); // VBAT
  cfg.rf_tx_power = rf;
  let lat = Math.round(flt('cfg_con_lat', (cfg.connect_latency + 1) * 20) / 20.0 - 1);
  lat = Math.max(0, lat);
  cfg.connect_latency = cfg.ver > 0x40 ? Math.min(lat, 49) : Math.min(lat, 200);

  const values = [cfg.flg, cfg.flg2, cfg.temp_offset & 0xff, cfg.humi_offset & 0xff, cfg.advertising_interval, cfg.measure_interval, cfg.rf_tx_power, cfg.connect_latency, cfg.lcd_tint];
  if (cfg.ver >= 0x20) values.push(cfg.hver & 0xff, cfg.av_meas_mem);
  return values;
}

export async function SendCustomConfig() {
  const values = buildCustomConfig();
  const cfg = S.cfg;
  log.info(`New custom config: [${values.slice(0, 9).join(', ')}${cfg.ver >= 0x20 ? ', ' + values.slice(9).join(', ') : ''}]`);
  const hexStr = '55' + values.map((v) => hex(v, 2)).join('');
  // Lock the form until the device echoes the new configuration (0x55 re-renders it).
  const pending = $('cfg-pending');
  if (pending) pending.hidden = false;
  const form = $('custcfg').querySelector('details[data-key="config"]');
  if (form) form.classList.add('is-pending');
  await sendCustomSetting(hexStr);
  setTimeout(() => {
    if (form && form.isConnected && form.classList.contains('is-pending')) {
      form.classList.remove('is-pending');
      if (pending) pending.hidden = true;
      log.warn('The device did not confirm the configuration. Press "Get config" to check.');
    }
  }, 5000);
}

// ---------------------------------------------------------------------------
// ZigbeeTLc (BLE mode) configuration

export function zbdeviceConfig() {
  renderFirmwarePanel();
  if (showSettingsLink()) return;
  setPanelTitle('Zigbee device settings');
  const cfg = S.cfg;
  const screen = (cfg.services & 0x20) !== 0;
  const ths = (cfg.services & 0x80) !== 0;
  const body = [];
  if (screen) {
    body.push(
      group(
        'Screen',
        html`${field('Temperature unit', select('cfg_flg_cf', [[0, '°C'], [1, '°F']], 0))}
          <div class="checks">${check('cfg_scr_off', 'Screen off', 'Screen Off')}${check('cfg_flg_comfort', 'Smiley')}</div>`,
      ),
    );
    body.push(group('Comfort parameters', comfortFields(false)));
  }
  const meas = [];
  if (ths) {
    meas.push(field('Temperature offset', inp('cfg_tmp_off', { title: '-327.67..327.67°, default 0', value: '0', maxlength: 6, mode: 'text' }), { unit: '°' }));
    meas.push(field('Humidity offset', inp('cfg_hm_off', { title: '-327.67..327.67%, default 0', value: '0', maxlength: 6, mode: 'text' }), { unit: '%' }));
  }
  meas.push(field('Measure interval', inp('cfg_meas_int', { title: '3..250 sec, default: 10 sec', value: '4', maxlength: 3 }), { unit: 's' }));
  body.push(group('Measurements', meas));
  body.push(html`<div class="actions">
    ${btn('Send config', { action: 'sendZbConfig', kind: 'primary' })}
    ${btn('Get config', { cmd: '57' })}
    ${btn('Set default', { cmd: '58', confirm: 'Restore the default configuration on the device?' })}
  </div>`);
  render(
    'custcfg',
    html`<div class="panel-stack">
      ${section('config', 'Zigbee device configuration', body, { open: true, sub: 'ZigbeeTLc firmware, BLE mode' })}
      ${consoleSection()}
    </div>`,
  );
  if (screen) {
    setVal('cmf_tmp_lo', (cfg.temp_comfort_min / 100.0).toFixed(2));
    setVal('cmf_tmp_hi', (cfg.temp_comfort_max / 100.0).toFixed(2));
    setVal('cmf_hm_lo', (cfg.humi_comfort_min / 100.0).toFixed(2));
    setVal('cmf_hm_hi', (cfg.humi_comfort_max / 100.0).toFixed(2));
    setVal('cfg_flg_cf', cfg.c_f & 1);
    setChecked('cfg_flg_comfort', cfg.showSmiley === 0);
    setChecked('cfg_scr_off', cfg.display_off !== 0);
  }
  if (ths) {
    setVal('cfg_tmp_off', (cfg.temp_offset / 100.0).toFixed(2));
    setVal('cfg_hm_off', (cfg.humi_offset / 100.0).toFixed(2));
  }
  setVal('cfg_meas_int', String(cfg.measure_interval));
}

export async function SendZbConfig() {
  const cfg = S.cfg;
  if ((cfg.services & 0x80) !== 0) {
    cfg.temp_offset = Math.round(100.0 * flt('cfg_tmp_off', cfg.temp_offset / 100));
    cfg.humi_offset = Math.round(100.0 * flt('cfg_hm_off', cfg.humi_offset / 100));
  }
  if ((cfg.services & 0x20) !== 0) {
    cfg.temp_comfort_min = Math.round(100.0 * flt('cmf_tmp_lo', cfg.temp_comfort_min / 100));
    cfg.temp_comfort_max = Math.round(100.0 * flt('cmf_tmp_hi', cfg.temp_comfort_max / 100));
    cfg.humi_comfort_min = Math.round(100.0 * flt('cmf_hm_lo', cfg.humi_comfort_min / 100));
    cfg.humi_comfort_max = Math.round(100.0 * flt('cmf_hm_hi', cfg.humi_comfort_max / 100));
    cfg.c_f = getVal('cfg_flg_cf', '0') !== '0' ? 1 : 0;
    cfg.showSmiley = getChecked('cfg_flg_comfort') ? 0 : 1;
    cfg.display_off = getChecked('cfg_scr_off') ? 1 : 0;
  }
  cfg.measure_interval = clamp(int('cfg_meas_int', cfg.measure_interval), 0, 255);
  let blk = null;
  if ((cfg.services & 0xa0) === 0xa0) {
    blk = [0x57, ...le16(cfg.temp_offset), ...le16(cfg.humi_offset), ...le16(cfg.temp_comfort_min), ...le16(cfg.temp_comfort_max), ...le16(cfg.humi_comfort_min), ...le16(cfg.humi_comfort_max), cfg.c_f, cfg.showSmiley, cfg.display_off, cfg.measure_interval];
  } else if ((cfg.services & 0xa0) === 0x80) {
    blk = [0x57, ...le16(cfg.temp_offset), ...le16(cfg.humi_offset), cfg.measure_interval];
  }
  if (!blk) {
    log.warn('This device has no configurable parameters.');
    return;
  }
  log.debug('Send config...');
  await writeSettings(new Uint8Array(blk));
  log.info('Send config: ' + dump(blk) + ' - ok');
}

// ---------------------------------------------------------------------------
// Custom value on the screen (ext data), comfort, trigger

export function UpdExt() {
  const ext = S.ext;
  const hw = S.hwverId;
  if (!ext.enable || !getVal('extbignumb')) return;
  if (hw === 9 || hw === 12 || hw === 49) {
    setVal('extbignumb', (ext.big_number / 100.0).toFixed(2));
    setVal('exttmpsmb', (ext.flg >> 4) & 0x07);
    setChecked('extpersent', ext.flg & 0x80);
    setChecked('extbattery', ext.flg & 8);
  } else {
    setVal('extbignumb', (ext.big_number / 10.0).toFixed(1));
    if (HW.isQingpingLcd(hw)) setVal('extsmalnumb', (ext.small_number / 10.0).toFixed(1));
    else setVal('extsmalnumb', ext.small_number.toFixed(0));
    setChecked('extpersent', ext.flg & 8);
    setVal('exttmpsmb', (ext.flg >> 5) & 0x07);
    setChecked('extbattery', ext.flg & 16);
  }
  setVal('extsmiley', ext.flg & 7);
  setVal('extvtimed', ext.vtime);
}

function requireNumbers(map) {
  const bad = Object.entries(map).filter(([, v]) => !Number.isFinite(v));
  if (bad.length) {
    const msg = `Invalid number in: ${bad.map(([k]) => k).join(', ')}`;
    log.error(msg);
    toast(msg, 'warn');
    return false;
  }
  return true;
}

export async function sendExt() {
  const ext = S.ext;
  const hw = S.hwverId;
  if (!ext.enable) return;
  const big = parseFloat(getVal('extbignumb'));
  const vtime = parseInt(getVal('extvtimed'), 10);
  const smiley = parseInt(getVal('extsmiley'), 10) & 7;
  const smb = parseInt(getVal('exttmpsmb'), 10) & 7;
  let blk;
  if (hw === 9 || hw === 12 || hw === 49) {
    if (!requireNumbers({ 'big number': big, 'show time': vtime })) return;
    ext.big_number = Math.round(100.0 * big);
    ext.cfg = smiley + (getChecked('extbattery') ? 8 : 0) + (getChecked('extpersent') ? 0x80 : 0) + (smb << 4);
  } else {
    const smallRaw = getVal('extsmalnumb');
    const small = HW.isQingpingLcd(hw) ? Math.round(10.0 * parseFloat(smallRaw)) : parseInt(smallRaw, 10);
    if (!requireNumbers({ 'big number': big, 'small number': small, 'show time': vtime })) return;
    ext.big_number = Math.round(10.0 * big);
    ext.small_number = small;
    ext.cfg = smiley + (getChecked('extpersent') ? 8 : 0) + (getChecked('extbattery') ? 16 : 0) + (smb << 5);
  }
  ext.vtime = clamp(vtime, 2, 65535);
  if (hw === 9 || hw === 12 || hw === 49) blk = [0x22, ...le32(ext.big_number), ...le16(ext.vtime), ext.cfg];
  else blk = [0x22, ...le16(ext.big_number), ...le16(ext.small_number), ...le16(ext.vtime), ext.cfg];
  blk = new Uint8Array(blk);
  log.debug('Send cmd (22 + ext data)...');
  await writeSettings(blk);
  log.info('Send Ext data: ' + dump(blk) + ' ok');
}

export function UpdCmf() {
  const cmf = S.cmf;
  if (!cmf.enable || !getVal('cmf_tmp_lo')) return;
  setVal('cmf_tmp_lo', (cmf.tmp_lo / 100.0).toFixed(2));
  setVal('cmf_tmp_hi', (cmf.tmp_hi / 100.0).toFixed(2));
  setVal('cmf_hm_lo', (cmf.hm_lo / 100.0).toFixed(2));
  setVal('cmf_hm_hi', (cmf.hm_hi / 100.0).toFixed(2));
}

export async function SendCmf() {
  const cmf = S.cmf;
  if (!cmf.enable) return;
  const v = {
    'temperature low': parseFloat(getVal('cmf_tmp_lo')),
    'temperature high': parseFloat(getVal('cmf_tmp_hi')),
    'humidity low': parseFloat(getVal('cmf_hm_lo')),
    'humidity high': parseFloat(getVal('cmf_hm_hi')),
  };
  if (!requireNumbers(v)) return;
  cmf.tmp_lo = Math.round(100.0 * v['temperature low']);
  cmf.tmp_hi = Math.round(100.0 * v['temperature high']);
  cmf.hm_lo = Math.round(100.0 * v['humidity low']);
  cmf.hm_hi = Math.round(100.0 * v['humidity high']);
  log.debug('Send cmd (20 + cmf data)...');
  await writeSettings(new Uint8Array([0x20, ...le16(cmf.tmp_lo), ...le16(cmf.tmp_hi), ...le16(cmf.hm_lo), ...le16(cmf.hm_hi)]));
  log.info('Send Cmf data ok');
}

export function UpdTrg() {
  const trg = S.trg;
  const cfg = S.cfg;
  if (!trg.enable || !getVal('trg_tmp_hst')) return;
  setVal('trg_tmp_thr', trg.tmp_thr.toFixed(2));
  setVal('trg_hm_thr', trg.hm_thr.toFixed(2));
  setVal('trg_tmp_hst', trg.tmp_hst.toFixed(2));
  setVal('trg_hm_hst', trg.hm_hst.toFixed(2));
  if (cfg.ver >= 0x37) {
    setVal('rds_rpint', trg.rds_rpint);
    setVal('rds_type', trg.rds_type & 3);
    if (trg.rds2_enable) setVal('rds2_type', (trg.rds_type >> 2) & 3);
  }
  if (cfg.ver >= 0x39) {
    setChecked('rds_invert', trg.rds_type & 0x10);
    if (trg.rds2_enable) setChecked('rds2_invert', trg.rds_type & 0x20);
  }
}

export async function sendTrg() {
  const trg = S.trg;
  const cfg = S.cfg;
  if (!trg.enable) return;
  const v = {
    'temperature threshold': parseFloat(getVal('trg_tmp_thr')),
    'humidity threshold': parseFloat(getVal('trg_hm_thr')),
    'temperature hysteresis': parseFloat(getVal('trg_tmp_hst')),
    'humidity hysteresis': parseFloat(getVal('trg_hm_hst')),
  };
  if (cfg.ver >= 0x37) v['RS report interval'] = parseInt(getVal('rds_rpint', '0'), 10);
  if (!requireNumbers(v)) return;
  trg.tmp_thr = Math.round(100.0 * v['temperature threshold']);
  trg.hm_thr = Math.round(100.0 * v['humidity threshold']);
  let blk;
  if (cfg.ver >= 0x26) {
    trg.tmp_hst = Math.round(100.0 * v['temperature hysteresis']);
    trg.hm_hst = Math.round(100.0 * v['humidity hysteresis']);
    log.debug('Send cmd (44 + trg data)...');
    if (cfg.ver >= 0x37) {
      trg.rds_rpint = v['RS report interval'];
      trg.rds_type = getVal('rds_type', '0') & 3;
      if (trg.rds2_enable) trg.rds_type |= (getVal('rds2_type', '0') & 3) << 2;
      if (cfg.ver >= 0x39) {
        if (trg.rds_type === 3) trg.rds_type += 0x10;
        else trg.rds_type += getChecked('rds_invert') ? 0x10 : 0;
        if (trg.rds2_enable) trg.rds_type += getChecked('rds2_invert') ? 0x20 : 0;
      }
      blk = [0x44, ...le16(trg.tmp_thr), ...le16(trg.hm_thr), ...le16(trg.tmp_hst), ...le16(trg.hm_hst), ...le16(trg.rds_rpint), trg.rds_type];
    } else {
      blk = [0x44, ...le16(trg.tmp_thr), ...le16(trg.hm_thr), ...le16(trg.tmp_hst), ...le16(trg.hm_hst)];
    }
  } else {
    trg.tmp_hst = Math.round(10.0 * v['temperature hysteresis']);
    trg.hm_hst = Math.round(10.0 * v['humidity hysteresis']);
    log.debug('Send cmd (44 + trg data)...');
    blk = [0x44, ...le16(trg.tmp_thr), ...le16(trg.hm_thr), trg.tmp_hst & 0xff, trg.hm_hst & 0xff];
  }
  blk = new Uint8Array(blk);
  await writeSettings(blk);
  log.info('Send Trg data: ' + dump(blk) + ' -ok');
}

// ---------------------------------------------------------------------------
// Keys, PIN code, name, MAC

export async function sendPinCode() {
  if (!S.pincode.enable) return;
  const el = $('pincode');
  const value = el.value.trim();
  if (!/^\d{6}$/.test(value)) {
    log.error("PIN code must be 6 decimal digits (000000..999999); '000000' disables the PIN code.");
    toast('PIN code must be exactly 6 digits', 'warn');
    return;
  }
  const x = parseInt(value, 10);
  if (x !== 0) {
    const ok = await confirmDialog(`Set the PIN code to ${value}?\nIf you forget it, the device can only be recovered with a wired (UART) flasher.`, {
      title: 'Set PIN code',
      ok: 'Set PIN code',
      danger: true,
    });
    if (!ok) return;
  }
  log.info(`PinCode: '${value}'`);
  await writeSettings(new Uint8Array([0x70, ...le32(x)]));
  log.info('Send pincode ok');
}

export async function cleanDevName() {
  log.debug('Send cmd (0100) Clean DevName...');
  await writeSettings(new Uint8Array([0x01, 0]));
  log.info('Send Clean DevName ok');
}

export async function sendDevName() {
  if (!S.dnm.enable) return;
  const el = $('dev_name');
  const bytes = new TextEncoder().encode(el.value);
  const max = el.maxLength > 0 ? el.maxLength : 18;
  if (bytes.length < 1 || bytes.length > max) {
    log.error(`Device name must be 1..${max} bytes`);
    toast(`Device name must be 1..${max} characters`, 'warn');
    return;
  }
  const blk = new Uint8Array(bytes.length + 1);
  blk[0] = 0x01;
  blk.set(bytes, 1);
  log.debug('Send cmd New DevName (' + dump(blk) + ')...');
  await writeSettings(blk);
  log.info('Send New DevName ok');
}

export async function cleanMAC() {
  log.debug('Send cmd Clean MAC (1000)...');
  await writeSettings(new Uint8Array([0x10, 0]));
  log.info('Send Clean MAC ok');
}

export async function sendMAC() {
  if (!S.mikeys.mac) {
    log.warn('Read the current MAC first ("Get MAC").');
    toast('Read the current MAC first (Get MAC)', 'warn');
    return;
  }
  const clean = getVal('mi_mac').replace(/[\s:-]/g, '');
  const mac = (clean.length === 12 || clean.length === 16) && parseHex(clean);
  if (!mac) {
    log.error('Must be 6 hex MAC bytes [+ 2 hex RandMAC bytes]!');
    toast('MAC must be 12 (or 16) hex digits', 'warn');
    return;
  }
  const ok = await confirmDialog(`Change the device MAC to ${dump(mac, 6)}?\nIf a PIN code is set, restart both the browser and the device before the next connection.`, {
    title: 'Set MAC address',
    ok: 'Set MAC',
    danger: true,
  });
  if (!ok) return;
  const len = mac.length;
  const blk = new Uint8Array(len + 2);
  blk[0] = 0x10;
  blk[1] = len;
  blk[2] = mac[5];
  blk[3] = mac[4];
  blk[4] = mac[3];
  blk[5] = mac[2];
  blk[6] = mac[1];
  blk[7] = mac[0];
  if (len === 8) {
    blk[8] = mac[7];
    blk[9] = mac[6];
  }
  log.debug('Send cmd New MAC (' + dump(blk) + ')...');
  await writeSettings(blk);
  log.info('Send New MAC: ' + dump(mac, 6) + (len === 8 ? ' RAND:' + dump(mac.slice(6), 2) : '') + ' ok');
}

export async function setNewTBKey() {
  const bkey = parseHex(getVal('mi_bind_key').trim(), 16);
  if (!bkey) {
    log.error('Bind key must be 32 hex characters (16 bytes)!');
    return;
  }
  const token = parseHex(getVal('mi_token').trim(), 12);
  if (!token) {
    log.error('Mi token must be 24 hex characters (12 bytes)!');
    return;
  }
  const blk = new Uint8Array(29);
  blk[0] = 0x12;
  blk.set(token, 1);
  blk.set(bkey, 13);
  log.debug('Send cmd MtuSizeExchange (7120)');
  await writeSettings(new Uint8Array([0x71, 0x20]));
  log.debug('Send cmd New bindkey (' + dump(blk) + ')...');
  await writeSettings(blk);
  log.info('Send cmd New keys ok');
}

export async function getBKey() {
  await writeSettings(new Uint8Array([0x18]));
  log.info('Get bindkey from EEP...');
}

export async function setBKey() {
  const bkey = parseHex(getVal('cbind_key').trim(), 16);
  if (!bkey) {
    log.error('Bind key must be 32 hex characters (16 bytes)!');
    toast('Bind key must be 32 hex characters', 'warn');
    return;
  }
  const blk = new Uint8Array(17);
  blk[0] = 0x18;
  blk.set(bkey, 1);
  log.debug('Send bindkey to EEP...');
  await writeSettings(blk);
  log.info('Send new bindkey: ' + dump(bkey).toLowerCase());
}

// ---------------------------------------------------------------------------
// Time, history, TrSc, LCD test

export async function setDevTime() {
  const time = Math.floor(Date.now() / 1000 - new Date().getTimezoneOffset() * 60);
  const blk = new Uint8Array([0x23, ...le32(time)]);
  log.debug('Send cmd Set DevTime (' + dump(blk) + ')...');
  await writeSettings(blk);
  log.info('Send new DevTime ok');
}

export async function calkDeltaTime() {
  S.devtime.step = 1;
  log.debug('Send cmd Get DevTime...');
  await writeSettings(new Uint8Array([0x23]));
  log.info('Get DevTime...');
}

export async function sendDeltaTime() {
  const dtim = parseInt(getVal('cfg_time_step'), 10);
  if (dtim > -32768 && dtim < 32768) {
    log.debug(`Send cmd set delta (24 + delta: ${dtim})...`);
    await writeSettings(new Uint8Array([0x24, ...le16(dtim)]));
    log.info('Send delta time ok');
    await setDevTime();
  } else {
    log.error('Delta time must be -32767 to 32767!');
  }
}

export async function sendGetMemo(cnt) {
  let count = cnt & 0x7fff;
  if (count > 19632) count = 19632;
  const start = 0;
  const blk = new Uint8Array([0x35, ...le16(count), ...le16(start)]);
  S.memo = [];
  S.flgMemoAct = true;
  renderMemoActions();
  log.debug('Send cmd GetMemo: (' + dump(blk) + ')...');
  await writeSettings(blk);
  log.info('Send cmd GetMemo ok');
}

export function renderMemoActions() {
  const el = $('memo-actions');
  if (el) el.hidden = S.flgMemoAct || S.memo.length === 0;
}

export function downloadMemo() {
  if (!S.memo.length) return;
  const rows = ['count,time_utc_device_local,temperature_c,humidity_pct,vbat_mv'];
  for (const r of S.memo) rows.push([r.cnt, new Date(r.time * 1000).toISOString().replace('.000Z', ''), r.temp, r.humi, r.vbat].join(','));
  downloadText(`memo-${(S.device && S.device.name) || 'device'}-${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\n'), 'text/csv');
}

export async function getTrScConfig() {
  await writeSettings(new Uint8Array([0x21]));
  log.info('Get TrSc parameters...');
}

export async function setTrScConfig() {
  const clean = getVal('trsc_mac').replace(/[\s:-]/g, '');
  const mac = clean.length === 12 && parseHex(clean, 6);
  const interval = parseInt(getVal('trsc_int'), 10);
  if (!mac) {
    log.error('Must be 6 hex MAC bytes!');
    return;
  }
  if (!Number.isFinite(interval) || interval < 0) {
    log.error('Interval must be a positive number of seconds');
    return;
  }
  const blk = new Uint8Array([0x21, ...le32(interval), mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]]);
  log.debug('Send TrSc parameters (' + dump(blk) + ')...');
  await writeSettings(blk);
  log.info(`Send TrSc parameters: interval: ${interval} sec,  MAC: ${dump(mac, 6)} ok`);
}

export async function lcdClock() {
  const date = new Date();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const lcdb = new Uint8Array(7);
  lcdb[0] = 0x60;
  lcdb[1] = LCD_DIGCODE[minutes % 10];
  lcdb[2] = LCD_DIGCODE[Math.floor(minutes / 10)];
  lcdb[4] = LCD_DIGCODE[hours % 10];
  lcdb[5] = LCD_DIGCODE[Math.floor(hours / 10)];
  log.debug('Send cmd (60): Set LCD data');
  await writeSettings(lcdb);
  log.info("Send 'Send clock data on LCD' ok");
}

export async function lcdRestore() {
  log.debug('Send cmd (6100): Restore show LCD');
  await writeSettings(new Uint8Array([0x61, 0]));
  log.info("Send 'Repair LCD' ok");
}

// ---------------------------------------------------------------------------
// Sensor calibration (incl. MY18B20 second sensor and SCD41 CO2 sensor)

export async function setSensCfg() {
  const v = {
    Tk: parseFloat(getVal('inpTempK')),
    Hk: parseFloat(getVal('inpHumK')),
    Tz: parseFloat(getVal('inpTempZ')),
    Hz: parseFloat(getVal('inpHumZ')),
  };
  if (!requireNumbers(v)) return;
  const d = S.devSens;
  d.temp_k = Math.round(100.0 * v.Tk);
  d.humi_k = Math.round(100.0 * v.Hk);
  d.temp_z = Math.round(100.0 * v.Tz);
  d.humi_z = Math.round(100.0 * v.Hz);
  const blk = new Uint8Array([0x25, ...le32(d.temp_k), ...le32(d.humi_k), ...le16(d.temp_z), ...le16(d.humi_z)]);
  await writeSettings(blk);
  log.info('Send Sensor Settings: ' + dump(blk) + ' - ok');
}

export async function getSensCfg() {
  log.info('Get Sensor Settings...');
  await writeSettings(new Uint8Array([0x25]));
}

export async function resetSensCfg() {
  log.info('Restore Sensor Default Settings...');
  await writeSettings(new Uint8Array([0x26]));
}

export async function setSens2Cfg() {
  const v = { Tk: parseFloat(getVal('inpTemp2K')), Tz: parseFloat(getVal('inpTemp2Z')) };
  if (!requireNumbers(v)) return;
  const d = S.devSens;
  d.temp2_k = Math.round(100.0 * v.Tk);
  d.temp2_z = Math.round(100.0 * v.Tz);
  const blk = new Uint8Array([0x27, ...le32(d.temp2_k), ...le16(d.temp2_z)]);
  await writeSettings(blk);
  log.info('Send Sensor2 Settings: ' + dump(blk) + ' - ok');
}

export async function getSens2Cfg() {
  log.info('Get Sensor2 Settings...');
  await writeSettings(new Uint8Array([0x27]));
}

export async function resetSens2Cfg() {
  log.info('Restore Sensor2 Default Settings...');
  await writeSettings(new Uint8Array([0x28]));
}

export function addMenuSensors() {
  const host = $('addSensors');
  if (!host || S.devSens.sentype !== 14) return;
  const f = (id, label, unit, title = '') => field(label, inp(id, { title, maxlength: 16 }), { unit });
  render(
    host,
    html`<fieldset class="group"><legend>SCD41 CO₂ sensor</legend>
      <div class="form-grid">
        ${field('Temperature offset', inp('inpSCD4xTempOffset', { maxlength: 16, mode: 'text' }), { unit: '°C' })}
        ${f('inpSCD4xAltitude', 'Altitude', 'm')}
        ${f('inpSCD4xPressure', 'Pressure', 'Pa')}
        <div class="checks">${check('chbSDC41asc', 'Automatic self calibration (ASC)')}</div>
        ${f('inpSCD4xAscCo2', 'ASC target CO₂', 'ppm')}
        ${f('inpSCD4xInitPeriod', 'ASC initial period', '')}
        ${f('inpSCD4xStdPeriod', 'ASC standard period', '')}
      </div>
      <div class="actions">
        ${btn('Get sensor settings', { action: 'getSensSCD4x' })}
        ${btn('Send sensor settings', { action: 'setSensSCD4x', kind: 'primary' })}
        ${btn('Set default', { action: 'setDefCfgSCD4x' })}
      </div>
      <h4>Chip functions</h4>
      <div class="actions">
        ${btn('Forced recalibration', { action: 'fnSensSCD4x', arg: 2 })}
        <span class="input-unit">${inp('inpSCD4xPFRecal', { value: '400', maxlength: 16 })}<em>ppm</em></span>
      </div>
      <div class="actions">
        ${btn('Read current settings', { action: 'fnSensSCD4x', arg: 3, title: 'Read the current settings from the SCD41' })}
        ${btn('Read settings from EEPROM', { action: 'fnSensSCD4x', arg: 5, title: 'Reinitialize the sensor by reloading user settings from EEPROM' })}
        ${btn('Write settings to EEPROM', { action: 'fnSensSCD4x', arg: 4, title: 'Store the current configuration in the EEPROM of the SCD4x' })}
        ${btn('Self test', { action: 'fnSensSCD4x', arg: 7, title: 'End-of-line test to check the sensor functionality' })}
        ${btn('Factory reset', { action: 'fnSensSCD4x', arg: 6, kind: 'danger', title: 'Reset all configuration stored in the EEPROM and erase the FRC and ASC history', confirm: 'Factory reset the SCD41 sensor? This erases its calibration history.' })}
        ${btn('Read run status', { action: 'fnSensSCD4x', arg: 0 })}
      </div>
      <p><b id="txtSCD4xResponse">Response: ?</b></p>
    </fieldset>`,
  );
  if (S.devSens.altitude == null) getSensSCD4x();
}

export async function getSensSCD4x() {
  if (!S.settingsChar) return;
  log.info('Get Sensor SCD41 Settings...');
  await writeSettings(new Uint8Array([0x2e])).catch((err) => log.error('Get Sensor SCD41 Settings Error: ' + err));
}

export async function setDefCfgSCD4x() {
  log.info('Set Default SCD41 Settings...');
  await writeSettings(new Uint8Array([0x2f]));
}

export async function setSensSCD4x() {
  const d = S.devSens;
  const v = {
    'temperature offset': parseFloat(getVal('inpSCD4xTempOffset')),
    altitude: parseInt(getVal('inpSCD4xAltitude'), 10),
    pressure: parseInt(getVal('inpSCD4xPressure'), 10),
    'ASC CO2': parseInt(getVal('inpSCD4xAscCo2'), 10),
    'initial period': parseInt(getVal('inpSCD4xInitPeriod'), 10),
    'standard period': parseInt(getVal('inpSCD4xStdPeriod'), 10),
  };
  if (!requireNumbers(v)) return;
  d.temp_offset = Math.round((v['temperature offset'] * 65535.0) / 175.0);
  d.altitude = v.altitude;
  d.pressure = v.pressure / 100;
  d.asc_co2 = v['ASC CO2'];
  d.asc_ena = getChecked('chbSDC41asc') ? 1 : 0;
  d.asc_ini_per = v['initial period'];
  d.asc_std_per = v['standard period'];
  const blk = new Uint8Array([
    0x2e, ...le16(d.temp_offset), ...le16(d.altitude), ...le16(d.asc_co2), d.asc_ena & 1, 0, ...le16(d.asc_ini_per), ...le16(d.asc_std_per), ...le16(d.pressure),
  ]);
  await writeSettings(blk);
  log.info('Send Sensor SCD41 Settings: ' + dump(blk) + ' - ok');
}

export async function fnSensSCD4x(cmdArg) {
  const cmd = parseInt(cmdArg, 10);
  const resp = $('txtSCD4xResponse');
  if (cmd === 0) {
    if (resp) resp.textContent = 'Wait response...';
    await writeSettings(new Uint8Array([0x77]));
    log.info('Get run status SCD41 - ok');
  } else if (cmd > 0 && cmd < 8) {
    let arg = 0;
    if (cmd === 2) {
      arg = parseInt(getVal('inpSCD4xPFRecal'), 10) || 0;
      if (resp) resp.textContent = 'Wait response (2 minutes)...';
    } else if (resp) resp.textContent = 'Wait response...';
    const blk = new Uint8Array([0x77, cmd & 0xff, ...le16(arg)]);
    await writeSettings(blk);
    log.info('Send Command to SCD41: ' + dump(blk) + ' - ok');
  }
}

// ---------------------------------------------------------------------------
// ATC1441 firmware (legacy single-byte commands + LCD segment mapper)

export function renderAtc1441Panel() {
  if (showSettingsLink()) return;
  setPanelTitle('ATC1441 firmware');
  const c = (label, cmd) => btn(label, { cmd, kind: 'small' });
  const row = (label, items) => html`<div class="cmd-row"><span>${label}</span><div class="actions">${items}</div></div>`;
  const bytes = [0, 1, 2, 3, 4, 5].map(
    (b) => html`<div class="mapper-row"><span>Byte ${b}</span>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => html`<label class="check tiny"><input type="checkbox" id="check${b}${i}"><span>${i}</span></label>`)}</div>`,
  );
  render(
    'custcfg',
    html`<div class="panel-stack">
      <div class="callout"><b>ATC1441 firmware detected.</b> For OTA you can also use
        <a href="${SOURCES.atc1441Flasher}" target="_blank" rel="noopener">atc1441's TelinkFlasher</a> or
        <a href="ota.html" target="_blank" rel="noopener">Generic OTA</a>.</div>
      ${section(
        'atc',
        'Settings',
        html`${row('Settings', html`${c('Save current settings to flash', 'DF')}${c('Reset settings to default', 'DE')}`)}
          ${row('Smiley', html`${c('Off', 'A0')}${c('Happy', 'A1')}${c('Sad', 'A2')}${c('Blinking', 'AB')}${c('Comfort indicator', 'A3')}`)}
          ${row('Advertising type', html`${c('Custom', 'AE')}${c('Mi like', 'AF')}`)}
          ${row('Display', html`${c('°C', 'CC')}${c('°F', 'FF')}`)}
          ${row('Advertise', html`${c('°C', '0C')}${c('°F', '0F')}`)}
          ${row('Battery on LCD', html`${c('Enabled', 'B1')}${c('Disabled', 'B0')}`)}
          ${row('Advertising interval', html`${c('10 s', 'FE01')}${c('1 min', 'FE06')}${c('5 min', 'FE1E')}${c('10 min', 'FE3C')}`)}
          ${row('Sensor offset', html`${c('Temp 0 °C offset', 'FA00')}${c('Humi 0 % offset', 'FB00')}`)}
          <p class="muted small">For a precise offset use the console: FA + int8 hex for temperature (0.1 °C), FB + int8 hex for humidity.</p>
          ${row('Instant advertising', html`${c('Temp 0.5 °C alarm', 'FC05')}${c('Humi 5 % alarm', 'FD05')}`)}
          <p class="muted small">Other values: FC + uint8 (temperature / 10) or FD + uint8 (humidity) to advertise immediately when the reading changes faster than that.</p>`,
        { open: true },
      )}
      ${section('mapper', 'LCD segment mapper', html`<div class="mapper">${bytes}</div><div class="actions">${btn('Send bytes', { action: 'mapperSend', kind: 'primary' })}</div>`)}
      ${consoleSection()}
    </div>`,
  );
}

export async function mapperSend() {
  let s = 'dd';
  for (let b = 0; b < 6; b++) {
    let v = 0;
    for (let i = 0; i < 8; i++) if (getChecked(`check${b}${i}`)) v |= 1 << i;
    s += v.toString(16).padStart(2, '0');
  }
  log.info('Sending Segment bytes: ' + s);
  await sendCustomSetting(s);
}

/** Small helper used by the "Get last records" button. */
export async function getMemoFromInput() {
  const n = parseInt(getVal('memo_count', '50'), 10);
  if (!Number.isFinite(n) || n < 1) {
    toast('Enter the number of records (1..19632)', 'warn');
    return;
  }
  await sendGetMemo(n);
}

