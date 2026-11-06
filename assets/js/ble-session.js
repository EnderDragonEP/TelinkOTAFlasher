// Minimal connection manager for the single-purpose BLE pages (live data, history, OTA):
// device chooser with the shared name filter, GATT connect, user/unexpected disconnects,
// optional automatic reconnect, and a session id so stale async work is ignored.
import { isUserCancel } from './ble.js';
import { log } from './log.js';
import { setBadge, setStatus } from './ui.js';
import { nameFilterOptions } from './site.js';
import { sleep } from './util.js';

export class BleSession {
  /**
   * opts: { optionalServices, hideUnnamed?, autoReconnect?, onConnected(server, session) -> Promise,
   *         onDisconnected?(unexpected), onState?(phase) }
   */
  constructor(opts) {
    this.opts = opts;
    this.device = null;
    this.server = null;
    this.phase = 'idle';
    this.id = 0;
    this.userDisconnect = false;
    this.onGattDisconnected = (ev) => this.handleDisconnect(ev);
  }

  get connected() {
    return !!(this.device && this.device.gatt.connected && this.phase === 'connected');
  }

  alive(id) {
    return id === this.id;
  }

  setPhase(phase) {
    this.phase = phase;
    setBadge(phase);
    if (this.opts.onState) this.opts.onState(phase);
  }

  async choose() {
    const services = typeof this.opts.optionalServices === 'function' ? this.opts.optionalServices() : this.opts.optionalServices;
    const options = nameFilterOptions(services, { hideUnnamed: !!this.opts.hideUnnamed?.() });
    log.debug('requestDevice', options);
    try {
      return await navigator.bluetooth.requestDevice(options);
    } catch (err) {
      if (isUserCancel(err)) log.info('Device selection cancelled.');
      else log.error(err);
      return null;
    }
  }

  /** Pick a device (unless `reuse` and one is known) and connect to it. */
  async connect({ reuse = false } = {}) {
    let device = reuse ? this.device : null;
    if (!device) device = await this.choose();
    if (!device) return false;
    if (this.device && this.device !== device) {
      this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
      if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
    if (this.device !== device) device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
    this.device = device;
    return this.open();
  }

  async open(attempt = 0, { quiet = false } = {}) {
    const id = ++this.id;
    this.userDisconnect = false;
    this.setPhase('connecting');
    setStatus(`Connecting to ${this.device.name || 'device'}…`, { kind: 'busy' });
    log.info('Connecting to: ' + (this.device.name || this.device.id));
    try {
      this.server = await this.device.gatt.connect();
      if (!this.alive(id)) return false;
      log.debug('GATT server connected');
      await this.opts.onConnected(this.server, { id, alive: () => this.alive(id) });
      if (!this.alive(id)) return false;
      this.setPhase('connected');
      return true;
    } catch (err) {
      if (!this.alive(id) || this.userDisconnect) return false;
      log.error(err && err.message ? `${err.name ? err.name + ': ' : ''}${err.message}` : String(err));
      if (quiet) return false;
      if (attempt < 2 && this.device) {
        log.warn(`Retrying (${attempt + 1}/2)…`);
        try {
          if (this.device.gatt.connected) this.device.gatt.disconnect();
        } catch {
          /* ignore */
        }
        await sleep(600);
        if (this.alive(id) && !this.userDisconnect) return this.open(attempt + 1);
        return false;
      }
      setStatus('Could not connect: ' + (err.message || err), { kind: 'error' });
      this.disconnect();
      return false;
    }
  }

  disconnect() {
    this.userDisconnect = true;
    this.id++;
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    if (this.phase !== 'idle') {
      this.setPhase('idle');
      log.info('Disconnected.');
      if (this.opts.onDisconnected) this.opts.onDisconnected(false);
    }
  }

  async handleDisconnect(ev) {
    if (ev.target !== this.device || this.userDisconnect || this.phase === 'idle') return;
    const wasConnected = this.phase === 'connected';
    log.warn(`"${this.device.name}" disconnected.`);
    if (wasConnected && this.opts.autoReconnect && this.opts.autoReconnect()) {
      for (let i = 1; i <= 3 && !this.userDisconnect; i++) {
        setStatus(`Connection lost, reconnecting (${i}/3)…`, { kind: 'busy' });
        await sleep(1000 * i);
        if (this.userDisconnect) return;
        if (await this.open(2, { quiet: true })) return;
      }
    }
    if (this.userDisconnect) return;
    this.id++;
    this.setPhase('idle');
    setStatus('Disconnected', { kind: 'info' });
    if (this.opts.onDisconnected) this.opts.onDisconnected(true);
  }
}
