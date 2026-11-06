// Firmware image handling: index download, Telink/Zigbee OTA image validation,
// signature appending for locked stock firmware and OTA block preparation.
// The validation functions are pure and unit-tested in tests/firmware.test.mjs.
import { hex, crc32, crc16Modbus, bytesToHex, concatBytes, toU8 } from './util.js';
import { SOURCES, FETCH_TIMEOUT_MS } from './config.js';
import { MAX_EXT_OTA_SIZE } from './state.js';

const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Validate an OTA image (port of the original testOTAFirmware()).
 * ctx: { bigOtaEnabled, fwMaxSize }
 * Returns { status: 'ok' | 'sign' | <error message>, zigbee: null | {...} }.
 */
export function validateOtaImage(buffer, ctx, log = noopLog) {
  let data = buffer instanceof ArrayBuffer ? buffer : toU8(buffer).slice().buffer;
  let fsize = data.byteLength;
  let zigbee = null;
  log.debug('File size = 0x' + fsize.toString(16));
  if (fsize < 1024) return { status: 'Wrong binary Telink OTA firmware size!', zigbee };
  let head = new DataView(data, 0, 0x40);
  if (head.getUint32(0, true) === 0x0beef11e) {
    // Zigbee OTA file: 56 byte header + sub-element (tag, length) + Telink image
    if (head.getUint16(4, true) !== 0x100 || head.getUint16(6, true) !== 56) return { status: 'Unknown Zigbee OTA header!', zigbee };
    zigbee = {
      size: head.getUint32(0x3a, true),
      manCode: head.getUint16(0x0a, true),
      imageType: head.getUint16(0x0c, true),
      fwVersion: head.getUint32(0x0e, true),
      otaVersion: head.getUint8(0x12),
    };
    if (zigbee.size < 2048 || zigbee.size + 0x3e > fsize) return { status: 'Wrong binary Zigbee OTA firmware size!', zigbee: null };
    fsize = zigbee.size;
    const v = zigbee.fwVersion;
    log.info(`Zigbee OTA Info: ManCode: ${hex(zigbee.manCode, 4)}, ImageType: ${hex(zigbee.imageType, 4)}, FwVer: ${hex(v, 8)}`);
    log.info(
      `APP Release: ${(v >> 28) & 0x0f}.${(v >> 24) & 0x0f} Build: ${(v >> 20) & 0x0f}.${(v >> 16) & 0x0f}` +
        `, Stack Version: ${(v >> 12) & 0x0f}.${(v >> 8) & 0x0f} Release: ${(v >> 4) & 0x0f}.${v & 0x0f}`,
    );
    if (!ctx.bigOtaEnabled) {
      if (zigbee.imageType >= 0x0203 && zigbee.imageType <= 0x0205)
        return { status: `The current firmware version does not support OTA for image type \`${hex(zigbee.imageType, 4)}\`.`, zigbee: null };
      if (fsize > ctx.fwMaxSize)
        return { status: 'The current firmware version does not support EXT OTA. Update the new custom BLE version (4.6 or higher)!', zigbee: null };
    } else if (fsize > MAX_EXT_OTA_SIZE) {
      return { status: 'Size firmware is more 208 kbytes!', zigbee: null };
    }
    data = data.slice(0x3e);
    head = new DataView(data, 0, 0x20);
  } else if (ctx.bigOtaEnabled) {
    if (fsize > MAX_EXT_OTA_SIZE) return { status: 'Size firmware is more 208 kbytes!', zigbee };
  } else if (fsize > ctx.fwMaxSize) {
    return { status: `Size firmware is more ${ctx.fwMaxSize} bytes!`, zigbee };
  }
  if (head.getUint32(0x08, true) !== 0x544c4e4b) return { status: 'Incorrect head in Telink OTA binary firmware', zigbee: null };
  const hsize = head.getUint32(0x18, true);
  log.debug('Size in head = 0x' + hsize.toString(16));
  if (hsize > fsize || (hsize & 0x0f) !== 4) return { status: 'Invalid size pointer in Telink OTA binary firmware!', zigbee: null };
  const calc = crc32(new Uint8Array(data, 0, hsize - 4));
  const stored = new DataView(data, hsize - 4, 4).getUint32(0, true);
  log.debug(`File CRC = 0x${stored.toString(16)}, Check CRC = 0x${calc.toString(16)}`);
  if (calc !== stored) return { status: 'Incorrect CRC in Telink OTA binary firmware!', zigbee: null };
  if (hsize < fsize && fsize - hsize > 1024) {
    if (bytesToHex(new Uint8Array(data, hsize, 12)) === '000000004d49ef54464f5441') return { status: 'sign', zigbee };
  }
  return { status: 'ok', zigbee };
}

/**
 * Append a Xiaomi OTA signature blob (signfiles/*.bin) to a firmware image
 * (port of the original getSignFile()). Throws on an invalid signature file.
 */
export function appendSignature(fw, signBuffer) {
  const fwsize = fw.length;
  const cdata = toU8(signBuffer).slice();
  let cl = cdata[0] | (cdata[1] << 8);
  if (cl < 64 || cl > cdata.byteLength) throw new Error('Invalid signature file!');
  let crc = crc32(cdata.subarray(0, cl));
  cdata[0x14] = fwsize & 0xff;
  cdata[0x15] = (fwsize >> 8) & 0xff;
  cdata[0x16] = (fwsize >> 16) & 0xff;
  cdata[0x17] = (fwsize >> 24) & 0xff;
  const parts = [fw, new Uint8Array(4), cdata.slice(4, cl)];
  if (cl < cdata.byteLength) {
    let x = cdata[cl] | (cdata[cl + 1] << 8);
    cl += 2;
    const xdata = new Uint8Array((crc ^ x) & 0xffff).fill(0xff);
    crc &= 0xffff0000;
    crc |= x;
    while (cl < cdata.byteLength) {
      x = cdata[cl] | (cdata[cl + 1] << 8);
      cl += 2;
      const lx = (crc ^ x) & 0xffff;
      crc &= 0xffff0000;
      crc |= x;
      x = cdata[cl] | (cdata[cl + 1] << 8) | (cdata[cl + 2] << 16) | (cdata[cl + 3] << 24);
      cl += 4;
      crc ^= x;
      xdata[lx] = crc & 0xff;
      xdata[lx + 1] = (crc >> 8) & 0xff;
      xdata[lx + 2] = (crc >> 16) & 0xff;
      xdata[lx + 3] = (crc >> 24) & 0xff;
      crc = x;
    }
    parts.push(xdata);
  }
  return concatBytes(...parts);
}

/** Telink "KNLT" signature at offset 8 (the only check pvvx's OTA / UART pages made). */
export const hasTelinkMagic = (u8) => u8.length >= 16 && u8[8] === 0x4b && u8[9] === 0x4e && u8[10] === 0x4c && u8[11] === 0x54;

/** Pad to a multiple of 16 bytes with 0xFF (OTA block size). */
export function padTo16(u8) {
  const rem = u8.length % 16;
  if (!rem) return u8;
  const out = new Uint8Array(u8.length + 16 - rem).fill(0xff);
  out.set(u8);
  return out;
}

/** One Telink OTA packet: index (LE16) + 16 data bytes + CRC16/MODBUS (LE16). */
export function otaPacket(data, blockNr) {
  const pkt = new Uint8Array(20);
  pkt[0] = blockNr & 0xff;
  pkt[1] = (blockNr >> 8) & 0xff;
  pkt.set(data.subarray(blockNr * 16, blockNr * 16 + 16), 2);
  const crc = crc16Modbus(pkt.subarray(0, 18));
  pkt[18] = crc & 0xff;
  pkt[19] = (crc >> 8) & 0xff;
  return pkt;
}

/** Final OTA packet: 02ff + last index + ~last index. */
export function otaEndPacket(blockCount) {
  const last = (blockCount - 1) & 0xffff;
  const inv = ~(blockCount - 1) & 0xffff;
  return new Uint8Array([0x02, 0xff, last & 0xff, (last >> 8) & 0xff, inv & 0xff, (inv >> 8) & 0xff]);
}

// ---------------------------------------------------------------------------
// Downloads

export async function fetchBinary(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.arrayBuffer();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout downloading ${url}`);
    if (err instanceof TypeError) throw new Error(`Download failed for ${url} (offline, or the server does not allow cross-origin downloads)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url) {
  const buf = await fetchBinary(url);
  return JSON.parse(new TextDecoder('utf-8').decode(buf));
}

/** A firmware.json entry is usable if it is not empty / "?" / "/". */
export const isValidEntry = (fn) => typeof fn === 'string' && fn !== '' && fn !== '?' && fn !== '/';

export const resolveFirmwareUrl = (fn) => (fn.slice(0, 6) === 'https:' ? fn : SOURCES.rawBase + fn);

export function firmwareFileName(fn) {
  let name = fn;
  try {
    if (name.slice(0, 6) === 'https:') name = new URL(name).pathname.split('/').pop();
  } catch {
    /* keep */
  }
  return name.substring(name.lastIndexOf('/') + 1);
}
