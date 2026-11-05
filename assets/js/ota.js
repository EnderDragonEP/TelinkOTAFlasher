// Telink OTA transfer engine. Protocol (unchanged from the original page):
//   [Mi devices: "1e0000" -> speed characteristic] wait 500 ms
//   00ff, 01ff, wait 300 ms, then 16-byte blocks: idx(LE16) + data + CRC16(LE16)
//   after every 8th block read the OTA characteristic: non-zero byte = device error
//   finally 02ff + last idx + ~last idx
import { sleep } from './util.js';
import { otaPacket, otaEndPacket } from './firmware.js';
import { OTA_ERRORS } from './tables.js';

export class OtaError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function describeOtaResult(code, seconds) {
  let err = 'Unknown:' + code;
  if (code === 0) err = 'done';
  else if (code < OTA_ERRORS.length) err = 'error(' + OTA_ERRORS[code] + ')';
  return `Update ${err} after ${seconds} seconds`;
}

/**
 * Run an OTA transfer.
 * opts: { otaChar, data (Uint8Array, multiple of 16), speedChar?, onProgress?(info), signal? }
 * Resolves with { seconds } or rejects with OtaError / abort / GATT errors.
 */
export async function runOta({ otaChar, data, speedChar = null, onProgress = () => {}, signal = null }) {
  const blockCount = data.length / 16;
  const write = (bytes) => otaChar.writeValue(bytes);
  const checkAbort = () => {
    if (signal && signal.aborted) throw new OtaError('Aborted by user', -1);
  };

  if (speedChar) {
    // Ask stock Mi firmware for a faster connection interval (iOS would be "1e0001").
    speedChar.writeValue(new Uint8Array([0x1e, 0x00, 0x00])).catch(() => {});
  }
  await sleep(500);
  checkAbort();
  await write(new Uint8Array([0x00, 0xff]));
  await write(new Uint8Array([0x01, 0xff]));
  await sleep(300);

  const start = performance.now();
  let lastReport = 0;
  for (let i = 0; i < blockCount; i++) {
    checkAbort();
    await write(otaPacket(data, i));
    if ((i + 1) % 8 === 0) {
      const result = await otaChar.readValue();
      if (result.byteLength > 0) {
        const e = result.getUint8(0);
        if (e !== 0) {
          const seconds = (performance.now() - start) / 1000;
          throw new OtaError(describeOtaResult(e, seconds), e);
        }
      }
    }
    const now = performance.now();
    if (now - lastReport > 120 || i === blockCount - 1) {
      lastReport = now;
      onProgress({ block: i + 1, blockCount, bytes: (i + 1) * 16, elapsed: (now - start) / 1000 });
    }
  }
  await write(otaEndPacket(blockCount));
  return { seconds: (performance.now() - start) / 1000 };
}
