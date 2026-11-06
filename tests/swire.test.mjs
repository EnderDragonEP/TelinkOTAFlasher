// SWire-over-UART encoding vs verbatim copies of pvvx's original functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swsWrAddr, SwireFlasher, hasTelinkMagic } from '../assets/js/swire.js';

// --- verbatim from USBCOMFlashTx.html (TLSR825x)
function sws_wr_addr_825x(addr, data) {
  let d = new Uint8Array(10);
  let h = new Uint8Array([0x5a, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, 0x00]);
  let pkt = new Uint8Array((data.byteLength + 6) * 10);
  d[0] = 0x80;
  d[9] = 0xfe;
  h.forEach((el, n) => {
    let m = 0x80;
    let idx = 1;
    do {
      if ((el & m) != 0) d[idx] = 0x80;
      else d[idx] = 0xfe;
      idx += 1;
      m >>= 1;
    } while (m != 0);
    pkt.set(d, n * 10);
    d[0] = 0xfe;
  });
  data.forEach((el, n) => {
    let m = 0x80;
    let idx = 1;
    do {
      if ((el & m) != 0) d[idx] = 0x80;
      else d[idx] = 0xfe;
      idx += 1;
      m >>= 1;
    } while (m != 0);
    pkt.set(d, (n + 5) * 10);
  });
  d.fill(0x80, 0, 9);
  pkt.set(d, (data.byteLength + 5) * 10);
  return pkt;
}
// --- verbatim from USBCOMFlashTx8269.html (only the header differs)
function sws_wr_addr_8269(addr, data) {
  let d = new Uint8Array(10);
  let h = new Uint8Array([0x5a, (addr >> 8) & 0xff, addr & 0xff, 0x00]);
  let pkt = new Uint8Array((data.byteLength + 6) * 10);
  d[0] = 0x80;
  d[9] = 0xfe;
  h.forEach((el, n) => {
    let m = 0x80;
    let idx = 1;
    do {
      if ((el & m) != 0) d[idx] = 0x80;
      else d[idx] = 0xfe;
      idx += 1;
      m >>= 1;
    } while (m != 0);
    pkt.set(d, n * 10);
    d[0] = 0xfe;
  });
  data.forEach((el, n) => {
    let m = 0x80;
    let idx = 1;
    do {
      if ((el & m) != 0) d[idx] = 0x80;
      else d[idx] = 0xfe;
      idx += 1;
      m >>= 1;
    } while (m != 0);
    pkt.set(d, (n + 5) * 10);
  });
  d.fill(0x80, 0, 9);
  pkt.set(d, (data.byteLength + 5) * 10);
  return pkt;
}

test('swsWrAddr matches the original encoder for both chips', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  const cases = [
    [0x0d, [0x00]],
    [0x0c, [0x06, 0x01]],
    [0x0602, [0x05]],
    [0x00b2, [55]],
    [0x06f, [0x20]],
    [0x00b3, [0x80]],
  ];
  for (let i = 0; i < 40; i++) cases.push([rnd() * 65536 + rnd() * 256 + rnd(), Array.from({ length: 1 + (i % 7) * 40 }, rnd)]);
  for (const [addr, bytes] of cases) {
    const data = new Uint8Array(bytes);
    assert.deepEqual(swsWrAddr(addr, data, 'tlsr825x'), sws_wr_addr_825x(addr, data), `825x addr ${addr}`);
    assert.deepEqual(swsWrAddr(addr, data, 'tlsr8269'), sws_wr_addr_8269(addr, data), `8269 addr ${addr}`);
  }
});

test('one SWire byte = 10 UART bytes, 0x80 = 1 / 0xFE = 0', () => {
  const p = swsWrAddr(0x0d, new Uint8Array([0xa5]));
  assert.equal(p.length, 70);
  assert.deepEqual([...p.subarray(0, 10)], [0x80, 0xfe, 0x80, 0xfe, 0x80, 0x80, 0xfe, 0x80, 0xfe, 0xfe]); // 0x5a, start bit 1
  assert.deepEqual([...p.subarray(50, 60)], [0xfe, 0x80, 0xfe, 0x80, 0xfe, 0xfe, 0x80, 0xfe, 0x80, 0xfe]); // 0xa5
  assert.deepEqual([...p.subarray(60, 70)], [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xfe]); // end
});

test('firmware write sequence: erase per 4 KiB sector, 256-byte pages, soft reset', async () => {
  const writes = [];
  const signals = [];
  const delays = [];
  const io = { write: async (b) => writes.push(b), setSignals: async (s) => signals.push(s) };
  const f = new SwireFlasher(io, 'tlsr825x', { delay: async (ms) => delays.push(ms), now: () => 0 });
  const fw = new Uint8Array(4096 + 300).map((_, i) => i & 0xff);
  const progress = [];
  await f.writeFirmware(fw, { activationMs: 0, onProgress: (a) => progress.push(a) });
  assert.deepEqual(signals, [{ dataTerminalReady: true, requestToSend: true }, { dataTerminalReady: false, requestToSend: false }]);
  assert.equal(delays.filter((d) => d === 300).length, 2, 'two sector erases');
  assert.equal(delays.filter((d) => d === 10).length, 18, '16 + 2 page writes');
  assert.deepEqual(progress.slice(-2), [4352, 4396]);
  // last packet: soft reset 06f = 20
  assert.deepEqual(writes.at(-1), swsWrAddr(0x06f, new Uint8Array([0x20])));
  // a page write carries 02 + address + data through the FIFO register 0x0c
  const page = writes.find((w) => w.length === (4 + 256 + 6) * 10);
  assert.ok(page, 'page write packet present');
});

test('KNLT magic check', () => {
  const ok = new Uint8Array(32);
  ok.set([0x4b, 0x4e, 0x4c, 0x54], 8);
  assert.equal(hasTelinkMagic(ok), true);
  assert.equal(hasTelinkMagic(new Uint8Array(32)), false);
});
