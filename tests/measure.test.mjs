// Live / history parsing, dew point, LCD command and CSV formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomMeasure, parseEssTemperature, parseEssHumidity, dewPoint, dewPointLcdCommand, parseMemoRecord, parseStockRecord, memoCsv, stockCsv, stats, plausibleTime } from '../assets/js/measure.js';

const dv = (bytes) => new DataView(new Uint8Array(bytes).buffer);
const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

test('custom 0x33 measurement', () => {
  assert.deepEqual(parseCustomMeasure(dv([0x33, ...le16(2980), ...le16(2345), ...le16(4567), 17, 1])), { vbat: 2980, temp: 23.45, humi: 45.67, count: 17 });
  assert.equal(parseCustomMeasure(dv([0x33, 0xff])), null);
  assert.equal(parseCustomMeasure(dv([0x55, 0, 0, 0, 0, 0, 0, 0])), null);
});

test('Environmental Sensing values', () => {
  assert.equal(parseEssTemperature(dv(le16(2345)), 0x2a6e), 23.45);
  assert.equal(parseEssTemperature(dv(le16(-55 & 0xffff)), 0x2a1f), -5.5);
  assert.equal(parseEssHumidity(dv(le16(4567))), 45.67);
});

test('dew point matches the DevPoint formula', () => {
  // reference: original expression evaluated for t = 25 °C, h = 60 %
  const t = 25;
  const h = 60;
  const H = (Math.log10(h) - 2) / 0.4343 + (17.62 * t) / (243.12 + t);
  assert.equal(dewPoint(t, h), (243.12 * H) / (17.62 - H));
  assert.ok(Math.abs(dewPoint(25, 60) - 16.69) < 0.05);
});

test('DevPoint LCD command bytes', () => {
  // original: blk = [0x22, dp & 0xff, dp >> 8, humi & 0xff, humi >> 8, 100, 0, 0xef] with dp = round(dewpoint*10)
  assert.deepEqual([...dewPointLcdCommand(16.694, 45.67)], [0x22, 167, 0, 45, 0, 100, 0, 0xef]);
  assert.deepEqual([...dewPointLcdCommand(-3.26, 20.9)], [0x22, (-33) & 0xff, 0xff, 20, 0, 100, 0, 0xef]);
});

test('history records', () => {
  assert.deepEqual(parseMemoRecord(dv([0x35, ...le16(3), ...le32(0x6a000000), ...le16(2301), ...le16(4501), ...le16(3000)])), {
    count: 3,
    time: 0x6a000000,
    temp: 23.01,
    humi: 45.01,
    vbat: 3000,
  });
  assert.equal(parseMemoRecord(dv([0x35, 0, 0])), null);
  const r = parseStockRecord(dv([...le32(5), ...le32(86400), ...le16(251), 60, ...le16(205), 40]));
  assert.deepEqual(r, { index: 5, time: 86400, tempHi: 25.1, humiHi: 60, tempLo: 20.5, humiLo: 40, temp: 22.8, humi: 50 });
  assert.equal(plausibleTime(1609459200), false);
  assert.equal(plausibleTime(1700000000), true);
});

test('history CSV keeps the original GraphMemo columns', () => {
  const csv = memoCsv('ATC_1234', [
    { time: 1700000000, temp: 23.1, humi: 45.2, vbat: 3001 },
    { time: 1700000600, temp: 23.4, humi: 45.0, vbat: 3000 },
  ]);
  assert.equal(csv, 'ATC_1234\nTime-Data=(A2/86400)+25569;Temp;Humi;Vbat;DeviceTime\n1700000600;23.4;45;3000;2023-11-14 22:23:20\n1700000000;23.1;45.2;3001;2023-11-14 22:13:20\n');
  const s = stockCsv([{ ms: 1700000000000, tempLo: 20.5, tempHi: 25.1, humiLo: 40, humiHi: 60, temp: 22.8, humi: 50 }]);
  assert.match(s, /^Time-Data:\(A2\/86400000\)\+25569;T1;T2;H1;H2;Tavg;Havg;LocalTime\n1700000000000;20.5;25.1;40;60;22.8;50;/);
});

test('stats', () => {
  assert.deepEqual(stats([1, 2, null, 3, NaN]), { min: 1, max: 3, avg: 2, n: 3 });
  assert.equal(stats([]).n, 0);
});
