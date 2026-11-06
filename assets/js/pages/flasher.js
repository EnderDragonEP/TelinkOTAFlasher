// Flasher (index.html: activation + OTA) and Settings (settings.html: custom firmware
// configuration) views. Both use the same connection and protocol code; S.page decides what
// is rendered. On a device that is already connected (from another tab) the view runs its
// setup on the open connection.
import { S } from '../state.js';
import { log } from '../log.js';
import { $, getVal, confirmDialog } from '../ui.js';
import { mountView } from '../site.js';
import { until } from '../util.js';
import { connect, disconnect, reconnect, updateButtons, attach, detach } from '../connection.js';
import { sendCustomSetting } from '../custom.js';
import * as mi from '../mi.js';
import * as st from '../settings.js';
import * as qp from '../qingping.js';
import { ensureIndexes, loadIndexes, loadIndexed, loadFromUrl, startDFU, clearFirmware, abortOta, initFirmwareInputs } from '../flasher.js';

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

let observer = null;

export const view = {
  needs: 'bluetooth',

  mount(page) {
    S.page = page === 'settings' ? 'settings' : 'flasher';
    const supported = mountView({ page: S.page, needs: 'bluetooth', onCommand: sendCustomSetting, actions });
    if (S.page === 'flasher') initFirmwareInputs();
    // The device panel card (Mi activation / settings) is visible whenever a panel is rendered.
    const panel = $('custcfg');
    observer = new MutationObserver(() => ($('card-device').hidden = !panel.hasChildNodes()));
    observer.observe(panel, { childList: true });
    attach();
    updateButtons();
    if (!supported) $('btn-connect').disabled = true;
    if (S.page === 'flasher') ensureIndexes();
    // Expose state for debugging from the console.
    window.flasher = { S, log };
  },

  unmount() {
    detach();
    if (observer) observer.disconnect();
    observer = null;
  },

  /** Leaving while flashing aborts the transfer (after confirmation). */
  async canLeave() {
    if (!S.ota) return true;
    const ok = await confirmDialog('Firmware is being flashed. Leaving this tab aborts the transfer; the device keeps its current firmware.', {
      title: 'Flashing in progress',
      ok: 'Abort and leave',
      cancel: 'Stay',
      danger: true,
    });
    if (!ok) return false;
    if (S.ota) {
      S.ota.abort();
      await until(() => !S.ota, 10000);
    }
    return true;
  },
};
