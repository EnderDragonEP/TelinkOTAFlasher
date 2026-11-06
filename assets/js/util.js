// Small, dependency-free helpers shared by all modules.
// Everything in this file is pure (no DOM access) so it can be unit tested in Node.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Upper-case, zero padded hex of a number (same semantics as the original `hex()`). */
export function hex(number, len) {
  let str = number.toString(16).toUpperCase();
  while (str.length < len) str = '0' + str;
  return str;
}

/** Normalise ArrayBuffer / TypedArray / DataView / Array into a Uint8Array view. */
export function toU8(data) {
  if (data == null) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

/** Lower-case hex string of all bytes. */
export function bytesToHex(data) {
  const u8 = toU8(data);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
  return s;
}

/** Upper-case hex string of the first `len` bytes (original `dump()`). */
export function dump(data, len) {
  const u8 = toU8(data);
  const n = len === undefined ? u8.length : Math.min(len, u8.length);
  let s = '';
  for (let i = 0; i < n; i++) s += hex(u8[i], 2);
  return s;
}

/** Lenient hex -> bytes (invalid pairs become 0, like the original implementation). */
export function hexToBytes(str) {
  const out = new Uint8Array(Math.ceil(str.length / 2));
  for (let i = 0, c = 0; c < str.length; c += 2, i++) {
    const v = parseInt(str.substr(c, 2), 16);
    out[i] = Number.isNaN(v) ? 0 : v;
  }
  return out;
}

/** Strict hex parser for user input. Ignores spaces, ':' and '-'. Returns null when invalid. */
export function parseHex(str, expectedBytes) {
  const clean = String(str ?? '').replace(/[\s:-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  const bytes = hexToBytes(clean);
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) return null;
  return bytes;
}

export function isHex(str, expectedBytes) {
  return parseHex(str, expectedBytes) !== null;
}

/** hex string -> ASCII, stopping at the first "00" byte (original `hex2ascii()`). */
export function hex2ascii(hexx) {
  const h = String(hexx);
  let str = '';
  for (let i = 0; i < h.length && h.substr(i, 2) !== '00'; i += 2) {
    str += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  }
  return str;
}

export function concatBytes(...parts) {
  const arrays = parts.map(toU8);
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
export const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];

/** CRC-16/MODBUS used by the Telink OTA packets. */
export function crc16Modbus(buffer) {
  let crc = 0xffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      const odd = crc & 0x0001;
      crc >>= 1;
      if (odd) crc ^= 0xa001;
    }
  }
  return crc;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/**
 * CRC-32 (reflected, poly 0xEDB88320, init 0xFFFFFFFF) WITHOUT the final XOR, i.e. CRC-32/JAMCRC.
 * This is what the Telink OTA image check (and the original page) uses.
 */
export function crc32(data) {
  const u8 = toU8(data);
  let crc = -1;
  for (let i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ u8[i]) & 0xff];
  return crc >>> 0;
}

/** Random alphanumeric id, returned as hex of its ASCII codes (original `makeRandomID()`). */
export function makeRandomID(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return bytesToHex(new TextEncoder().encode(result));
}

/** MAC formatted from little-endian bytes: [0..5] -> "A4C138XXXXXX". */
export function macFromLE(u8, offset = 0) {
  let s = '';
  for (let i = 5; i >= 0; i--) s += hex(u8[offset + i], 2);
  return s;
}

export function formatMac(plain) {
  return String(plain).replace(/(..)(?!$)/g, '$1:');
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KiB`;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** "2024-01-02 03:04:05" from a Date (UTC based, like the original log output). */
export function isoDateTime(date, keepMs = true) {
  let s = date.toISOString().slice(0, -1).replace('T', ' ');
  if (!keepMs) s = s.replace('.000', '');
  return s;
}
