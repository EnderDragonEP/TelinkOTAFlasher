// Measurement parsing, dew point and CSV export for the Live data and History pages.
// Pure functions (no DOM) - unit tested in tests/measure.test.mjs.

/** Custom firmware measurement notification (0x33) as used by GraphAtc2 / DevPoint. */
export function parseCustomMeasure(dv) {
  if (dv.byteLength < 8 || dv.getUint8(0) !== 0x33) return null;
  return {
    vbat: dv.getUint16(1, true), // mV
    temp: dv.getInt16(3, true) / 100.0,
    humi: dv.getUint16(5, true) / 100.0,
    count: dv.getUint8(7),
  };
}

/** Environmental Sensing: Humidity 0x2A6F (0.01 %). */
export const parseEssHumidity = (dv) => dv.getInt16(0, true) / 100.0;

/** Environmental Sensing: Temperature 0x2A6E (0.01 °C) or Temperature Celsius 0x2A1F (0.1 °C). */
export const parseEssTemperature = (dv, uuid16) => dv.getInt16(0, true) / (uuid16 === 0x2a1f ? 10.0 : 100.0);

/** Dew point in °C (Magnus formula, b = 17.62, c = 243.12 °C - same as pvvx's DevPoint page). */
export function dewPoint(temp, humi) {
  const h = (Math.log10(humi) - 2) / 0.4343 + (17.62 * temp) / (243.12 + temp);
  return (243.12 * h) / (17.62 - h);
}

/**
 * DevPoint's "show on the LCD" command (0x22 ext data): big number = dew point x10,
 * small number = humidity (truncated, as the original), shown for 100 s, flags 0xEF.
 */
export function dewPointLcdCommand(dewpoint, humi) {
  const dp = Math.round(dewpoint * 10);
  const blk = new Uint8Array(8);
  blk[0] = 0x22;
  blk[1] = dp & 0xff;
  blk[2] = dp >> 8;
  blk[3] = humi & 0xff;
  blk[4] = humi >> 8;
  blk[5] = 100;
  blk[6] = 0;
  blk[7] = 0xef;
  return blk;
}

/** Custom firmware history record (0x35, len >= 13). `time` is device-local epoch seconds. */
export function parseMemoRecord(dv) {
  if (dv.byteLength < 13 || dv.getUint8(0) !== 0x35) return null;
  return {
    count: dv.getUint16(1, true),
    time: dv.getUint32(3, true),
    temp: dv.getInt16(7, true) / 100.0,
    humi: dv.getUint16(9, true) / 100.0,
    vbat: dv.getUint16(11, true),
  };
}

/** Stock LYWSD03MMC history record (characteristic ebe0ccbc): hourly min/max. */
export function parseStockRecord(dv) {
  if (dv.byteLength < 14) return null;
  const tempHi = dv.getInt16(8, true) / 10.0;
  const humiHi = dv.getUint8(10);
  const tempLo = dv.getInt16(11, true) / 10.0;
  const humiLo = dv.getUint8(13);
  return {
    index: dv.getUint32(0, true),
    time: dv.getUint32(4, true), // device clock seconds
    tempHi,
    humiHi,
    tempLo,
    humiLo,
    temp: (tempHi + tempLo) / 2,
    humi: (humiHi + humiLo) / 2,
  };
}

/** Records written before 2021 (unset clock) are hidden by default, like GraphMemo. */
export const plausibleTime = (t) => t > 1609459200 && t < 2255486400;

const pad = (n) => String(n).padStart(2, '0');
/** "YYYY-MM-DD HH:MM:SS" of a JS time value, in the browser's time zone. */
export function localDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Device-local epoch seconds (custom firmware clock) formatted without time-zone conversion. */
export function deviceDateTime(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Custom firmware history CSV, compatible with pvvx's GraphMemo export (device name line,
 * ';' separated, epoch column, newest record last row-wise reversed as the original) plus a
 * trailing human readable "DeviceTime" column.
 * records: [{ time, temp, humi, vbat }] in the order received.
 */
export function memoCsv(deviceName, records) {
  const lines = [];
  if (deviceName != null) lines.push(deviceName);
  lines.push('Time-Data=(A2/86400)+25569;Temp;Humi;Vbat;DeviceTime');
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    lines.push([r.time, r.temp, r.humi, r.vbat, deviceDateTime(r.time)].join(';'));
  }
  return lines.join('\n') + '\n';
}

/**
 * Stock LYWSD03MMC history CSV, compatible with pvvx's GraphMemoOriginal export
 * (ms timestamps, T1/T2 = min/max temperature, H1/H2 = min/max humidity) plus averages and local time.
 * records: [{ ms, tempLo, tempHi, humiLo, humiHi, temp, humi }]
 */
export function stockCsv(records) {
  const lines = ['Time-Data:(A2/86400000)+25569;T1;T2;H1;H2;Tavg;Havg;LocalTime'];
  for (const r of records) lines.push([r.ms, r.tempLo, r.tempHi, r.humiLo, r.humiHi, r.temp, r.humi, localDateTime(r.ms)].join(';'));
  return lines.join('\n') + '\n';
}

/** Live data CSV: ms timestamp first (like the GraphAtc pages), then the recorded columns. */
export function liveCsv(rows, columns) {
  const lines = ['Time-Data:(A2/86400000)+25569;' + columns.join(';') + ';LocalTime'];
  for (const r of rows) lines.push([r[0], ...r.slice(1).map((v) => (v == null ? '' : v)), localDateTime(r[0])].join(';'));
  return lines.join('\n') + '\n';
}

/** min / max / average of the finite values. */
export function stats(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return n ? { min, max, avg: sum / n, n } : { min: NaN, max: NaN, avg: NaN, n: 0 };
}
