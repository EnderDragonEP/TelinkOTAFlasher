// pvvx custom firmware (and ZigbeeTLc BLE mode) command channel:
// GATT setup, notification parser (port of CustomBlkParse) and raw command sending.
import { S, HW, MAX_EXT_OTA_SIZE } from './state.js';
import { UUID, writeChar, onNotify } from './ble.js';
import { log } from './log.js';
import { $, setStatus, setLive, setVal, exists, toast } from './ui.js';
import { hex, bytesToHex, dump, macFromLE, isoDateTime, parseHex } from './util.js';
import { HW_VERSION_STR, ID_SENSOR_STR } from './tables.js';
import { renderFirmwarePanel, onExtOtaStatus } from './flasher.js';
import { CustomConfig, zbdeviceConfig, UpdExt, UpdTrg, UpdCmf, addMenuSensors, getSensSCD4x, renderMemoActions, renderAtc1441Panel } from './settings.js';

export const hwName = (id) => (id != null && id < HW_VERSION_STR.length ? HW_VERSION_STR[id] : `Unknown or DIY (${id})`);

/** Write raw bytes to the settings characteristic. */
export function writeSettings(bytes) {
  return writeChar(S.settingsChar, bytes);
}

/** Send a hex command string (the "Send commands to custom firmware" box and data-cmd buttons). */
export async function sendCustomSetting(data) {
  const clean = String(data ?? '').replace(/\s+/g, '');
  const bytes = parseHex(clean);
  if (!bytes) {
    log.error(`Invalid command "${data}": enter an even number of hex digits, e.g. 55 or 3301`);
    toast('Commands must be hex bytes, e.g. "55"', 'warn');
    return;
  }
  if (!S.settingsChar) {
    log.warn('Not connected to a custom firmware command characteristic');
    return;
  }
  if (bytes[0] === 0x35) S.flgMemoAct = true;
  try {
    await writeSettings(bytes);
    log.info(`Settings ${clean} was sent successfully`);
  } catch (err) {
    log.error(`Error on sending setting ${clean}: ${err.message || err}`);
  }
}

const altFirmwareHint = () => {
  log.warn('Detected alternative firmware? Use the Generic OTA page (ota.html).');
  setStatus('Detected alternative firmware?', { kind: 'warn', link: { text: 'Generic OTA', href: 'ota.html' } });
};

/** pvvx custom firmware: service 0x1F10, characteristic 0x1F1F. */
export async function customAction() {
  const service = await S.server.getPrimaryService(UUID.CUSTOM_SERVICE);
  log.debug('Found custom Main service (0x1f10)');
  S.settingsChar = await service.getCharacteristic(UUID.CUSTOM_CHAR);
  log.debug('Found custom read-write characteristic (0x1f1f)');
  if (!S.devIdEnabled) {
    renderAtc1441Panel();
    return;
  }
  log.debug('Start Notifications (0x1f1f)');
  await S.settingsChar.startNotifications();
  onNotify(S.settingsChar, onCustomNotify);
  log.debug('Read Characteristics (0x1f1f)');
  try {
    // The read result also arrives as a characteristicvaluechanged event (config 0x55).
    await S.settingsChar.readValue();
  } catch (err) {
    log.debug(err);
    altFirmwareHint();
    return;
  }
  renderFirmwarePanel();
  log.debug('Send cmd (33c8): query 200 measurements');
  writeSettings(new Uint8Array([0x33, 0xc8])).catch((err) => log.debug(err));
}

/** ZigbeeTLc firmware in BLE mode: service 0xFCD2, characteristic 0xFFF4. */
export async function zbdeviceAction() {
  const service = await S.server.getPrimaryService(UUID.BTHOME);
  log.debug('Found Main service (0xfcd2)');
  S.settingsChar = await service.getCharacteristic(UUID.ZB_CHAR);
  log.debug('Found read-write characteristic (0xfff4)');
  await S.settingsChar.startNotifications();
  onNotify(S.settingsChar, onCustomNotify);
  try {
    await S.settingsChar.readValue();
  } catch (err) {
    log.debug(err);
    altFirmwareHint();
    return;
  }
  renderFirmwarePanel();
  log.debug('Send cmd (0x57): get zb device config');
  writeSettings(new Uint8Array([0x57])).catch((err) => log.debug(err));
}

/** Test firmware: service 0xFFE0, characteristic 0xFFE1 (raw notifications only). */
export async function getTestCharacteristic() {
  const service = await S.server.getPrimaryService(UUID.TEST_SERVICE);
  log.debug('Found custom Main service (0xffe0)');
  S.settingsChar = await service.getCharacteristic(UUID.TEST_CHAR);
  log.debug('Found custom read-write characteristic (0xffe1)');
  await S.settingsChar.startNotifications();
  onNotify(S.settingsChar, onCustomNotify);
  altFirmwareHint();
}

// ---------------------------------------------------------------------------
// Notification parser

function sensorLabel(text) {
  const el = $('lblSensorInfo');
  if (el) el.textContent = text;
}

function measurement(value, len) {
  const cfg = S.cfg;
  const hw = S.hwverId;
  const vbat = value.getUint16(1, true);
  const parts = [['Battery', `${vbat} mV`]];
  let s = '';
  if (len === 17) {
    const i = [value.getInt16(3, true), value.getInt16(5, true), value.getInt16(7, true)];
    const u = [value.getUint16(9, true), value.getUint16(11, true), value.getUint16(13, true)];
    const count = value.getUint16(15, true);
    const flg = value.getUint8(17);
    s = `Vbat: ${vbat} mV, I: ${i.join(':')} mA, U: ${u.join(':')} mV, ID: ${count}, TRG Out: ${(flg & 2) >> 1}, flg: 0x${hex(flg, 2)}`;
    parts.push(['I', `${i.join(' / ')} mA`], ['U', `${u.join(' / ')} mV`], ['ID', String(count)], ['TRG out', String((flg & 2) >> 1)]);
  } else {
    const temp = value.getInt16(3, true) / 100.0;
    const humi = value.getUint16(5, true) / 100.0;
    const count = value.getUint16(7, true);
    parts.push(['Temperature', `${temp.toFixed(2)} °C`], ['Humidity', `${humi.toFixed(2)} %`]);
    if ((hw === 53 || hw === 54) && len > 9) {
      // DIY-SCD41: CO2 follows the TRG flag byte when present.
      const co2 = value.getUint16(len >= 11 ? 10 : 9, true);
      s = `CO2: ${co2} ppm, Vbat: ${vbat} mV, Temp: ${temp.toFixed(2)}°C, Humi: ${humi.toFixed(2)}%, ID: ${count}`;
      parts.unshift(['CO₂', `${co2} ppm`]);
      parts.push(['ID', String(count)]);
    } else {
      let flg = 0;
      let rdsCount = 0;
      if (len > 8) {
        flg = value.getUint8(9);
        if (len > 12) rdsCount = value.getUint32(10, true);
      }
      const sw = (flg & 1) === 0 ? 'Close' : 'Open';
      if (cfg.ver >= 0x37) {
        s = `Vbat: ${vbat} mV, Temp: ${temp.toFixed(2)}°C, Humi: ${humi.toFixed(2)}%`;
        if (hw === 44) {
          s += `, Mois: ${(count / 100.0).toFixed(2)}%`;
          parts.push(['Moisture', `${(count / 100.0).toFixed(2)} %`]);
        } else {
          s += `, ID: ${count}`;
          parts.push(['ID', String(count)]);
        }
        s += `, Switch: ${sw}, Counter: ${rdsCount}, TRG Out: ${(flg & 2) >> 1}, flg: 0x${hex(flg, 2)}`;
        parts.push(['Switch', sw], ['Counter', String(rdsCount)], ['TRG out', String((flg & 2) >> 1)]);
      } else {
        s = `Vbat: ${vbat} mV, Temp: ${temp.toFixed(2)}°C, Humi: ${humi.toFixed(2)}%, ID: ${count}, Switch ${sw}, TRG Out: ${(flg & 2) >> 1}, flg: 0x${hex(flg, 2)}`;
        parts.push(['ID', String(count)], ['Switch', sw], ['TRG out', String((flg & 2) >> 1)]);
      }
    }
  }
  setLive(parts, 'Custom FW');
  log.debug(s);
}

function miKeys(value, blkid, len) {
  const mk = S.mikeys;
  const lb = value.getUint8(1);
  if (lb !== 0) {
    len -= 1;
    if (S.cntBuf11 === 0) S.buf11 = new Uint8Array(lb);
    for (let i = 0; i < len && i < lb; i++) S.buf11[S.cntBuf11++] = value.getUint8(i + 2);
    if (len === lb) {
      const buf = S.buf11;
      if (S.cntBuf11 === buf.length) {
        let s = '';
        if (blkid === 0x14) {
          if (S.cntDelkeys === 0) mk.delkeys = [];
          s = 'Marked as delete Key' + S.cntDelkeys + ': ';
          S.cntDelkeys += 1;
          mk.delkeys.push(buf);
        }
        if (S.cntBuf11 === 28) {
          s += 'miToken: ' + dump(buf.slice(0, 12), 12) + ', miBindKey: ' + dump(buf.slice(12), 16);
          if (blkid === 0x12) {
            S.cntDelkeys = 0;
            mk.token = buf.slice(0, 12);
            mk.bindkey = buf.slice(12);
            CustomConfig();
          } else if (blkid === 0x14 && mk.token) {
            mk.restore = true;
          }
          log.info(s);
        } else if (S.cntBuf11 === 20) {
          const str = new TextDecoder('utf-8').decode(buf.slice(1));
          s += 'miDevId: "' + str + '" ' + dump(buf.slice(1), 19);
          if (blkid === 0x11) {
            S.cntDelkeys = 0;
            mk.id = buf;
          }
          log.info(s);
        } else if (S.cntBuf11 === 8) {
          log.debug(`Custom (0x1f1f) Notifications id: 0x${hex(blkid, 2)} [${bytesToHex(new Uint8Array(value.buffer, value.byteOffset + 1, value.byteLength - 1))}]`);
          const m = macFromLE(buf);
          s += 'MAC: ' + m + ', RandMAC: C0' + hex(buf[7], 2) + hex(buf[6], 2) + hex(buf[2], 2) + hex(buf[1], 2) + hex(buf[0], 2);
          if (blkid === 0x10) {
            S.cntDelkeys = 0;
            mk.mac = buf;
            log.info(s);
            setVal('mi_mac', m + hex(buf[7], 2) + hex(buf[6], 2));
          }
        } else if (S.cntBuf11 === 4) {
          s += 'miCfg: ' + dump(buf, 4);
          if (blkid === 0x13) {
            S.cntDelkeys = 0;
            mk.cfg = buf;
            log.info(s);
          }
        } else {
          s += 'miKey: ' + dump(buf, S.cntBuf11);
        }
        log.debug(s);
      }
      S.cntBuf11 = 0;
    }
  } else if (S.cntBuf11 !== 0) {
    S.cntBuf11 = 0;
    log.debug('Error read mi keys!');
  } else {
    if (blkid === 0x11) log.info('No miDevId!');
    else if (blkid === 0x12) log.info('No miToken and miBindKey!');
    else if (blkid === 0x13) log.info('No miCFG!');
    else if (blkid === 0x14) {
      log.debug('End keys');
      CustomConfig();
    } else log.debug('End keys');
    S.cntBuf11 = 0;
  }
}

/** Parse one notification from the command characteristic (port of CustomBlkParse). */
export function onCustomNotify(value) {
  let len = value.byteLength;
  if (len === 0) return;
  len--; // payload size after the command id
  const u8 = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const tail = (from) => bytesToHex(u8.subarray(from));
  const blkid = value.getUint8(0);
  const { cfg, trg, cmf, ext, devSens, devtime, trsc, mikeys } = S;
  let s = '';

  if (S.devTest) {
    log.info(`Custom (0xffe1) Notifications id: 0x${hex(blkid, 2)} [${tail(1)}]`);
    return;
  }

  if (blkid === 0x55 && len >= 9) {
    cfg.ver = value.getUint8(1);
    cfg.flg = value.getUint8(2);
    cfg.flg2 = value.getUint8(3);
    cfg.temp_offset = value.getInt8(4);
    cfg.humi_offset = value.getInt8(5);
    cfg.advertising_interval = value.getUint8(6);
    cfg.measure_interval = value.getUint8(7);
    cfg.rf_tx_power = value.getUint8(8);
    cfg.connect_latency = value.getUint8(9);
    cfg.lcd_tint = len >= 10 ? value.getUint8(10) : 55;
    if (len >= 11) {
      cfg.hver = value.getUint8(11);
      if (cfg.ver < 0x36) cfg.hver &= 0x87;
    } else if (cfg.hver == null) cfg.hver = 0x80;
    cfg.av_meas_mem = len >= 12 ? value.getUint8(12) : 0;
    if (cfg.ver < 0x48) {
      S.hwverId = cfg.hver & 0x0f;
      if (len >= 11 && S.hwverId === 0x0f) {
        cfg.ext_hw_id = cfg.lcd_tint & 0x7f;
        S.hwverId = 16 + cfg.ext_hw_id;
        if ((cfg.lcd_tint & 0x80) !== 0) S.bigOtaEnabled = true;
      }
    } else S.hwverId = cfg.hver;
    s = 'Hardware Version: ' + hwName(S.hwverId);
    if (cfg.ver > 0x45) S.bigOtaEnabled = true;
    else if ([9, 11, 12, 13].includes(S.hwverId)) S.bigOtaEnabled = true;
    if (S.devinfo.hrstr) s += ' ' + S.devinfo.hrstr;
    s += ', Software Version: ' + (cfg.ver >> 4) + '.' + (cfg.ver & 0x0f);
    setStatus(s, { kind: 'ok' });
    log.info(s);
    log.info('Custom config HEX string: 55' + tail(2));
    if (cfg.ver >= 5) CustomConfig();
    else log.warn('Old version - out of service!');
  } else if ((blkid === 0x57 || blkid === 0x58) && len >= 5) {
    cfg.temp_offset = value.getInt16(1, true);
    cfg.humi_offset = value.getInt16(3, true);
    if (len >= 16) {
      cfg.temp_comfort_min = value.getInt16(5, true);
      cfg.temp_comfort_max = value.getInt16(7, true);
      cfg.humi_comfort_min = value.getInt16(9, true);
      cfg.humi_comfort_max = value.getInt16(11, true);
      cfg.c_f = value.getUint8(13);
      cfg.showSmiley = value.getUint8(14);
      cfg.display_off = value.getUint8(15);
      cfg.measure_interval = value.getUint8(16);
    } else {
      cfg.measure_interval = value.getUint8(5);
    }
    if (cfg.zbdevice) {
      log.info('Custom config HEX string: 57' + tail(2));
      zbdeviceConfig();
    }
  } else if (blkid === 0 && len >= 11) {
    cfg.revision = value.getUint8(1);
    cfg.hw_version = value.getUint16(2, true);
    cfg.sw_version = value.getUint16(4, true);
    cfg.dev_spec_data = value.getUint16(6, true);
    cfg.services = value.getUint32(8, true);
    s = ' ?';
    if (cfg.hw_version < HW_VERSION_STR.length) {
      S.hwverId = cfg.hw_version;
      s = ' ' + HW_VERSION_STR[cfg.hw_version];
      if (S.devinfo.hrstr) s += ' ' + S.devinfo.hrstr;
    }
    s = `Device${s} info # hw: 0x${hex(cfg.hw_version, 4)}, sw: 0x${hex(cfg.sw_version, 4)}, services: 0x${hex(cfg.services, 8)}, sd: 0x${hex(cfg.dev_spec_data, 4)}`;
    const sid1 = cfg.dev_spec_data & 0xff;
    const sid2 = (cfg.dev_spec_data & 0xff00) >> 8;
    if (sid1 < ID_SENSOR_STR.length && sid2 < ID_SENSOR_STR.length) s += ` (Sensor1: ${ID_SENSOR_STR[sid1]}, Sensor2: ${ID_SENSOR_STR[sid2]})`;
    log.info(s);
    if (S.bthomeEnabled) cfg.zbdevice = (cfg.services & 0x01000000) !== 0;
    if (cfg.zbdevice) {
      S.fwMaxSize = MAX_EXT_OTA_SIZE;
      cfg.ver = cfg.sw_version & 0xff;
      setStatus(`ZBdevice: ${hwName(cfg.hw_version)}, Software Version: ${cfg.ver >> 4}.${cfg.ver & 0x0f}`, { kind: 'ok' });
      renderFirmwarePanel();
    }
  } else if (blkid === 0x33 && len >= 8) {
    measurement(value, len);
  } else if (blkid === 0x21 && len >= 10) {
    trsc.int = value.getUint32(1, true);
    trsc.mac = u8.slice(5, 11);
    trsc.mact = macFromLE(trsc.mac);
    log.info(`TrSc Config: interval: ${trsc.int}, MAC: ${trsc.mact}`);
    if (cfg.ver >= 0x53 && HW.isLywsd03(S.hwverId)) {
      setVal('trsc_int', trsc.int);
      setVal('trsc_mac', trsc.mact);
    }
  } else if (blkid === 0x22 && len >= 7) {
    if ([9, 12, 49].includes(S.hwverId)) {
      ext.big_number = value.getInt32(1, true); // -9950..199950, x0.01
      ext.small_number = 0;
    } else {
      ext.big_number = value.getInt16(1, true); // -995..19995, x0.1
      ext.small_number = value.getInt16(3, true); // -9..99, x1
    }
    ext.vtime = value.getUint16(5, true);
    ext.flg = value.getUint8(7);
    log.info(`ExtShow: big_number: ${ext.big_number}, small_number: ${ext.small_number}, ext.vtime: ${ext.vtime} s, flg: ${hex(ext.flg, 2)}`);
    UpdExt();
  } else if ((blkid === 0x25 || blkid === 0x26 || blkid === 0x2b || blkid === 0x2c) && len > 16) {
    devSens.temp_k = value.getUint32(1, true);
    devSens.humi_k = value.getUint32(5, true);
    devSens.temp_z = value.getInt16(9, true);
    devSens.humi_z = value.getInt16(11, true);
    setVal('inpTempK', (devSens.temp_k / 100.0).toFixed(2));
    setVal('inpHumK', (devSens.humi_k / 100.0).toFixed(2));
    setVal('inpTempZ', (devSens.temp_z / 100.0).toFixed(2));
    setVal('inpHumZ', (devSens.humi_z / 100.0).toFixed(2));
    devSens.i2c_addr = value.getUint8(17);
    let st = '?';
    if (len > 17) {
      devSens.id = value.getUint32(13, true);
      devSens.sentype = value.getUint8(18);
      if (devSens.sentype < ID_SENSOR_STR.length) {
        st = ID_SENSOR_STR[devSens.sentype];
        addMenuSensors();
      } else st = 'N:' + devSens.sentype;
    } else {
      devSens.id = value.getUint32(13, false);
      if ((devSens.id & 0xffff) === 0x2000) st = 'AHT20/30';
      else if ((devSens.id & 0xffff) === 0x3000) st = 'SHT30';
      else if (devSens.id === 0x83055959) st = 'CHT8305';
      else if (devSens.i2c_addr === 0xe0) st = 'SHTv3';
      else if (devSens.i2c_addr === 0x88 || devSens.i2c_addr === 0x8a) st = 'SHT4x';
    }
    let label = st;
    if (devSens.i2c_addr !== 0) label += ', I2C address: 0x' + hex(devSens.i2c_addr, 2);
    label += ', ID: ' + hex(devSens.id, 8);
    if (blkid === 0x2b || blkid === 0x2c) label += ', part: ' + (3 - (blkid & 1));
    sensorLabel(`(${label})`);
    log.info(`Sensor ${st} id: ${hex(devSens.id, 8)}, I2C address: 0x${hex(devSens.i2c_addr, 2)}, Kt: ${devSens.temp_k}, Kh: ${devSens.humi_k}, Zt: ${devSens.temp_z}, Zh: ${devSens.humi_z}`);
  } else if (blkid >= 0x27 && blkid <= 0x28 && len > 6) {
    devSens.temp2_k = value.getUint32(1, true);
    devSens.temp2_z = value.getInt16(5, true);
    setVal('inpTemp2K', (devSens.temp2_k / 100.0).toFixed(2));
    setVal('inpTemp2Z', (devSens.temp2_z / 100.0).toFixed(2));
    log.info(`Sensor2: Kt: ${devSens.temp2_k}, Zt: ${devSens.temp2_z}`);
  } else if ((blkid === 0x2e || blkid === 0x2f) && len > 13) {
    devSens.temp_offset = value.getUint16(1, true);
    devSens.altitude = value.getUint16(3, true);
    devSens.asc_co2 = value.getUint16(5, true);
    devSens.asc_ena = value.getUint16(7, true);
    devSens.asc_ini_per = value.getUint16(9, true);
    devSens.asc_std_per = value.getUint16(11, true);
    devSens.pressure = value.getUint16(13, true);
    setVal('inpSCD4xTempOffset', ((devSens.temp_offset * 175) / 65535).toFixed(2));
    setVal('inpSCD4xAltitude', devSens.altitude);
    setVal('inpSCD4xPressure', (devSens.pressure * 100.0).toFixed(0));
    setVal('inpSCD4xAscCo2', devSens.asc_co2);
    setVal('inpSCD4xInitPeriod', devSens.asc_ini_per);
    setVal('inpSCD4xStdPeriod', devSens.asc_std_per);
    const chk = $('chbSDC41asc');
    if (chk) chk.checked = !!devSens.asc_ena;
    log.info(
      `Sensor SCD41: Toff: ${((devSens.temp_offset * 175) / 65535).toFixed(2)}, Alt: ${devSens.altitude}, Prs: ${(devSens.pressure * 100.0).toFixed(0)}` +
        `; ASC: enable: ${devSens.asc_ena}, CO2: ${devSens.asc_co2}, It: ${devSens.asc_ini_per}, Is: ${devSens.asc_std_per}`,
    );
  } else if (blkid === 0x77 && len > 1) {
    devSens.cmd = value.getUint8(1);
    if (len > 4) {
      devSens.errors = value.getUint16(2, true);
      devSens.value = value.getUint16(4, true);
      log.info(`Sensor SCD41 ExtStatus: cmd: ${devSens.cmd}, value: ${devSens.value}; errors: ${devSens.errors}`);
      s = `Response: ok, Command: ${devSens.cmd}, Status: ${hex(devSens.value, 4)}`;
      if (devSens.errors === 0) {
        if (devSens.cmd === 5 || devSens.cmd === 6) getSensSCD4x();
        else if (devSens.cmd === 2) {
          if (devSens.value === 0xffff) s = 'Recalibration Failed: Status: ' + hex(devSens.value, 4);
          else s = `Response: ok, Command: ${devSens.cmd}, FCR-correction: ${devSens.value - 0x800}`;
        }
      } else s = `Error: ${hex(devSens.errors, 4)}, Command: ${devSens.cmd}, Status: ${hex(devSens.value, 4)}`;
    } else {
      const err = value.getUint8(1);
      if (err === 0xff) s = 'Command number error!';
      else if (err === 0xfe) s = 'Please wait: previous command is being executed!';
      else s = 'Unknown error!';
    }
    const el = $('txtSCD4xResponse');
    if (el) el.textContent = s;
  } else if (blkid === 0x44 && len >= 7) {
    trg.tmp_thr = value.getInt16(1, true) / 100.0;
    trg.hm_thr = value.getInt16(3, true) / 100.0;
    trg.rds_type = 0;
    trg.rds_rpint = 0;
    if (len >= 9) {
      trg.tmp_hst = value.getInt16(5, true) / 100.0;
      trg.hm_hst = value.getInt16(7, true) / 100.0;
      if (len >= 12 && cfg.ver >= 0x37) {
        trg.rds_rpint = value.getUint16(9, true);
        trg.rds_type = value.getUint8(11);
        trg.flg = value.getUint8(12);
      } else trg.flg = value.getUint8(9);
    } else {
      trg.tmp_hst = value.getInt8(5) / 10.0;
      trg.hm_hst = value.getInt8(6) / 10.0;
      trg.flg = value.getInt8(7);
    }
    s = `Threshold Temp/Humi: ${trg.tmp_thr.toFixed(2)}°C/${trg.hm_thr.toFixed(2)}%, Hysteresis T/H: ${trg.tmp_hst.toFixed(2)}°/${trg.hm_hst.toFixed(2)}%`;
    if (cfg.ver >= 0x37) s += `, Reed switch mode: ${trg.rds_type}, Rs rep.interval: ${trg.rds_rpint} sec`;
    s += `, flg: 0x${hex(trg.flg & 0xff, 2)}`;
    if (cfg.ver >= 0x39 && (trg.rds_type & 0x10) !== 0) s += ', RS input inversion';
    log.info(s);
    UpdTrg();
  } else if (blkid >= 0x10 && blkid <= 0x14 && len >= 1) {
    miKeys(value, blkid, len);
  } else if (blkid === 0x18 && len >= 1) {
    if (len >= 16) {
      mikeys.cbindkey = u8.slice(1);
      const k = bytesToHex(mikeys.cbindkey);
      log.info('Read bindkey: ' + k);
      setVal('cbind_key', k);
    } else {
      if (len === 1 && value.getUint8(1) === 0xff) log.info('No bindkey in EEP!');
      else log.warn('Error read bindkey from EEP!');
      setVal('cbind_key', '?');
    }
  } else if (blkid === 0x60 && len >= 6) {
    log.info('LCD data: ' + tail(1));
  } else if (blkid === 0x61 && len >= 1) {
    log.debug('LCD flg: ' + hex(value.getUint8(1), 2));
  } else if (blkid === 0x35) {
    if (S.flgMemoAct) {
      if (len >= 12) {
        const cnt = value.getUint16(1, true);
        const tc = value.getUint32(3, true);
        const tm = value.getInt16(7, true) / 100.0;
        const hm = value.getUint16(9, true) / 100.0;
        const vb = value.getUint16(11, true);
        log.info(`${isoDateTime(new Date(tc * 1000), false)} # Vbat: ${vb} mV, Temp: ${tm}°C, Humi: ${hm}%, Count: ${cnt}`);
        S.memo.push({ cnt, time: tc, temp: tm, humi: hm, vbat: vb });
      } else if (len >= 2) {
        log.info('Memo end: ' + value.getUint16(1, true));
        S.flgMemoAct = false;
        renderMemoActions();
      }
    }
  } else if (blkid === 0x23 && len >= 4) {
    devtime.cur = value.getUint32(1, true);
    log.debug('Device Time: 0x' + hex(devtime.cur, 8));
    log.info('Device Date: ' + isoDateTime(new Date(devtime.cur * 1000)));
    if (len >= 8) {
      devtime.set = value.getUint32(5, true);
      log.debug('Last clock setting Time: 0x' + hex(devtime.set, 8));
      if (devtime.step === 1) {
        if (devtime.set > 0x60000000) {
          devtime.period = devtime.cur - devtime.set;
          devtime.cmp = Date.now() / 1000 - new Date().getTimezoneOffset() * 60;
          log.info('Last clock setting: ' + isoDateTime(new Date(devtime.set * 1000)));
          log.info('DevPeriod: ' + devtime.period.toFixed(1) + ' sec');
          const rp = devtime.cmp - devtime.set;
          log.debug(`RealPeriod: ${rp.toFixed(1)} sec, Delta: ${(rp - devtime.period).toFixed(1)} sec`);
          if (rp >= 10800) {
            devtime.step = 2;
            log.debug('Send cmd Get StepTimeSec...');
            writeSettings(new Uint8Array([0x24])).then(() => log.info('Get StepTimeSec...'), (e) => log.error(e));
          } else {
            devtime.step = 0;
            log.warn('The minimum period for calculation is 3 hours!');
          }
        } else {
          devtime.step = 0;
          log.warn('The clock must be set beforehand!');
        }
      }
    }
  } else if (blkid === 0x24 && len >= 4) {
    cfg.step_time = value.getUint32(1, true);
    log.debug('step_time: ' + cfg.step_time);
    log.info('Device StepTimeSec: ' + (cfg.step_time / 16.0).toFixed(3) + ' us');
    if (exists('cfg_time_step') && cfg.ver >= 0x24) {
      if (devtime.step === 2) {
        devtime.step = 0;
        const k = devtime.period / (devtime.cmp - devtime.set);
        log.debug('koef: ' + k);
        const nstep = cfg.step_time * k;
        setVal('cfg_time_step', nstep - 16000000);
        log.debug('step_time: ' + nstep.toFixed(1));
      } else setVal('cfg_time_step', cfg.step_time - 16000000);
    }
  } else if (blkid === 0x20 && len >= 8) {
    cmf.tmp_lo = value.getInt16(1, true);
    cmf.tmp_hi = value.getInt16(3, true);
    cmf.hm_lo = value.getUint16(5, true);
    cmf.hm_hi = value.getUint16(7, true);
    log.info(`Comfort Temp: ${(cmf.tmp_lo / 100.0).toFixed(2)}..${(cmf.tmp_hi / 100.0).toFixed(2)}°C, Humi: ${(cmf.hm_lo / 100.0).toFixed(2)}..${(cmf.hm_hi / 100.0).toFixed(2)}%`);
    UpdCmf();
  } else if (blkid === 0x73 && len >= 9) {
    onExtOtaStatus(value.getUint8(1), value.getUint32(2, true), value.getUint32(6, true));
  } else if (blkid === 0x01 && len >= 1) {
    S.dnm.name = new TextDecoder('utf-8').decode(u8.subarray(1));
    setVal('dev_name', S.dnm.name);
    log.info('DevName: [' + S.dnm.name + ']');
  } else if (blkid === 0x29 && len >= 12) {
    devSens.rh_k = value.getUint32(1, true);
    devSens.rh_z = value.getUint16(5, true);
    devSens.rh_d = value.getUint16(7, true);
    const adcH = value.getUint16(9, true);
    const adcD = value.getUint16(11, true);
    log.info(`Config Moisture Sensor - K: ${devSens.rh_k}, Z: ${devSens.rh_z}, D: ${devSens.rh_d}`);
    log.info(`ADCh: ${adcH} (${((adcH * 1175) / 4096).toFixed(2)} mV), ADCn: ${adcD} (${((adcD * 1175) / 4096).toFixed(2)} mV)`);
  } else if (blkid === 0x2a && len >= 5) {
    const err = value.getUint8(1);
    const rh = value.getUint16(2, true);
    const ntc = value.getUint16(4, true);
    if (err === 0) log.ok('Calibration ok');
    if (err === 1) log.error('Calibration error!');
    if (err === 0xff) log.error('Command error!');
    log.info(`ADCh: ${rh} (${((rh * 1175) / 4096).toFixed(2)} mV), ADCn: ${ntc} (${((ntc * 1175) / 4096).toFixed(2)} mV)`);
  } else if (blkid === 0x02 && len > 1) {
    const addr = (a, none) => (a !== 0 ? 'I2C address 0x' + hex(a >> 1, 2) : none);
    s = 'Sensor: ' + addr(value.getUint8(1), 'None!') + ', LCD driver: ' + addr(value.getUint8(2), 'SPI or UART');
    if (len > 2) s += ', RTC: ' + addr(value.getUint8(3), 'Unknown');
    log.info(s);
  } else if (blkid === 0x04 && len > 0) {
    const wr = value.getUint8(1);
    if (len === 1) s = `I2C Read/Write fault! (${wr})`;
    else {
      s = 'I2C address 0x' + hex(value.getUint8(2), 2);
      if (wr !== 0) s += `, write ${wr} bytes`;
      if (len > 2) s += `, read ${len - 2} bytes: ${tail(3)}`;
    }
    log.info(s);
  } else if (blkid === 0x05 && len > 3) {
    log.info('Sensor ID: ' + hex(value.getUint32(1, true), 8));
  } else if (blkid === 0x45 && len >= 1) {
    const flg = value.getUint8(1);
    const sw1 = (flg & 1) === 0 ? 'Open' : 'Close';
    const sw2 = (flg & 0x40) === 0 ? 'Open' : 'Close';
    s = `Switch1: ${sw1}, Switch2: ${sw2}, TRG Out "${(flg & 2) >> 1}", flg: 0x${hex(flg, 2)}`;
    setLive([['Switch 1', sw1], ['Switch 2', sw2], ['TRG out', String((flg & 2) >> 1)]], 'Custom FW');
    log.debug(s);
  } else if (blkid === 0x03) {
    log.info(`Custom (0x1f1f) Notifications id: 0x${hex(blkid, 2)} [${tail(1)}]`);
  } else {
    log.debug(`Custom (0x1f1f) Notifications id: 0x${hex(blkid, 2)} [${tail(1)}]`);
  }
}
