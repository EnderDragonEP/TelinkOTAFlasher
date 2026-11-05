// Application entry point: wires the static page to the modules.
import { APP, NAME_PREFIXES } from './config.js';
import { S } from './state.js';
import { installGattQueue, webBluetoothSupport } from './ble.js';
import { log, initLog, clearLog, logAsText } from './log.js';
import { $, getVal, registerActions, bindDelegation, toast, copyText, downloadText, setStatus } from './ui.js';
import { connect, disconnect, reconnect, updateButtons } from './connection.js';
import { sendCustomSetting } from './custom.js';
import * as mi from './mi.js';
import * as st from './settings.js';
import * as qp from './qingping.js';
import { loadIndexes, loadIndexed, loadFromUrl, startDFU, clearFirmware, abortOta, initFirmwareInputs } from './flasher.js';

const store = {
  get(k, d = null) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const btn = $('theme-toggle');
  if (btn) btn.setAttribute('aria-label', `Theme: ${theme || 'system'}`);
  if (btn) btn.title = `Theme: ${theme || 'system'} (click to change)`;
}

function toggleTheme() {
  const order = [null, 'light', 'dark'];
  const cur = store.get('theme');
  const next = order[(order.indexOf(cur) + 1) % order.length];
  if (next) store.set('theme', next);
  else {
    try {
      localStorage.removeItem('theme');
    } catch {
      /* ignore */
    }
  }
  applyTheme(next);
  toast(`Theme: ${next || 'system'}`);
}

function showSupportBanner() {
  const support = webBluetoothSupport();
  const el = $('support-banner');
  if (support.ok) return;
  el.hidden = false;
  if (support.reason === 'insecure') {
    el.innerHTML = '<b>Web Bluetooth needs a secure page.</b> Open this flasher over <code>https://</code> (GitHub Pages does this) or from <code>http://localhost</code>.';
  } else {
    el.innerHTML =
      '<b>This browser does not support Web Bluetooth.</b> Use Chrome, Edge or Opera on Windows, macOS, Linux, ChromeOS or Android. ' +
      'On iOS use the <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy</a> browser. ' +
      'On Linux you may need to enable <code>chrome://flags/#enable-experimental-web-platform-features</code>.';
  }
  $('btn-connect').disabled = true;
}

function initPrefix() {
  const input = $('namePrefix');
  input.value = store.get('namePrefix', '');
  input.addEventListener('change', () => store.set('namePrefix', input.value.trim()));
  const chips = $('prefix-chips');
  for (const p of NAME_PREFIXES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = p;
    b.dataset.action = 'togglePrefix';
    b.dataset.arg = p;
    chips.appendChild(b);
  }
  syncChips();
  input.addEventListener('input', syncChips);
}

function syncChips() {
  const list = getVal('namePrefix')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const c of document.querySelectorAll('#prefix-chips .chip')) c.classList.toggle('on', list.includes(c.dataset.arg));
}

function togglePrefix(p) {
  const input = $('namePrefix');
  const list = input.value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const i = list.indexOf(p);
  if (i >= 0) list.splice(i, 1);
  else list.push(p);
  input.value = list.join(',');
  store.set('namePrefix', input.value);
  syncChips();
}

function initLogControls() {
  const box = $('log');
  const verbose = $('log-verbose');
  verbose.checked = store.get('verbose') === '1';
  box.classList.toggle('hide-debug', !verbose.checked);
  verbose.addEventListener('change', () => {
    box.classList.toggle('hide-debug', !verbose.checked);
    store.set('verbose', verbose.checked ? '1' : '0');
  });
}

function onActionError(err) {
  const msg = err && err.message ? err.message : String(err);
  log.error(msg);
  toast(msg, 'error', 4000);
}

registerActions({
  // connection
  connect,
  disconnect,
  reconnect,
  togglePrefix,
  toggleTheme,
  // Mi
  miRegister: mi.sendRegister,
  miSkip: mi.skipActivation,
  miLogin: mi.keyMiLogin,
  miDownloadKeys: mi.downloadMiKeys,
  copyField: (id) => mi.copyField(id),
  getMiClock: mi.getMiClock,
  setMiClock: mi.setMiClock,
  // Qingping
  qpClear: qp.qpClear,
  qpGetTimer: qp.qpGetTimer,
  qpSetTimer: qp.qpSetTimer,
  // custom firmware
  sendCmdTxt: () => sendCustomSetting(getVal('cmdTXT')),
  sendCustomConfig: st.SendCustomConfig,
  sendZbConfig: st.SendZbConfig,
  infoIntervals: st.InfoIntervals,
  sendExt: st.sendExt,
  sendCmf: st.SendCmf,
  sendTrg: st.sendTrg,
  sendPinCode: st.sendPinCode,
  sendDevName: st.sendDevName,
  cleanDevName: st.cleanDevName,
  sendMAC: st.sendMAC,
  cleanMAC: st.cleanMAC,
  setNewTBKey: st.setNewTBKey,
  getBKey: st.getBKey,
  setBKey: st.setBKey,
  setDevTime: st.setDevTime,
  calkDeltaTime: st.calkDeltaTime,
  sendDeltaTime: st.sendDeltaTime,
  getMemo: st.getMemoFromInput,
  downloadMemo: st.downloadMemo,
  getTrScConfig: st.getTrScConfig,
  setTrScConfig: st.setTrScConfig,
  lcdClock: st.lcdClock,
  lcdRestore: st.lcdRestore,
  getSensCfg: st.getSensCfg,
  setSensCfg: st.setSensCfg,
  resetSensCfg: st.resetSensCfg,
  getSens2Cfg: st.getSens2Cfg,
  setSens2Cfg: st.setSens2Cfg,
  resetSens2Cfg: st.resetSens2Cfg,
  getSensSCD4x: st.getSensSCD4x,
  setSensSCD4x: st.setSensSCD4x,
  setDefCfgSCD4x: st.setDefCfgSCD4x,
  fnSensSCD4x: (arg) => st.fnSensSCD4x(arg),
  mapperSend: st.mapperSend,
  // firmware
  reloadIndex: loadIndexes,
  loadIndexed: (kind) => loadIndexed(kind),
  pickFile: () => $('file').click(),
  loadUrl: () => loadFromUrl(getVal('fw-url')),
  startDFU,
  clearFirmware,
  abortOta,
  // log
  copyLog: () => copyText(logAsText({ includeDebug: $('log-verbose').checked }), 'Log copied'),
  downloadLog: () => downloadText(`telink-flasher-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, logAsText()),
  clearLog,
});

function init() {
  applyTheme(store.get('theme'));
  installGattQueue();
  initLog({ list: $('log-list'), scroll: $('log-list'), count: $('log-count') });
  initLogControls();
  initPrefix();
  initFirmwareInputs();
  bindDelegation(document.body, sendCustomSetting, onActionError);
  // The "Activation & settings" card is visible whenever a device panel is rendered.
  const panel = $('custcfg');
  new MutationObserver(() => ($('card-device').hidden = !panel.hasChildNodes())).observe(panel, { childList: true });
  $('app-version').textContent = `v${APP.version}`;
  updateButtons();
  showSupportBanner();
  setStatus('Waiting for you to connect a device.');
  log.info(`${APP.name} v${APP.version} (based on ${APP.basedOn})`);
  loadIndexes();
  // Expose state for debugging from the console.
  window.flasher = { S, log };
}

init();
