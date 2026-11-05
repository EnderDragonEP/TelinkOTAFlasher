// OTA image validation, signature appending and OTA packet framing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOtaImage, appendSignature, padTo16, otaPacket, otaEndPacket } from '../assets/js/firmware.js';
import { crc32, crc16Modbus, bytesToHex, hexToBytes } from '../assets/js/util.js';

const CTX = { bigOtaEnabled: false, fwMaxSize: 0x20000 };

/** Minimal Telink OTA image: "KNLT" marker, size field at 0x18, CRC32 at the end. */
function telinkImage(size = 0x804, fill = (i) => (i * 7) & 0xff) {
  const img = new Uint8Array(size);
  for (let i = 0; i < size; i++) img[i] = fill(i);
  img.set([0x4b, 0x4e, 0x4c, 0x54], 8); // KNLT
  new DataView(img.buffer).setUint32(0x18, size, true);
  new DataView(img.buffer).setUint32(size - 4, crc32(img.subarray(0, size - 4)), true);
  return img;
}

function zigbeeWrap(img, imageType = 0x020a) {
  const hdr = new Uint8Array(0x3e);
  const dv = new DataView(hdr.buffer);
  dv.setUint32(0, 0x0beef11e, true);
  dv.setUint16(4, 0x100, true);
  dv.setUint16(6, 56, true);
  dv.setUint16(0x0a, 0x1141, true);
  dv.setUint16(0x0c, imageType, true);
  dv.setUint32(0x0e, 0x01403001, true);
  dv.setUint32(0x3a, img.length, true);
  const out = new Uint8Array(hdr.length + img.length);
  out.set(hdr);
  out.set(img, hdr.length);
  return out;
}

test('accepts a valid Telink image', () => {
  assert.equal(validateOtaImage(telinkImage().buffer, CTX).status, 'ok');
});

test('rejects small, corrupted and oversized images', () => {
  assert.match(validateOtaImage(new Uint8Array(100).buffer, CTX).status, /size/);
  const bad = telinkImage();
  bad[100] ^= 1;
  assert.match(validateOtaImage(bad.buffer, CTX).status, /CRC/);
  const noMagic = telinkImage();
  noMagic[8] = 0;
  assert.match(validateOtaImage(noMagic.buffer, CTX).status, /head/);
  assert.match(validateOtaImage(telinkImage(0x20014).buffer, CTX).status, /more 131072 bytes/);
  assert.equal(validateOtaImage(telinkImage(0x20014).buffer, { bigOtaEnabled: true, fwMaxSize: 0x20000 }).status, 'ok');
});

test('parses Zigbee OTA files', () => {
  const r = validateOtaImage(zigbeeWrap(telinkImage()).buffer, CTX);
  assert.equal(r.status, 'ok');
  assert.equal(r.zigbee.size, 0x804);
  assert.equal(r.zigbee.manCode, 0x1141);
  assert.equal(r.zigbee.imageType, 0x020a);
  // image types 0x0203..0x0205 need the extended OTA of custom firmware >= 4.6
  assert.match(validateOtaImage(zigbeeWrap(telinkImage(), 0x0204).buffer, CTX).status, /image type/);
});

test('detects images that already carry a Xiaomi signature', () => {
  const img = telinkImage();
  const sig = new Uint8Array(2000);
  sig.set(hexToBytes('000000004d49ef54464f5441'));
  const full = new Uint8Array(img.length + sig.length);
  full.set(img);
  full.set(sig, img.length);
  assert.equal(validateOtaImage(full.buffer, CTX).status, 'sign');
});

// Reference: the original hex-string implementation of getSignFile() (pvvx TelinkMiFlasher).
function originalGetSignFile(firmwareHex, data) {
  let firmwareArray = firmwareHex;
  const fwsize = firmwareArray.length / 2;
  const cdata = new Uint8Array(data);
  let cl = cdata[0] | (cdata[1] << 8);
  let crc = crc32(new Uint8Array(data.slice(0, cl)));
  cdata[0x14] = fwsize & 0xff;
  cdata[0x15] = (fwsize >> 8) & 0xff;
  cdata[0x16] = (fwsize >> 16) & 0xff;
  cdata[0x17] = (fwsize >> 24) & 0xff;
  firmwareArray += '00000000';
  firmwareArray += bytesToHex(cdata.slice(4, cl));
  if (cl < cdata.byteLength) {
    let x = cdata[cl] | (cdata[cl + 1] << 8);
    cl += 2;
    const xdata = new Uint8Array((crc ^ x) & 0xffff);
    crc &= 0xffff0000;
    crc |= x;
    xdata.fill(0xff);
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
    firmwareArray += bytesToHex(xdata);
  }
  return firmwareArray;
}

test('appendSignature() matches the original algorithm', () => {
  // Synthetic signature blob: 80 byte header, a patch-table length word and some entries.
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  for (let round = 0; round < 20; round++) {
    const hdrLen = 64 + round * 4;
    const entries = 1 + (round % 5);
    const blob = new Uint8Array(hdrLen + 2 + entries * 6);
    for (let i = 0; i < blob.length; i++) blob[i] = rnd();
    blob[0] = hdrLen & 0xff;
    blob[1] = hdrLen >> 8;
    // Keep the (crc ^ x) derived table size and addresses sane, like real signature files.
    const crc = crc32(blob.subarray(0, hdrLen));
    const want = 0x200 + round;
    const x = (crc ^ want) & 0xffff;
    blob[hdrLen] = x & 0xff;
    blob[hdrLen + 1] = x >> 8;
    const fw = telinkImage(0x804 + round * 16);
    const ours = bytesToHex(appendSignature(fw, blob.buffer));
    const theirs = originalGetSignFile(bytesToHex(fw), blob.slice().buffer);
    assert.equal(ours, theirs, `round ${round}`);
  }
  assert.throws(() => appendSignature(new Uint8Array(16), new Uint8Array([10, 0, 1, 2]).buffer), /Invalid signature/);
});

test('OTA packets: index, data and CRC16/MODBUS', () => {
  const data = padTo16(new Uint8Array(40).map((_, i) => i));
  assert.equal(data.length, 48);
  assert.deepEqual([...data.subarray(40)], new Array(8).fill(0xff));
  const p = otaPacket(data, 2);
  assert.equal(bytesToHex(p.subarray(0, 2)), '0200');
  assert.deepEqual([...p.subarray(2, 18)], [...data.subarray(32, 48)]);
  const crc = crc16Modbus(p.subarray(0, 18));
  assert.equal(p[18] | (p[19] << 8), crc);
  assert.equal(bytesToHex(otaEndPacket(5)), '02ff0400fbff');
  assert.equal(bytesToHex(otaEndPacket(0x1234 + 1)), '02ff3412cbed');
});
