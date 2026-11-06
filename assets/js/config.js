// Deployment configuration. Edit these values if you host your own firmware fork.

export const APP = {
  name: 'Telink BLE OTA Flasher',
  version: '1.0.0',
  basedOn: 'TelinkMiFlasher v14.1 by pvvx',
};

export const SOURCES = {
  /** Base URL for relative firmware paths listed in firmware.json and for signature files. */
  rawBase: 'https://raw.githubusercontent.com/pvvx/ATC_MiThermometer/master/',
  /** Firmware index (relative to rawBase or absolute). */
  index: 'firmware.json',
  /** Folder (relative to rawBase) holding OTA signature files for locked stock firmware. */
  signDir: 'signfiles/',
  /** pvvx's hosted companion tools (graphs, other flashers). */
  tools: 'https://pvvx.github.io/ATC_MiThermometer/',
  project: 'https://github.com/pvvx/ATC_MiThermometer',
  zigbeeProject: 'https://github.com/pvvx/ZigbeeTLc',
  thbProject: 'https://github.com/pvvx/THB2',
  thbFlasher: 'https://pvvx.github.io/THB2/web/PHY62x2BTHome.html',
  atc1441Flasher: 'https://atc1441.github.io/TelinkFlasher.html',
  tokenExtractor: 'https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor',
};

/** Pages of this site (shared top navigation). */
export const NAV = [
  { id: 'flasher', href: 'index.html', label: 'Flasher', title: 'Flash firmware, activate and configure devices' },
  { id: 'live', href: 'live.html', label: 'Live data', title: 'Live temperature / humidity chart' },
  { id: 'history', href: 'history.html', label: 'History', title: 'Read the measurement history stored on the device' },
  { id: 'ota', href: 'ota.html', label: 'OTA', title: 'Generic Telink BLE OTA with custom UUIDs' },
  { id: 'uart', href: 'uart.html', label: 'UART flasher', title: 'Wired flashing through a USB-UART adapter (SWire)' },
];

/** pvvx's other tools that are not part of this site ("More" menu). */
export const EXTERNAL_TOOLS = [
  [
    'Other tools by pvvx',
    [
      ['Advertising decoder', 'https://pvvx.github.io/ATC_MiThermometer/Advertising.html'],
      ['ZigbeeTLc index OTA', 'https://pvvx.github.io/ATC_MiThermometer/ZigbeeTlcIdxOTA.html'],
      ['Debug flash reader', 'https://pvvx.github.io/ATC_MiThermometer/DebugFlashRead.html'],
      ['PHY62x2 (THB) flasher', 'https://pvvx.github.io/THB2/web/PHY62x2BTHome.html'],
    ],
  ],
  [
    'Reference',
    [
      ['Power consumption (custom fw)', 'https://pvvx.github.io/ATC_MiThermometer/CustPower.html'],
      ['Power consumption (original fw)', 'https://pvvx.github.io/ATC_MiThermometer/OriginalPower.html'],
      ['Firmware project (GitHub)', 'https://github.com/pvvx/ATC_MiThermometer'],
      ['ZigbeeTLc project (GitHub)', 'https://github.com/pvvx/ZigbeeTLc'],
    ],
  ],
];

/** Network timeout for downloads (firmware index, binaries, signature files). */
export const FETCH_TIMEOUT_MS = 15000;

/** Quick-pick name prefixes shown under the filter input. */
export const NAME_PREFIXES = ['ATC', 'LYWSD', 'MHO', 'MJWSD', 'CG', 'Qingping', 'BTH', 'TH'];
