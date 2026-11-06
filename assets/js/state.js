// Shared application state. Field names follow the original page so the protocol
// code can be compared line by line with pvvx's TelinkMiFlasher.html.
import { makeRandomID } from './util.js';

export const MAX_BLE_OTA_SIZE = 0x20000; // 128 KiB
export const MAX_EXT_OTA_SIZE = 0x34000; // 208 KiB

const defaultCfg = () => ({
  enable: false, zbdevice: false, ver: 0, hver: null, ext_hw_id: 0, flg: 0, flg2: 0,
  temp_offset: 0, humi_offset: 0, advertising_interval: 32, measure_interval: 5,
  rf_tx_power: 191, connect_latency: 49, lcd_tint: 55, av_meas_mem: 60, step_time: 16000000,
});
const defaultTrg = () => ({ enable: false, rds2_enable: false, tmp_thr: 2100, hm_thr: 5000, tmp_hst: -1, hm_hst: 0, flg: 0, rds_type: 0, rds_rpint: 0 });
const defaultCmf = () => ({ enable: false, tmp_lo: 2100, tmp_hi: 2600, hm_lo: 3000, hm_hi: 6000 });
const defaultMikeys = () => ({ mac: null, id: null, token: null, bindkey: null, cfg: null, delkeys: null, restore: false, cbindkey: null });
const defaultExt = () => ({ big_number: 0, small_number: 0, vtime: 60, flg: 0xc7, enable: false });

export const S = {
  /** 'flasher' (index.html: activation + OTA) or 'settings' (settings.html: custom firmware configuration). */
  page: 'flasher',
  /** Incremented for every connection attempt; stale async work compares against it. */
  session: 0,
  /** 'idle' | 'connecting' | 'connected' | 'flashing' */
  phase: 'idle',
  userDisconnect: false,
  retrying: false,
  noRetry: false,
  justFlashed: false,
  connectTrys: 0,

  device: null,
  server: null,

  // Discovered services
  otaEnabled: false,
  customEnabled: false,
  qingpingEnabled: false,
  miEnabled: false,
  devIdEnabled: false,
  devTest: false,
  bthomeEnabled: false,
  devInfEnabled: false,

  // Characteristics
  otaChar: null,
  settingsChar: null,
  speedChar: null,
  tempChar: null,
  clockChar: null,
  enc10: null,
  enc19: null,
  cus017: null,
  cus018: null,
  cus100: null,

  devinfo: { hrstr: null, srstr: null, frstr: null, flg: 0 },
  hwverId: null,
  advMac: null,

  // OTA capabilities
  fwMaxSize: MAX_BLE_OTA_SIZE,
  bigOtaEnabled: false,
  fsignota: '',

  // Mi authorisation
  miConnected: false,
  isLoggedIn: false,
  mi: {
    state: 0,
    mode: 0,
    randomKey: '',
    randomKeyRecv: '',
    deviceInfoRecv: '',
    deviceInfoSend: '',
    expectedDeviceInfo: '',
    deviceKnownId: '',
    isActivated: false,
    keyPair: null,
    ownPublicKey: '',
    devicePublicKey: '',
    writeDid: '',
    // 0 + "blt.3.129v" + random[6] + "g00" — generated once per page load, like the original.
    deviceNewId: '00626c742e332e31323976' + makeRandomID(6) + '673030',
  },
  miClockOffset: 0,
  miClockTimer: null,
  /** hub.connectionId of the connection on which Mi authorisation ran (null: none). */
  miAuthConn: null,

  // Custom firmware state (see custom.js)
  cfg: defaultCfg(),
  trg: defaultTrg(),
  cmf: defaultCmf(),
  dnm: { enable: false, name: '' },
  pincode: { enable: false, value: 0 },
  mikeys: defaultMikeys(),
  ext: defaultExt(),
  devSens: {},
  devtime: {},
  trsc: { int: null, mac: null, mact: null },
  buf11: null,
  cntBuf11: 0,
  cntDelkeys: 0,
  flgMemoAct: false,
  memo: [],

  // Firmware
  fw: null, // { name, data: Uint8Array(padded), blockCount, zigbee, source, deviceId }
  fwLoading: false,
  index: { ota: { loaded: false }, z: { loaded: false }, zb: { loaded: false }, error: null },
  ota: null, // running OTA controller { abort() }
};

/** Equivalent of the original resetVariables(): per-connection state back to defaults. */
export function resetConnectionState() {
  S.fwMaxSize = MAX_BLE_OTA_SIZE;
  S.server = null;
  S.otaChar = null;
  S.settingsChar = null;
  S.speedChar = null;
  S.tempChar = null;
  S.clockChar = null;
  S.enc10 = null;
  S.enc19 = null;
  S.cus017 = null;
  S.cus018 = null;
  S.cus100 = null;
  S.miConnected = false;
  S.isLoggedIn = false;
  S.bigOtaEnabled = false;
  S.devinfo = { hrstr: null, srstr: null, frstr: null, flg: 0 };
  S.hwverId = null;
  S.cfg = defaultCfg();
  S.trg = defaultTrg();
  S.cmf = defaultCmf();
  S.dnm = { enable: false, name: '' };
  S.pincode = { enable: false, value: 0 };
  S.mikeys = defaultMikeys();
  S.ext = defaultExt();
  S.devSens = {};
  S.devtime = {};
  S.trsc = { int: null, mac: null, mact: null };
  S.buf11 = null;
  S.cntBuf11 = 0;
  S.cntDelkeys = 0;
  S.flgMemoAct = false;
  S.memo = [];
  if (S.miClockTimer) {
    clearInterval(S.miClockTimer);
    S.miClockTimer = null;
  }
}

export function resetServiceFlags() {
  S.otaEnabled = false;
  S.customEnabled = false;
  S.qingpingEnabled = false;
  S.miEnabled = false;
  S.devIdEnabled = false;
  S.devTest = false;
  S.bthomeEnabled = false;
  S.devInfEnabled = false;
}

/** Hardware id helpers (the original page repeats these lists inline). */
export const HW = {
  isLywsd03: (h) => [0, 3, 4, 5, 10, 14].includes(h),
  isMjwsd05: (h) => h === 9 || h === 12,
  isQingpingLcd: (h) => h === 2 || h === 6 || h === 7,
  /** Devices whose custom-firmware UI shows the screen/LCD related options. */
  hasScreenUi: (h) => h <= 15 || (h >= 30 && h <= 33) || h === 38 || h === 49 || h === 52,
};
