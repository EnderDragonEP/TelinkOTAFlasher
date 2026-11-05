// Static lookup tables (ported 1:1 from pvvx's TelinkMiFlasher.html).

/** Hardware ids reported by the custom firmware (index = hwver_id). */
export const HW_VERSION_STR = [
  'LYWSD03MMC', // 0  B1.4
  'MHO-C401(old)', // 1
  'CGG1-M(2020,2021)', // 2
  'LYWSD03MMC', // 3  B1.9
  'LYWSD03MMC', // 4  B1.6
  'LYWSD03MMC', // 5  B1.7|B2.0
  'CGDK2', // 6
  'CGG1-M(2022)', // 7
  'MHO-C401(2022)', // 8
  'MJWSD05MMC(ch)', // 9
  'LYWSD03MMC', // 10 B1.5
  'MHO-C122', // 11
  'MJWSD05MMC(en)', // 12
  'MJWSD06MMC', // 13
  'LYWSD03MMC', // 14 B1.6/B1.1(2025)
  'ID15', // 15
  'TB03F', // 16
  'TS0201', // 17
  'TNKS', // 18
  'THB2', // 19
  'BTH01', // 20
  'TH05', // 21
  'TH03Z', // 22
  'THB1', // 23
  'TH05D', // 24
  'TH05F', // 25
  'THB3', // 26
  'ZTH01', // 27
  'ZTH02', // 28
  'PLM1', // 29
  'TH03(DIY)', // 30
  'LKTMZL02', // 31
  'KEY2', // 32
  'ZTH05', // 33
  'TH04', // 34
  'CB3S', // 35
  'HS09', // 36
  'ZY-ZTH02', // 37
  'ZY-ZTH02/03-Pro', // 38
  'ZG-227Z', // 39
  'TS0202_PIR1', // 40
  'TS0202_PIR2', // 41
  'HDP16', // 42
  'TN_6ATAG3', // 43
  'ZG-303Z', // 44
  'ZBeacon-TH01', // 45
  'ZBeaconMC', // 46
  'ZBeaconMC2', // 47
  'RSH_HS03', // 48
  'LYWSD02MMC', // 49
  'ZG204ZL', // 50
  'ZG204ZV', // 51
  'TS0201_WING', // 52
  // 53+ follow the DEVICE_* numbering of the firmware sources and of firmware*.json
  // (the original page's table had drifted by one from here on).
  'ZG-223Z', // 53
  'DIY-SCD41', // 54
  'ZG-204ZV1', // 55
  'ZG-204ZV2', // 56
  'ZG-204ZV2-TH', // 57
  'ZBEACON-TH01-v2', // 58
  'TH03_ZBPS1.0', // 59
  'ZG-204ZS', // 60
  'KCTW1Z', // 61
  'MJWSD07MMC(ch)', // 62
];

export const ID_SENSOR_STR = [
  'None', 'SHTV3(C3)', 'SHT4x', 'SHT30', 'CHT8305', 'ANT20/30', 'CHT8215', 'INA226',
  'MY18B20', 'MY18B20x2', 'HX71X', 'PWMRH', 'NTC', 'INA3221', 'SCD41', 'BME280',
];

/** Xiaomi product ids (MiBeacon) -> model name. */
const TAB_ID2NAME = new Map([
  [0x01aa, 'LYWSDCGQ'], [0x045b, 'LYWSD02'], [0x16e4, 'LYWSD02MMC'], [0x2542, 'LYWSD02MMC'],
  [0x055b, 'LYWSD03MMC'], [0x1203, 'XMWSDJ04MMC'], [0x04e1, 'XMMF01JQD'], [0x0098, 'HHCCJCY01'],
  [0x03bc, 'GCLS002'], [0x015d, 'HHCCPOT002'], [0x040a, 'WX08ZM'], [0x098b, 'MCCGQ02HL'],
  [0x0083, 'YM-K1501'], [0x0113, 'YM-K1501EU'], [0x045c, 'V-SK152'], [0x0863, 'SJWS01LM'],
  [0x07f6, 'MJYD02YL'], [0x03dd, 'MUE4094RT'], [0x0a8d, 'RTCGQ02LM'], [0x00db, 'MMC-T201-1'],
  [0x0489, 'M1S-T500'], [0x0c3c, 'CGC1'], [0x0576, 'CGD1'], [0x066f, 'CGDK2'], [0x0347, 'CGG1'],
  [0x0b48, 'CGG1-ENCRYPTED'], [0x03d6, 'CGH1'], [0x0a83, 'CGPR1'], [0x06d3, 'MHO-C303'],
  [0x0387, 'MHO-C401'], [0x02df, 'JQJCY01YM'], [0x0997, 'JTYJGD03MI'], [0x1568, 'K9B-1BTN'],
  [0x1569, 'K9B-2BTN'], [0x0dfd, 'K9B-3BTN'], [0x07bf, 'YLAI003'], [0x0153, 'YLYK01YL'],
  [0x068e, 'YLYK01YL-FANCL'], [0x04e6, 'YLYK01YL-VENFAN'], [0x03bf, 'YLYB01YL-BHFRC'],
  [0x03b6, 'YLKG07YL/YLKG08YL'], [0x069e, 'ZNMS16LM'], [0x069f, 'ZNMS17LM'], [0x04e9, 'MJZNMSQ01YD'],
  [0x098c, 'XMZNMST02YD'], [0x2832, 'MJWSD05MMC'], [0x4c47, 'MJWSD05MMC'], [0x55b5, 'MJWSD06MMC'],
  [0x5bea, 'MJWSD06MMC'], [0x9ab9, 'MJWSD07MMC'],
]);
export const id2name = (id) => TAB_ID2NAME.get(id) ?? '?';

const DOOR_EVENTS = ['opened', 'closed', 'closing timeout', 'device reset'];
export const door2event = (id) => DOOR_EVENTS[id] ?? '?';

/** BTHome v1 object ids. */
export const TAB_HABLE = [
  { name: 'PacketId', unit: '', factor: 1 },
  { name: 'battery', unit: '%', factor: 1 },
  { name: 'temperature', unit: '°C', factor: 0.01 },
  { name: 'humidity', unit: '%', factor: 0.01 },
  { name: 'pressure', unit: 'hPa', factor: 0.01 },
  { name: 'illuminance', unit: 'lux', factor: 0.01 },
  { name: 'weight', unit: 'kg', factor: 0.01 },
  { name: 'weight', unit: 'kg', factor: 1 },
  { name: 'dewpoint', unit: '°C', factor: 0.01 },
  { name: 'count', unit: '', factor: 1 },
  { name: 'energy', unit: 'kWh', factor: 0.001 },
  { name: 'power', unit: 'W', factor: 0.01 },
  { name: 'voltage', unit: 'V', factor: 0.001 },
  { name: 'pm2x5', unit: 'kg/m3', factor: 1 },
  { name: 'pm10', unit: 'kg/m3', factor: 1 },
  { name: 'boolean', unit: '', factor: 1 },
  { name: 'switch', unit: '', factor: 1 },
  { name: 'opened', unit: '', factor: 1 },
];

// BTHome v2 object ids 0x00..0x60. `f`: bit7 signed, bits4-5 decimals, bit6 "binary", bits0-3 size.
const B = (f, name, unit = '', factor = 1) => ({ f, name, unit, factor });
const NONE = B(0, '', '', 0);
export const TAB_BTHOME = [
  // 0x
  B(0x01, 'packet id'), B(0x01, 'battery', '%'), B(0xa2, 'temperature', '°C', 0.01), B(0x22, 'humidity', '%', 0.01),
  B(0x23, 'pressure', 'hPa', 0.01), B(0x23, 'illuminance', 'lux', 0.01), B(0x22, 'mass', 'kg', 0.01), B(0x22, 'mass', 'lb', 0.01),
  B(0xa2, 'dewpoint', '°C', 0.01), B(0x01, 'count'), B(0x33, 'energy', 'kWh', 0.001), B(0x23, 'power', 'W', 0.01),
  B(0x32, 'voltage', 'V', 0.001), B(0x02, 'pm2.5', 'ug/m3'), B(0x02, 'pm10', 'ug/m3'), B(0x41, 'boolean'),
  // 1x
  B(0x41, 'power'), B(0x41, 'opening'), B(0x02, 'co2', 'ppm'), B(0x02, 'tvoc', 'ug/m3'),
  B(0x32, 'moisture', '%', 0.01), B(0x41, 'battery'), B(0x41, 'battery charging'), B(0x41, 'carbon monoxide'),
  B(0x41, 'cold'), B(0x41, 'connectivity'), B(0x41, 'door'), B(0x41, 'garage door'),
  B(0x41, 'gas'), B(0x41, 'heat'), B(0x41, 'light'), B(0x41, 'lock'),
  // 2x
  B(0x41, 'moisture'), B(0x41, 'motion'), B(0x41, 'moving'), B(0x41, 'occupancy'),
  B(0x41, 'plug'), B(0x41, 'presence'), B(0x41, 'problem'), B(0x41, 'running'),
  B(0x41, 'safety'), B(0x41, 'smoke'), B(0x41, 'sound'), B(0x41, 'tamper'),
  B(0x41, 'vibration'), B(0x41, 'window'), B(0x01, 'humidity', '%'), B(0x01, 'moisture', '%'),
  // 3x
  NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE,
  B(0x01, 'button'), NONE, B(0x02, 'dimmer'), B(0x02, 'count'), B(0x04, 'count'), B(0x12, 'rotation', '°', 0.1),
  // 4x
  B(0x02, 'distance', 'mm'), B(0x12, 'distance', 'm'), B(0x33, 'duration', 's', 0.001), B(0x32, 'current', 'A', 0.001),
  B(0x22, 'speed', 'm/s', 0.01), B(0x12, 'temperature', '°C', 0.1), B(0x11, 'UV index', '', 0.1), B(0x12, 'volume', 'L', 0.1),
  B(0x02, 'volume', 'mL'), B(0x32, 'volume flow rate', 'm3/hr', 0.001), B(0x12, 'voltage', 'V', 0.1), B(0x33, 'gas', 'm3', 0.001),
  B(0x34, 'gas', 'm3', 0.001), B(0x34, 'energy', 'kWh', 0.001), B(0x34, 'volume', 'L', 0.001), B(0x34, 'water', 'L', 0.001),
  // 5x
  B(0x04, 'timestamp'), B(0x32, 'acceleration', 'm/s²', 0.001), B(0x32, 'gyroscope', '°/s', 0.001), B(0x0f, 'text', '', 0),
  B(0x1f, 'raw', '', 0), B(0x34, 'volume storage', 'L', 0.001), B(0x02, 'conductivity', 'uS/cm'), B(0x81, 'temperature', '°C'),
  B(0x81, 'temperature', '°C', 0.35), B(0x81, 'count'), B(0x82, 'count'), B(0x84, 'count'),
  B(0xa4, 'power', 'W', 0.01), B(0xb2, 'current', 'A', 0.001), B(0x22, 'direction', '°', 0.01), B(0x13, 'precipitation', 'mm', 0.1),
  // 6x
  B(0x01, 'channel'),
];

export const OTA_ERRORS = [
  'Success',
  'Lost one or more packets',
  'CRC error in data',
  'Writing data to flash',
  'Lost last one or more packets',
  'Timeout',
  'Firmware CRC check',
];

/** RF TX power register values (value -> label) supported by the custom firmware. */
export const RF_TX_POWER = [
  [63, 'VBAT +10.46 dBm'], [61, 'VBAT +10.29 dBm'], [58, 'VBAT +10.01 dBm'], [56, 'VBAT +9.81 dBm'],
  [53, 'VBAT +9.48 dBm'], [51, 'VBAT +9.24 dBm'], [49, 'VBAT +8.97 dBm'], [47, 'VBAT +8.73 dBm'],
  [45, 'VBAT +8.44 dBm'], [43, 'VBAT +8.13 dBm'], [41, 'VBAT +7.79 dBm'], [39, 'VBAT +7.41 dBm'],
  [37, 'VBAT +7.02 dBm'], [35, 'VBAT +6.60 dBm'], [33, 'VBAT +6.14 dBm'], [31, 'VBAT +5.65 dBm'],
  [29, 'VBAT +5.13 dBm'], [27, 'VBAT +4.57 dBm'], [25, 'VBAT +3.94 dBm'], [23, 'VBAT +3.23 dBm'],
  [191, 'VANT +3.01 dBm (default)'], [189, 'VANT +2.81 dBm'], [187, 'VANT +2.61 dBm'], [185, 'VANT +2.39 dBm'],
  [182, 'VANT +1.99 dBm'], [180, 'VANT +1.73 dBm'], [178, 'VANT +1.45 dBm'], [176, 'VANT +1.17 dBm'],
  [174, 'VANT +0.90 dBm'], [172, 'VANT +0.58 dBm'], [169, 'VANT +0.04 dBm'], [168, 'VANT -0.14 dBm'],
  [164, 'VANT -0.97 dBm'], [162, 'VANT -1.42 dBm'], [160, 'VANT -1.89 dBm'], [158, 'VANT -2.48 dBm'],
  [156, 'VANT -3.03 dBm'], [154, 'VANT -3.61 dBm'], [152, 'VANT -4.26 dBm'], [150, 'VANT -5.03 dBm'],
  [148, 'VANT -5.81 dBm'], [146, 'VANT -6.67 dBm'], [144, 'VANT -7.65 dBm'], [142, 'VANT -8.65 dBm'],
  [140, 'VANT -9.89 dBm'], [138, 'VANT -11.4 dBm'], [136, 'VANT -13.29 dBm'], [134, 'VANT -15.88 dBm'],
  [132, 'VANT -19.27 dBm'], [130, 'VANT -25.18 dBm'],
];

/** 7-segment digit codes for the LYWSD03MMC "show clock" LCD test. */
export const LCD_DIGCODE = [0xf5, 0x05, 0xd3, 0x97, 0x27, 0xb6, 0xf6, 0x15, 0xf7, 0xb7];
