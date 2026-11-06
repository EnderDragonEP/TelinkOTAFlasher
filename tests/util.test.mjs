// Byte helpers, checksums and advertisement decoders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, crc16Modbus, hex, hexToBytes, bytesToHex, parseHex, hex2ascii, macFromLE, formatMac } from '../assets/js/util.js';
import { describeServiceData } from '../assets/js/advertising.js';

const ascii = (s) => new TextEncoder().encode(s);
const dv = (hexStr) => new DataView(hexToBytes(hexStr.replace(/\s+/g, '')).buffer);
const svc = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;

test('checksums: Telink CRC-32 has no final XOR (JAMCRC), OTA packets use CRC-16/MODBUS', () => {
  assert.equal(crc32(ascii('123456789')), 0x340bc6d9); // = ~0xCBF43926 (standard CRC-32)
  assert.equal(crc16Modbus(ascii('123456789')), 0x4b37);
});

test('hex helpers', () => {
  assert.equal(hex(10, 4), '000A');
  assert.equal(bytesToHex(new Uint8Array([0, 15, 255])), '000fff');
  assert.deepEqual([...parseHex('a4:c1:38 00-11-22')], [0xa4, 0xc1, 0x38, 0x00, 0x11, 0x22]);
  assert.equal(parseHex('abc'), null);
  assert.equal(parseHex('zz'), null);
  assert.equal(parseHex('0011', 3), null);
  assert.equal(hex2ascii('414243004445'), 'ABC');
  assert.equal(macFromLE([0x70, 0x58, 0x56, 0x38, 0xc1, 0xa4]), 'A4C138565870');
  assert.equal(formatMac('A4C138565870'), 'A4:C1:38:56:58:70');
});

test('decodes the pvvx custom advertising format', () => {
  const r = describeServiceData(svc('181a'), dv('70 58 56 38 C1 A4 69 0A 60 09 25 0B 48 70 04'));
  assert.equal(r.mac, 'A4C138565870');
  assert.match(r.text, /Bat: 72%, Vbat: 2853 mV, Temp: 26.65°C, Humi: 24%, Count: 112, Flg: 4/);
});

test('decodes the atc1441 advertising format', () => {
  const r = describeServiceData(svc('181a'), dv('A4 C1 38 56 58 70 01 0A 18 48 0B 25 70'));
  assert.equal(r.mac, 'A4C138565870');
  assert.match(r.text, /Bat: 72%, Vbat: 2853 mV, Temp: 26.6°C, Humi: 24%, Count: 112/);
});

test('decodes BTHome v2', () => {
  const r = describeServiceData(svc('fcd2'), dv('40 00 5c 01 64 02 c4 09 03 bf 13'));
  assert.equal(r.text, 'BTHomeV2, packet id: 92, battery: 100, temperature: 25.00, humidity: 50.55');
  assert.equal(describeServiceData(svc('fcd2'), dv('41 00 01')).text, 'BTHomeV2, Data encrypted');
});

test('decodes MiBeacon headers', () => {
  // frame control 0x5050: v5, has MAC, has object; product id 0x055b (LYWSD03MMC), temp 0x1004 = 23.4 °C
  const r = describeServiceData(svc('fe95'), dv('50 50 5b 05 01 70 58 56 38 c1 a4 04 10 02 ea 00'));
  assert.equal(r.mac, 'A4C138565870');
  assert.match(r.text, /DevID: 0x055B-LYWSD03MMC/);
  assert.match(r.text, /Temp: 23.4°C/);
});
