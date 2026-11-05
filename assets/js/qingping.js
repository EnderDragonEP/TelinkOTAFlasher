// Qingping (ClearGrass) devices with stock firmware: CGG1, CGDK2, CGPR1 and the alarm clock.
import { S } from './state.js';
import { UUID, onNotify } from './ble.js';
import { log } from './log.js';
import { setLive, getVal, setVal, toast } from './ui.js';
import { bytesToHex } from './util.js';
import { renderMiPanel, miAuthorization, qingpingExtraTemplate } from './mi.js';

function parseNotify100(value) {
  const cid = value.getUint16(0, true);
  if (cid === 0x1706) {
    const temp = value.getInt16(2, true) / 10;
    const humi = value.getInt16(4, true) / 10;
    setLive([['Temperature', `${temp} °C`], ['Humidity', `${humi} %`]], 'Qingping');
    log.debug(`Temp: ${temp}C, Humi: ${humi}%`);
  } else if (cid === 0x0202) {
    log.info('Battery: ' + value.getUint8(2) + '%');
  } else if (cid === 0x0305) {
    const mt = value.getUint8(2);
    const lx = value.getUint16(3, true) + (value.getUint8(5) << 16);
    setLive([['Motion timer', String(mt)], ['Illumination', `${lx} lx`]], 'Qingping');
    log.debug(`MotionT: ${mt}, Illumination: ${lx} lx`);
  } else {
    log.debug('CustNotify100: ' + bytesToHex(value.buffer));
  }
}

function parseNotify018(value) {
  log.debug('CustNotify018: ' + bytesToHex(value.buffer));
  const cid = value.getUint16(0, true);
  if (cid === 0x0202) log.info('Battery: ' + value.getUint8(2) + '%');
  else if (cid === 0x0405) log.info('Level: ' + value.getUint32(2, true));
  else if (cid === 0x0305) log.info(`Event: ${value.getUint8(2)}, Illumination: ${value.getUint16(3, true) + (value.getUint8(5) << 16)} lx`);
  else if (cid === 0x1305) {
    const tm = value.getUint32(2, true);
    log.info(`Timer: ${tm} ms (${tm / 1000} sec)`);
    setVal('mtimer', tm.toString(10));
  } else if (cid === 0xff04) {
    const cmd = value.getUint8(2);
    const err = value.getUint8(3);
    if (err === 0) {
      if (cmd === 0x10) log.ok('Set timer - ok');
      else if (cmd === 0x0e) log.ok('Clear - ok (Mode Qingping)');
      else log.ok('Command ' + cmd.toString(16) + ' - ok');
    } else log.error('Command ' + cmd.toString(16) + ' - Error ' + err.toString(16));
  } else log.info('CustNotify018: ' + bytesToHex(value.buffer));
}

async function subscribe100(service) {
  S.cus100 = await service.getCharacteristic(0x0100);
  log.debug('Found 0x0100 characteristic');
  await S.cus100.startNotifications();
  onNotify(S.cus100, parseNotify100);
}

const NOTE = 'After activating here, the device has to be activated again in the Mi Home app if you want to keep using it there.';

export async function cgpr1Action() {
  log.info('Detected Qingping CGPR1 device');
  renderMiPanel({
    intro: NOTE,
    hint: 'Press and hold the button on the device for 2 seconds until the LED starts flashing, then press “Connect” and “Do activation”.',
    skip: true,
    extra: qingpingExtraTemplate(),
  });
  const service = await S.server.getPrimaryService(UUID.QINGPING_SERVICE);
  log.debug('Found Custom service');
  S.cus017 = await service.getCharacteristic(0x0017);
  log.debug('Found 0x0017 characteristic');
  S.cus018 = await service.getCharacteristic(0x0018);
  log.debug('Found 0x0018 characteristic');
  onNotify(S.cus018, parseNotify018);
  await S.cus018.startNotifications();
  await subscribe100(service);
  S.cus017
    .writeValue(new Uint8Array([0x01, 0x02]))
    .then(() => S.cus017.writeValue(new Uint8Array([0x01, 0x13])))
    .catch((err) => log.debug(err));
  await miAuthorization();
}

export async function cgdk2Action() {
  S.cus017 = null;
  log.info('Detected Qingping CGDK2 device');
  renderMiPanel({ intro: NOTE });
  const service = await S.server.getPrimaryService(UUID.QINGPING_SERVICE);
  log.debug('Found Custom service');
  await subscribe100(service);
  await miAuthorization();
}

export async function cgg1Action(model) {
  S.cus017 = null;
  log.info('Detected Qingping CGG1 device ' + model);
  renderMiPanel({
    intro: NOTE,
    hint: 'Press and hold the button on the back of the CGG1-M for 2 seconds until the Bluetooth icon starts blinking on the e-ink display, then click “Connect” and “Do activation”.',
  });
  const service = await S.server.getPrimaryService(UUID.QINGPING_SERVICE);
  log.debug('Found Custom service');
  await subscribe100(service);
  await miAuthorization();
}

export async function qpClear() {
  if (!S.cus017) return;
  await S.cus017.writeValue(new Uint8Array([0x01, 0x0e]));
  S.userDisconnect = true;
  if (S.device) S.device.gatt.disconnect();
}

export async function qpGetTimer() {
  if (S.cus017) await S.cus017.writeValue(new Uint8Array([0x01, 0x13]));
}

export async function qpSetTimer() {
  const t = parseInt(getVal('mtimer'), 10);
  if (!(t > 100)) {
    toast('Motion timer must be more than 100 ms', 'warn');
    return;
  }
  await S.cus017.writeValue(new Uint8Array([0x05, 0x10, t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >> 24) & 0xff]));
  await S.cus017.writeValue(new Uint8Array([0x01, 0x13]));
}

