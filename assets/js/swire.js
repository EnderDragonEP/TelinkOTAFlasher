// Telink SWire (single-wire debug interface) driven through a USB-UART adapter's TX pin
// (TX -> SWS). Port of pvvx's USBCOMFlashTx.html / USBCOMFlashTx8269.html.
//
// Every SWire bit is sent as one UART byte: 0x80 = "1", 0xFE = "0" (the UART start bit plus
// the data bits shape the SWire pulse). A command is 10 UART bytes per SWire byte.

import { sleep } from './util.js';

export const CHIPS = {
  tlsr825x: { label: 'TLSR825x (TLSR8251/8253/8258)', addrBytes: 3 },
  tlsr8269: { label: 'TLSR8266/8269', addrBytes: 2 },
};

export const FLASH_PAGE = 256; // SPI flash FIFO / page size
export const FLASH_SECTOR = 4096;

/** Encode a SWire "write <data> at <addr>" command as UART bytes (original sws_wr_addr()). */
export function swsWrAddr(addr, data, chip = 'tlsr825x') {
  const d = new Uint8Array(10); // one SWire byte = 10 UART bytes
  const h =
    CHIPS[chip].addrBytes === 2
      ? new Uint8Array([0x5a, (addr >> 8) & 0xff, addr & 0xff, 0x00])
      : new Uint8Array([0x5a, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, 0x00]);
  const pkt = new Uint8Array((data.length + 6) * 10);
  d[0] = 0x80; // start bit of the command byte = 1
  d[9] = 0xfe; // stop bit = 0
  const bits = (el) => {
    let m = 0x80;
    let idx = 1;
    do {
      d[idx] = el & m ? 0x80 : 0xfe;
      idx += 1;
      m >>= 1;
    } while (m !== 0);
  };
  h.forEach((el, n) => {
    bits(el);
    pkt.set(d, n * 10);
    d[0] = 0xfe; // start bit of the following bytes = 0
  });
  data.forEach((el, n) => {
    bits(el);
    pkt.set(d, (n + 5) * 10); // data always starts at slot 5 (the 8269 header leaves slot 4 empty, as the original)
  });
  d.fill(0x80, 0, 9); // end of command: 0xFF
  pkt.set(d, (data.length + 5) * 10);
  return pkt;
}

export { hasTelinkMagic } from './firmware.js';

/**
 * Flash programming sequences over SWire.
 * io: { write(bytes): Promise, setSignals({dataTerminalReady, requestToSend}): Promise }
 */
export class SwireFlasher {
  constructor(io, chip = 'tlsr825x', { delay = sleep, now = () => Date.now() } = {}) {
    this.io = io;
    this.chip = chip;
    this.delay = delay;
    this.now = now;
  }

  w(addr, bytes) {
    return this.io.write(swsWrAddr(addr, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), this.chip));
  }

  async flashByteCmd(cmd) {
    await this.w(0x0d, [0x00]); // cns low
    return this.w(0x0c, [cmd & 0xff, 0x01]); // flash cmd + cns high
  }
  writeEnable() {
    return this.flashByteCmd(0x06);
  }
  wakeUp() {
    return this.flashByteCmd(0xab);
  }
  async writeFifo(addr, data) {
    await this.w(0x00b3, [0x80]); // SWS into FIFO mode
    await this.w(addr, data); // all data to one register
    return this.w(0x00b3, [0x00]); // back to RAM mode
  }
  async writeStatus(value) {
    await this.writeEnable();
    await this.w(0x0d, [0x00]);
    await this.w(0x0c, [0x01]);
    await this.w(0x0c, [value & 0xff, 0x01]);
    return this.delay(3);
  }
  async sectorErase(addr) {
    await this.writeEnable();
    await this.w(0x0d, [0x00]);
    await this.w(0x0c, [0x20]);
    await this.w(0x0c, [(addr >> 16) & 0xff]);
    await this.w(0x0c, [(addr >> 8) & 0xff]);
    await this.w(0x0c, [addr & 0xff, 0x01]);
    return this.delay(300);
  }
  async writePage(addr, data) {
    await this.writeEnable();
    await this.w(0x0d, [0x00]);
    const blk = new Uint8Array(4 + data.length);
    blk[0] = 0x02;
    blk[1] = (addr >> 16) & 0xff;
    blk[2] = (addr >> 8) & 0xff;
    blk[3] = addr & 0xff;
    blk.set(data, 4);
    await this.writeFifo(0x0c, blk);
    await this.w(0x0d, [0x01]); // cns high
    return this.delay(10);
  }
  softReset() {
    return this.w(0x06f, [0x20]);
  }

  /** Reset (DTR/RTS pulse), soft reset, then hold the CPU stopped for `ms` and wake the flash. */
  async activate(ms, onStatus = () => {}) {
    const stop = swsWrAddr(0x0602, new Uint8Array([0x05]), this.chip); // CPU stop
    onStatus('Reset DTR/RTS (100 ms)');
    await this.io.setSignals({ dataTerminalReady: true, requestToSend: true });
    await this.delay(100);
    await this.io.setSignals({ dataTerminalReady: false, requestToSend: false });
    await this.softReset();
    onStatus(`Activate (${ms / 1000} s)…`);
    const t = this.now();
    while (this.now() - t < ms) await this.io.write(stop);
    await this.w(0x00b2, [55]); // SWS speed
    await this.io.write(stop);
    return this.wakeUp();
  }

  /** Write a firmware image from address 0, erasing each 4 KiB sector first. */
  async writeFirmware(data, { activationMs, onStatus = () => {}, onProgress = () => {}, signal = null }) {
    await this.activate(activationMs, onStatus);
    let len = data.length;
    if (len > 0) {
      await this.writeStatus(0);
      await this.writeStatus(0);
    }
    let addr = 0;
    let sblk = FLASH_PAGE;
    while (len > 0) {
      if (signal && signal.aborted) throw new Error('Aborted by user');
      if ((addr & 0x0fff) === 0) {
        onStatus(`Sector erase at 0x${addr.toString(16).padStart(6, '0')}`);
        await this.sectorErase(addr);
      }
      if (len < sblk) sblk = len;
      await this.writePage(addr, data.subarray(addr, addr + sblk));
      addr += sblk;
      len -= sblk;
      onProgress(addr, data.length);
    }
    onStatus('Soft reset');
    return this.softReset();
  }

  async eraseAll({ activationMs, onStatus = () => {} }) {
    await this.activate(activationMs, onStatus);
    onStatus('Erase all flash (3.5 s)…');
    await this.writeStatus(0);
    await this.writeStatus(0);
    await this.writeEnable();
    await this.flashByteCmd(0x60);
    return this.delay(3500);
  }

  async reset({ activationMs, onStatus = () => {} }) {
    await this.activate(activationMs, onStatus);
    onStatus('Soft reset');
    return this.softReset();
  }
}
