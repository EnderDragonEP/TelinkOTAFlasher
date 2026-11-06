// Connection helper for the single-purpose BLE views (live data, history, OTA) on top of the
// shared device hub: device chooser with the shared name filter, GATT connect (reusing an open
// connection), user/unexpected disconnects, optional automatic reconnect, and a session id so
// stale async work is ignored. While its view is not shown (`active` false) a session keeps its
// state but never touches the page.
import { hub } from './device-hub.js';
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
    this.server = null;
    this.phase = 'idle';
    this.id = 0;
    this.active = false;
    this.attached = null; // the device this session set up
    this.userDisconnect = false;
    hub.on('disconnected', (ev) => this.handleDisconnect(ev));
  }

  get device() {
    return hub.device;
  }

  get connected() {
    return !!(this.attached && this.attached === hub.device && hub.connected && this.phase === 'connected');
  }

  alive(id) {
    return id === this.id;
  }

  /** The view was shown (true) or left (false). */
  setActive(on) {
    this.active = on;
    if (on) this.setPhase(this.phase);
  }

  setPhase(phase) {
    this.phase = phase;
    if (!this.active) return;
    setBadge(phase);
    if (this.opts.onState) this.opts.onState(phase);
  }

  status(text, opts) {
    if (this.active) setStatus(text, opts);
  }

  async choose() {
    const services = typeof this.opts.optionalServices === 'function' ? this.opts.optionalServices() : this.opts.optionalServices;
    return hub.choose(nameFilterOptions(services, { hideUnnamed: !!this.opts.hideUnnamed?.() }));
  }

  /** Pick a device (unless `reuse` and one is known) and connect to it. */
  async connect({ reuse = false } = {}) {
    let device = reuse ? hub.device : null;
    if (!device) device = await this.choose();
    if (!device) return false;
    return this.open();
  }

  /** Take over the open connection without running onConnected (the view starts work itself). */
  adopt() {
    if (!hub.connected) return false;
    this.id++;
    this.userDisconnect = false;
    this.server = hub.device.gatt;
    this.attached = hub.device;
    this.setPhase('connected');
    return true;
  }

  async open(attempt = 0, { quiet = false } = {}) {
    const id = ++this.id;
    const device = hub.device;
    const reuse = hub.connected;
    this.userDisconnect = false;
    this.setPhase('connecting');
    if (reuse) log.debug(`Using the open connection to ${device.name || device.id}`);
    else {
      this.status(`Connecting to ${device.name || 'device'}…`, { kind: 'busy' });
      log.info('Connecting to: ' + (device.name || device.id));
    }
    try {
      this.server = await hub.connect();
      this.attached = device;
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
      if (reuse && hub.connected) {
        // The shared connection is fine, this view just cannot use the device: leave it connected.
        this.attached = null;
        this.setPhase('idle');
        this.status(err && err.name === 'SecurityError' ? 'This device was picked without access to the needed service. Press Connect and pick it again.' : 'This device cannot be used here: ' + (err.message || err), { kind: 'error' });
        return false;
      }
      if (attempt < 2 && hub.device === device && !(err && err.name === 'SecurityError')) {
        log.warn(`Retrying (${attempt + 1}/2)…`);
        try {
          if (device.gatt.connected) device.gatt.disconnect();
        } catch {
          /* ignore */
        }
        await sleep(600);
        if (this.alive(id) && !this.userDisconnect) return this.open(attempt + 1);
        return false;
      }
      this.status('Could not connect: ' + (err.message || err), { kind: 'error' });
      this.disconnect();
      return false;
    }
  }

  disconnect() {
    this.userDisconnect = true;
    this.id++;
    hub.disconnect();
    if (this.phase !== 'idle') {
      this.setPhase('idle');
      log.info('Disconnected.');
      if (this.opts.onDisconnected) this.opts.onDisconnected(false);
    }
  }

  async handleDisconnect(ev) {
    if (!this.attached || ev.target !== this.attached || this.userDisconnect || this.phase === 'idle') return;
    const wasConnected = this.phase === 'connected';
    if (this.active) log.warn(`"${this.attached.name}" disconnected.`);
    if (wasConnected && this.active && this.opts.autoReconnect && this.opts.autoReconnect() && hub.device === this.attached) {
      for (let i = 1; i <= 3 && !this.userDisconnect && this.active; i++) {
        this.status(`Connection lost, reconnecting (${i}/3)…`, { kind: 'busy' });
        await sleep(1000 * i);
        if (this.userDisconnect || !this.active) break;
        if (await this.open(2, { quiet: true })) return;
      }
    }
    if (this.userDisconnect) return;
    this.id++;
    this.setPhase('idle');
    this.status('Disconnected', { kind: 'info' });
    if (this.opts.onDisconnected) this.opts.onDisconnected(true);
  }
}
