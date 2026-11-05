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

/** Network timeout for downloads (firmware index, binaries, signature files). */
export const FETCH_TIMEOUT_MS = 15000;

/** Quick-pick name prefixes shown under the filter input. */
export const NAME_PREFIXES = ['ATC', 'LYWSD', 'MHO', 'MJWSD', 'CG', 'Qingping', 'BTH', 'TH'];
