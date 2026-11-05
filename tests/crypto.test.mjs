// Published test vectors for the WebCrypto based replacements of SJCL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSha256, hmacSha256, aesCcmEncrypt } from '../assets/js/crypto.js';
import { hexToBytes, bytesToHex } from '../assets/js/util.js';

const h = hexToBytes;

test('HKDF-SHA256, RFC 5869 test case 1', async () => {
  const okm = await hkdfSha256(h('0b'.repeat(22)), h('000102030405060708090a0b0c'), h('f0f1f2f3f4f5f6f7f8f9'), 42);
  assert.equal(bytesToHex(okm), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
});

test('HKDF-SHA256, RFC 5869 test case 3 (no salt, no info)', async () => {
  const okm = await hkdfSha256(h('0b'.repeat(22)), null, '', 42);
  assert.equal(bytesToHex(okm), '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
});

test('HMAC-SHA256, RFC 4231 test case 2', async () => {
  const mac = await hmacSha256(new TextEncoder().encode('Jefe'), new TextEncoder().encode('what do ya want for nothing?'));
  assert.equal(bytesToHex(mac), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('AES-CCM, RFC 3610 packet vector #1 (13 byte nonce, 8 byte tag)', async () => {
  const out = await aesCcmEncrypt(
    h('c0c1c2c3c4c5c6c7c8c9cacbcccdcecf'),
    h('00000003020100a0a1a2a3a4a5'),
    h('08090a0b0c0d0e0f101112131415161718191a1b1c1d1e'),
    h('0001020304050607'),
    8,
  );
  assert.equal(bytesToHex(out), '588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0');
});

test('AES-CCM, NIST SP 800-38C example 1 (7 byte nonce, 4 byte tag)', async () => {
  const out = await aesCcmEncrypt(h('404142434445464748494a4b4c4d4e4f'), h('10111213141516'), h('20212223'), h('0001020304050607'), 4);
  assert.equal(bytesToHex(out), '7162015b4dac255d');
});

test('AES-CCM, NIST SP 800-38C example 2 (8 byte nonce, 6 byte tag)', async () => {
  const out = await aesCcmEncrypt(
    h('404142434445464748494a4b4c4d4e4f'),
    h('1011121314151617'),
    h('202122232425262728292a2b2c2d2e2f'),
    h('000102030405060708090a0b0c0d0e0f'),
    6,
  );
  assert.equal(bytesToHex(out), 'd2a1f0e051ea5f62081a7792073d593d1fc64fbfaccd');
});
