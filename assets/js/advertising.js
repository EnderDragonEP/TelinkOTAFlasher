// Decoders for BLE advertisement service data (used by "Read advertising data before
// connecting"). Ported from the original page; returns human readable text.
import { hex, bytesToHex } from './util.js';
import { id2name, door2event, TAB_HABLE, TAB_BTHOME } from './tables.js';

const SVC = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;
const macRev = (buf, i) => hex(buf[i + 5], 2) + hex(buf[i + 4], 2) + hex(buf[i + 3], 2) + hex(buf[i + 2], 2) + hex(buf[i + 1], 2) + hex(buf[i], 2);
const macFwd = (buf, i) => hex(buf[i], 2) + hex(buf[i + 1], 2) + hex(buf[i + 2], 2) + hex(buf[i + 3], 2) + hex(buf[i + 4], 2) + hex(buf[i + 5], 2);

function miBeacon(b, buf) {
  let s = 'MAC: ?';
  let mac = null;
  if (b.byteLength < 2) return { text: s, mac };
  const ctrl = b.getUint16(0, true);
  s = 'MiVer' + (ctrl >> 12);
  let i = 2;
  if ((ctrl & 0xf000) >= 0x2000 && b.byteLength >= i + 3) {
    const devId = b.getUint16(i, true);
    const frcntr = b.getUint8(i + 2);
    i += 3;
    s += ', DevID: 0x' + hex(devId, 4) + '-' + id2name(devId);
    s += ', FnCnt: ' + frcntr;
    s += ', CtrID: 0x' + hex(ctrl, 4);
    s += ctrl & 0x100 ? ' Registered and bound' : ' Not bound';
    if (ctrl & 0x200) s += ', Request APP to register and bind';
    switch ((ctrl >> 10) & 3) {
      case 0: s += ', Old version certification'; break;
      case 1: s += ', Safety certification'; break;
      case 2: s += ', Standard certification'; break;
      default: break;
    }
    if (ctrl & 0x10 && b.byteLength >= i + 6) {
      mac = macRev(buf, i);
      s += ', MAC: ' + mac;
      i += 6;
    }
    if (ctrl & 0x20 && b.byteLength >= i + 1) {
      const cap = b.getUint8(i);
      i += 1;
      s += ', Capability: 0x' + hex(cap, 2);
      s += [' - no binding', ' - front binding', ' - back binding', ' - Combo'][(cap >> 3) & 3];
      if (cap & 0x20 && b.byteLength >= i + 2) {
        s += ', IO: 0x' + hex(b.getUint16(i, true), 4);
        i += 2;
      }
    }
    if (ctrl & 0x40 && b.byteLength >= i + 4) {
      if (ctrl & 8) {
        s += ', Data encrypted';
      } else {
        const dataId = b.getUint16(i, true);
        const dataLen = b.getUint8(i + 2);
        i += 3;
        if (b.byteLength >= i + dataLen) {
          switch (dataId) {
            case 0x1006:
              if (dataLen === 2) s += ', Humi: ' + b.getInt16(i, true) / 10.0 + '%';
              break;
            case 0x1004:
              if (dataLen === 2) s += ', Temp: ' + b.getInt16(i, true) / 10.0 + '°C';
              break;
            case 0x100a:
              if (dataLen === 1) {
                s += ', Bat: ' + b.getUint8(i) + '%';
                if (b.byteLength >= i + 3 && b.getUint8(i + 1) === 2) s += ', Vbat: ' + b.getUint16(i + 2, true) + ' mV';
              }
              break;
            case 0x100d:
              if (dataLen === 4 && b.byteLength >= i + 4) {
                s += ', Temp: ' + b.getInt16(i, true) / 10.0 + '°C Humi: ' + b.getInt16(i + 2, true) / 10.0 + '%';
              }
              break;
            case 0x1019:
              if (dataLen === 1) s += ', Door: ' + door2event(b.getUint8(i));
              break;
            default:
              s += ', DataID: 0x' + hex(dataId, 4);
              if (dataLen === 1) s += ' Value: 0x' + hex(b.getUint8(i), 2);
              else if (dataLen === 2) s += ' Value: 0x' + hex(b.getUint16(i, true), 4);
              else if (dataLen === 4) s += ' Value: 0x' + hex(b.getUint32(i, true), 8);
              else s += ' DataLen: ' + dataLen;
          }
        }
      }
    }
    if (ctrl & 0x80) s += ', Mesh Data';
  }
  return { text: s, mac };
}

function envSensing(b, buf) {
  if (b.byteLength >= 15) {
    // pvvx custom format: 70 58 56 38 C1 A4 69 0A 60 09 25 0B 48 70 04
    const mac = macRev(buf, 0);
    const s = `MAC: ${mac}, Bat: ${b.getUint8(12)}%, Vbat: ${b.getUint16(10, true)} mV, Temp: ${b.getInt16(6, true) / 100.0}°C, Humi: ${
      b.getInt16(8, true) / 100.0
    }%, Count: ${b.getUint8(13)}, Flg: ${b.getUint8(14)}`;
    return { text: s, mac };
  }
  if (b.byteLength === 13) {
    // atc1441 format: A4 C1 38 56 58 70 01 0A 18 48 0B 25 70
    const mac = macFwd(buf, 0);
    const s = `MAC: ${mac}, Bat: ${b.getUint8(9)}%, Vbat: ${b.getUint16(10, false)} mV, Temp: ${b.getInt16(6, false) / 10.0}°C, Humi: ${b.getUint8(8)}%, Count: ${b.getUint8(12)}`;
    return { text: s, mac };
  }
  return { text: 'MAC: ?', mac: null };
}

function cgg1Goose(b, buf) {
  // 0801 AE1610342D58 0104 1401 4601 0201 58
  if (b.byteLength >= 17 && b.getUint16(0, true) === 0x0108 && b.getUint16(8, true) === 0x0401 && b.getUint16(14, true) === 0x0102) {
    const mac = macFwd(buf, 2);
    return { text: `MAC: ${mac}, Bat: ${b.getUint8(16)}%, Temp: ${b.getInt16(10, true) / 10.0}°C, Humi: ${b.getInt16(12, true) / 10.0}%`, mac };
  }
  return { text: 'MAC: ?', mac: null };
}

function qingping(b, buf) {
  const len = b.byteLength;
  if (len < 11 || (b.getUint8(0) & 0x3f) !== 0x08) return { text: 'MAC: ?', mac: null };
  const deviceId = b.getUint8(1);
  const mac = macFwd(buf, 2);
  let s = 'MAC: ' + mac;
  s += { 0x01: ' CGG1 "Goose"', 0x07: ' CGG1', 0x09: ' CGP1W', 0x0c: ' CGD1', 0x12: ' CGPR1' }[deviceId] || '';
  let p = 10;
  while (p < len) {
    const id = b.getUint8(p - 2);
    const size = b.getUint8(p - 1);
    if (p + size > len) break;
    if (id === 0x01 && size === 4) s += `, Temp: ${b.getInt16(p, true) / 10.0}°C, Humi: ${b.getInt16(p + 2, true) / 10.0}%`;
    else if (id === 0x02 && size === 1) s += `, Bat: ${b.getUint8(p)}%`;
    else if (id === 0x07 && size === 2) s += `, Pressure: ${b.getInt16(p, true) / 100.0}`;
    else if (id === 0x08 && size === 4) s += `, Motion: ${b.getUint8(p)} & Light: ${b.getUint16(p + 1, true) + b.getUint8(p + 3) * 256}`;
    else if (id === 0x09 && size === 4) s += `, Light: ${b.getUint32(p, true)}`;
    else if (id === 0x0f && size === 1) s += `, Count: ${b.getUint8(p)}`;
    else if (id === 0x11 && size === 1) s += b.getUint8(p) === 0 ? ', Light Off' : ', Light On';
    else if (size === 1 || size === 2 || size === 4) s += `, id: 0x${hex(id, 2)} - data: 0x${bytesToHex(buf.slice(p, p + size)).toUpperCase()}`;
    p += size + 2;
  }
  return { text: s, mac };
}

function adScanerTrg(b) {
  if (b.byteLength <= 10) return { text: 'MAC: ?', mac: null };
  const flg = b.getUint8(10);
  const s =
    `AdScanerTrg# Temp: ${(b.getInt16(0, true) / 100.0).toFixed(2)}, Humi: ${(b.getInt16(2, true) / 100.0).toFixed(2)}` +
    `, Lumi: ${b.getInt16(4, true).toFixed(0)}, MTimer: ${b.getUint16(6, true)}, HiMotion: ${b.getUint8(8)}, JLight: ${b.getUint8(9)}` +
    `, Flg: 0x${hex(flg, 2)} # ReedSwitchOut: ${flg & 1}, TempHumiOut: ${(flg >> 1) & 1}, LightMotionOut: ${(flg >> 2) & 1}` +
    `, TempEvent: ${(flg >> 3) & 1}, HumiEvent: ${(flg >> 4) & 1}, LightEvent: ${(flg >> 5) & 1}`;
  return { text: s, mac: null };
}

function bthomeV1(b) {
  if (b.byteLength <= 1) return { text: 'MAC: ?', mac: null };
  let s = 'BTHomeV1';
  const len = b.byteLength;
  let i = 0;
  while (i < len) {
    const sl = b.getUint8(i) & 31;
    if (i + sl + 1 > len) break;
    const st = b.getUint8(i) >> 5;
    if (sl > 0) {
      const dd = b.getUint8(i + 1);
      const e = TAB_HABLE[dd];
      const f = e ? e.factor : 1;
      let value = 0;
      if (st === 0) {
        if (sl === 2) value = b.getUint8(i + 2);
        else if (sl === 3) value = b.getUint16(i + 2, true);
        else if (sl === 4) value = b.getUint16(i + 2, true) + (b.getUint8(i + 4) << 16);
        else if (sl === 5) value = b.getUint32(i + 2, true);
        if (f !== 1) value = (value * f).toFixed(3);
      } else if (st === 1) {
        if (sl === 2) value = b.getInt8(i + 2);
        else if (sl === 3) value = b.getInt16(i + 2, true);
        else if (sl === 4) value = b.getUint16(i + 2, true) | (b.getInt8(i + 4) << 16);
        else if (sl === 5) value = b.getInt32(i + 2, true);
        if (f !== 1) value = (value * f).toFixed(3);
      } else value = '?';
      s += e ? `, ${e.name}: ${value}${e.unit}` : `, ${st}?: ${value}`;
    }
    i += sl + 1;
  }
  return { text: s, mac: null };
}

function bthomeV2(b) {
  if (b.byteLength <= 1) return { text: 'MAC: ?', mac: null };
  const ver = b.getUint8(0);
  if ((ver & 0xe0) !== 0x40) return { text: 'MAC: ?', mac: null };
  let s = 'BTHomeV' + (ver >> 5);
  if (ver & 1) return { text: s + ', Data encrypted', mac: null };
  const last = b.byteLength - 1; // index of the last byte
  let p = 1;
  while (p < last) {
    const id = b.getUint8(p);
    let size;
    if (id === 0xf0) {
      size = 2;
      if (p + size > last) break;
      s += ', device type id: ' + b.getUint16(p + 1, true);
    } else if (id === 0xf1) {
      size = 4;
      if (p + size > last) break;
      s += `, FW ver: ${b.getUint8(p + 4)}.${b.getUint8(p + 3)}.${b.getUint8(p + 2)}.${b.getUint8(p + 1)}`;
    } else if (id === 0xf2) {
      size = 3;
      if (p + size > last) break;
      s += `, FW ver: ${b.getUint8(p + 3)}.${b.getUint8(p + 2)}.${b.getUint8(p + 1)}`;
    } else if (id === 0x53 || id === 0x54) {
      const n = b.getUint8(p + 1);
      size = n + 1;
      if (p + size > last) break;
      const bytes = new Uint8Array(b.buffer, b.byteOffset + p + 2, n);
      s += id === 0x53 ? ', text: ' + new TextDecoder('utf-8').decode(bytes) : ', raw: ' + bytesToHex(bytes);
    } else if (id <= 0x60) {
      const flg = TAB_BTHOME[id].f;
      size = flg & 0x0f;
      if (size === 0 || p + size > last) break;
      let v;
      if ((flg & 0x80) === 0) {
        if (size === 1) v = b.getUint8(p + 1);
        else if (size === 2) v = b.getUint16(p + 1, true);
        else if (size === 3) v = (b.getUint8(p + 3) << 16) | b.getUint16(p + 1, true);
        else if (size === 4) v = b.getUint32(p + 1, true);
        else break;
      } else {
        if (size === 1) v = b.getInt8(p + 1);
        else if (size === 2) v = b.getInt16(p + 1, true);
        else if (size === 3) v = (b.getInt8(p + 3) << 16) | b.getUint16(p + 1, true);
        else if (size === 4) v = b.getInt32(p + 1, true);
        else break;
      }
      const e = TAB_BTHOME[id];
      s += (flg & 0x40) === 0 ? `, ${e.name}: ${(v * e.factor).toFixed((flg & 0x30) >> 4)}` : `, ${e.name}: ${v}`;
    } else break;
    p += size + 1;
  }
  return { text: s, mac: null };
}

/** Decode one service-data entry. `b` is a DataView. Returns { text, mac }. */
export function describeServiceData(uuid, b) {
  const buf = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  switch (String(uuid).toLowerCase()) {
    case SVC('fe95'): return miBeacon(b, buf);
    case SVC('181a'): return envSensing(b, buf);
    case SVC('fff9'): return cgg1Goose(b, buf);
    case SVC('fdcd'): return qingping(b, buf);
    case SVC('1f11'): return adScanerTrg(b);
    case SVC('181c'): return bthomeV1(b);
    case SVC('181e'): return { text: 'BTHomeV1, Data encrypted', mac: null };
    case SVC('fcd2'): return bthomeV2(b);
    default: return { text: 'MAC: ?', mac: null };
  }
}
