// The Bluetooth device shared by every view of the single-page app. Views keep their own GATT
// setup (service discovery, characteristics, notifications); the hub owns what has to outlive
// a view: the picked device, the chooser (which asks for every service any view uses, so a
// device picked on one tab works on all of them), disconnect events and the header indicator.
// device.gatt.connect() on a device that is already connected resolves at once with the same
// server, so a view that opens on a connected device runs its setup without reconnecting.
import { OPTIONAL_SERVICES, canonicalUUID, parseUuid, isUserCancel } from './ble.js';
import { log } from './log.js';
import { $ } from './ui.js';
import { store } from './site.js';

const listeners = new Map();

/** Services requested at pick time: the flasher's list, Environmental Sensing and a custom OTA service. */
function servicesFor(extra = []) {
  const list = [...OPTIONAL_SERVICES, 0x181a, ...extra];
  const customOta = parseUuid(store.get('otaService') || '');
  if (customOta !== null) list.push(customOta);
  const seen = new Set();
  return list.filter((u) => {
    const k = canonicalUUID(u);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function onGattDisconnected(ev) {
  if (ev.target === hub.device) hub.connectionId++;
  updateIndicator();
  hub.emit('disconnected', ev);
}

export const hub = {
  /** The picked BluetoothDevice (kept after a disconnect so every tab can reconnect without the chooser). */
  device: null,
  /** Incremented whenever the current device disconnects: identifies one connection. */
  connectionId: 0,

  get connected() {
    return !!(this.device && this.device.gatt.connected);
  },

  /** Subscribe to 'disconnected' (GATT event) or 'setup-done' (a view finished its setup); returns an unsubscribe function. */
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },

  emit(event, ...args) {
    for (const fn of [...(listeners.get(event) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        log.debug(err);
      }
    }
  },

  /** Show the device chooser; returns the picked device or null (cancelled / failed). */
  async choose(options) {
    const opts = { ...options, optionalServices: servicesFor(options.optionalServices || []) };
    log.debug('requestDevice', opts);
    let device;
    try {
      device = await navigator.bluetooth.requestDevice(opts);
    } catch (err) {
      if (isUserCancel(err)) log.info('Device selection cancelled.');
      else log.error(err);
      return null;
    }
    this.use(device);
    return device;
  },

  /** Make `device` the shared device; a previously used device is disconnected. */
  use(device) {
    if (device === this.device) return;
    const old = this.device;
    this.device = device;
    if (!device.__hubListener) {
      // Kept on old devices too, so views still attached to them learn about their disconnect.
      device.addEventListener('gattserverdisconnected', onGattDisconnected);
      device.__hubListener = true;
    }
    if (old) {
      try {
        if (old.gatt.connected) old.gatt.disconnect();
      } catch {
        /* ignore */
      }
    }
    updateIndicator();
  },

  /** Connect (or reuse the open connection) and return the GATT server. */
  async connect() {
    const server = await this.device.gatt.connect();
    updateIndicator();
    return server;
  },

  disconnect() {
    try {
      if (this.connected) this.device.gatt.disconnect();
    } catch {
      /* ignore */
    }
  },
};

/** Header chip showing the shared device and whether it is connected. */
export function updateIndicator() {
  const el = $('hdr-device');
  if (!el) return;
  const d = hub.device;
  el.hidden = !d;
  if (!d) return;
  const on = d.gatt.connected;
  const name = d.name || 'Unnamed device';
  el.classList.toggle('on', on);
  el.querySelector('.hdr-device-name').textContent = name;
  el.title = on ? `Connected to ${name}. Every tab uses this connection.` : `${name} is disconnected. Reconnect works on every tab without picking it again.`;
  el.setAttribute('aria-label', el.title);
}
