// Entry point of the two device pages that share the connection code:
// index.html (data-page="flasher": activation + OTA) and settings.html (data-page="settings").
import { APP } from './config.js';
import { S } from './state.js';
import { log } from './log.js';
import { $, getVal, setStatus } from './ui.js';
import { initSite } from './site.js';
import { connect, disconnect, reconnect, updateButtons } from './connection.js';
import { sendCustomSetting } from './custom.js';
import * as mi from './mi.js';
import * as st from './settings.js';
import * as qp from './qingping.js';
import { loadIndexes, loadIndexed, loadFromUrl, startDFU, clearFirmware, abortOta, initFirmwareInputs } from './flasher.js';

const actions = {
  // connection
  connect,
  disconnect,
  reconnect,
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
};

function init() {
  S.page = document.body.dataset.page === 'settings' ? 'settings' : 'flasher';
  const supported = initSite({ page: S.page, needs: 'bluetooth', onCommand: sendCustomSetting, actions });
  if (S.page === 'flasher') initFirmwareInputs();
  // The device panel card (Mi activation / settings) is visible whenever a panel is rendered.
  const panel = $('custcfg');
  new MutationObserver(() => ($('card-device').hidden = !panel.hasChildNodes())).observe(panel, { childList: true });
  updateButtons();
  if (!supported) $('btn-connect').disabled = true;
  setStatus('Waiting for you to connect a device.');
  if (S.page === 'flasher') {
    log.info(`${APP.name} v${APP.version} (based on ${APP.basedOn})`);
    loadIndexes();
  }
  // Expose state for debugging from the console.
  window.flasher = { S, log };
}

init();
