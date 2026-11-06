// Web Bluetooth helpers: UUIDs, serialized GATT operations, write helpers.
import { hexToBytes, toU8 } from './util.js';

export const UUID = {
  OTA_SERVICE: '00010203-0405-0607-0809-0a0b0c0d1912',
  OTA_CHAR: '00010203-0405-0607-0809-0a0b0c0d2b12',
  CUSTOM_SERVICE: '00001f10-0000-1000-8000-00805f9b34fb',
  CUSTOM_CHAR: '00001f1f-0000-1000-8000-00805f9b34fb',
  QINGPING_SERVICE: '22210000-554a-4546-5542-46534450464d',
  MI_MAIN_SERVICE: 'ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6',
  MI_SPEED_CHAR: 'ebe0ccd8-7a0a-4b0c-8a1a-6ff2997da3a6',
  MI_TEMP_CHAR: 'ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6',
  MI_CLOCK_CHAR: 'ebe0ccb7-7a0a-4b0c-8a1a-6ff2997da3a6',
  ENV_SENSING: '0000181a-0000-1000-8000-00805f9b34fb',
  TEST_SERVICE: '0000ffe0-0000-1000-8000-00805f9b34fb',
  TEST_CHAR: '0000ffe1-0000-1000-8000-00805f9b34fb',
  BTHOME: '0000fcd2-0000-1000-8000-00805f9b34fb',
  ZB_CHAR: '0000fff4-0000-1000-8000-00805f9b34fb',
  DEVICE_INFO: '0000180a-0000-1000-8000-00805f9b34fb',
};

/** Same list the original page requested, so every service it touches is accessible. */
export const OPTIONAL_SERVICES = [
  UUID.CUSTOM_SERVICE, '00010203-0405-0607-0809-0a0b0c0d1912', UUID.MI_MAIN_SERVICE, UUID.QINGPING_SERVICE,
  0x180a, 0x181c, 0x181e, 0xfe95, 0x1f10, 0x1f11, 0x181a, 0xfff9, 0xfdcd, 0xffe0, 0xfcd2,
];

/** Full 128-bit UUID, or a 16/32-bit alias written as hex (e.g. 1912, 0x1F10); null if invalid. */
export function parseUuid(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) return t;
  const m = t.match(/^(?:0x)?([0-9a-f]{4}|[0-9a-f]{8})$/);
  return m ? parseInt(m[1], 16) : null;
}

/** 16/32-bit alias or full UUID string -> canonical lower-case 128-bit string. */
export function canonicalUUID(u) {
  if (typeof u === 'number') return `${u.toString(16).padStart(8, '0')}-0000-1000-8000-00805f9b34fb`;
  return String(u).toLowerCase();
}

/**
 * Android Chrome allows only one GATT operation at a time. Serialize every
 * characteristic/descriptor read, write and notification toggle through one queue.
 */
export function installGattQueue() {
  if (typeof BluetoothRemoteGATTCharacteristic === 'undefined' || window.__gattQueue) return;
  let q = Promise.resolve();
  const wrap = (proto, name) => {
    const orig = proto[name];
    if (!orig) return;
    proto[name] = function (...args) {
      const run = () => orig.apply(this, args);
      const p = q.then(run, run);
      q = p.catch(() => {});
      return p;
    };
  };
  ['readValue', 'writeValue', 'writeValueWithResponse', 'writeValueWithoutResponse', 'startNotifications', 'stopNotifications'].forEach((n) =>
    wrap(BluetoothRemoteGATTCharacteristic.prototype, n),
  );
  if (typeof BluetoothRemoteGATTDescriptor !== 'undefined') {
    ['readValue', 'writeValue'].forEach((n) => wrap(BluetoothRemoteGATTDescriptor.prototype, n));
  }
  window.__gattQueue = true;
}

/** Write bytes (Uint8Array / array) or a hex string to a characteristic. */
export function writeChar(characteristic, data) {
  if (!characteristic) return Promise.reject(new Error('Characteristic is not available (not connected?)'));
  const bytes = typeof data === 'string' ? hexToBytes(data) : toU8(data);
  return characteristic.writeValue(bytes);
}

// Notification handlers are kept per owner ('main' = Flasher/Settings, 'live', 'history', …):
// views share one connection, so the Live data recorder and the open view can both listen
// to the same characteristic. A view releases its handlers when it is left.
const owned = new Map(); // owner -> Set<characteristic>

/** Set the notification handler of `owner` on a characteristic (replacing its previous one). */
export function onNotify(characteristic, handler, owner = 'main') {
  if (!characteristic.__notify) {
    const handlers = new Map();
    characteristic.__notify = handlers;
    characteristic.addEventListener('characteristicvaluechanged', (ev) => {
      for (const fn of [...handlers.values()]) {
        try {
          fn(ev.target.value);
        } catch (err) {
          setTimeout(() => {
            throw err;
          });
        }
      }
    });
  }
  characteristic.__notify.set(owner, handler);
  if (!owned.has(owner)) owned.set(owner, new Set());
  owned.get(owner).add(characteristic);
}

/** Remove every notification handler of `owner` (notifications stay enabled on the device). */
export function releaseNotify(owner) {
  for (const ch of owned.get(owner) || []) ch.__notify.delete(owner);
  owned.delete(owner);
}

export function webBluetoothSupport() {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!navigator.bluetooth) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

export const isUserCancel = (err) => !!err && err.name === 'NotFoundError' && /cancel/i.test(err.message || '');
