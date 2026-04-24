// Web3 Secret Storage v3 keystore — encrypt + decrypt a 32-byte
// private key under a passphrase using PBKDF2-SHA256 + AES-CTR-128
// (the same envelope geth, MetaMask, and Citrate's Rust wallet-core
// produce). Keeps cross-environment interop with the in-repo
// wallet-core's keystore format so a key created here can be loaded
// by the desktop app and vice versa.
//
// Cipher: aes-128-ctr
// KDF:    pbkdf2 with sha256
//
// Reference: https://ethereum.org/en/developers/docs/data-structures-and-encoding/web3-secret-storage/
//
// Browser-only — uses WebCrypto via crypto.subtle. Node.js test
// environment must polyfill (vitest does, via the jsdom/happy-dom
// environment, or we can fall back to node:crypto.webcrypto).

import { bytesToHex, hexToBytes, type Hex } from 'viem';

/// One Web3 Secret Storage v3 keystore JSON document.
export interface Keystore {
  /// SCS-3 envelope version. Always 3 in this codec.
  version: 3;
  /// Address (lowercase hex, no 0x).
  address: string;
  /// Per-keystore unique id (uuid).
  id: string;
  crypto: {
    cipher: 'aes-128-ctr';
    ciphertext: string; // hex
    cipherparams: { iv: string }; // hex
    kdf: 'pbkdf2';
    kdfparams: {
      c: number; // iteration count
      dklen: number; // 32
      prf: 'hmac-sha256';
      salt: string; // hex
    };
    /// keccak256(derivedKey[16:32] || ciphertext) — integrity check.
    mac: string; // hex
  };
}

/// Encrypt a 32-byte private key under `passphrase` and return a v3
/// keystore JSON object. Throws if the key isn't exactly 32 bytes.
export async function encryptKeystore(
  privateKey: Uint8Array,
  passphrase: string,
  address: string,
): Promise<Keystore> {
  if (privateKey.length !== 32) {
    throw new Error(`encryptKeystore: expected 32-byte key, got ${privateKey.length}`);
  }
  const subtle = await getSubtle();
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const iterations = 262144; // matches geth default; production-grade.

  const derivedKey = await pbkdf2(passphrase, salt, iterations, 32);
  const aesKey = await subtle.importKey(
    'raw',
    derivedKey.slice(0, 16),
    { name: 'AES-CTR', length: 128 },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-CTR', counter: iv as BufferSource, length: 128 },
      aesKey,
      privateKey as BufferSource,
    ),
  );

  const macInput = concatBytes(derivedKey.slice(16, 32), ciphertext);
  const mac = await keccak256(macInput);

  return {
    version: 3,
    address: address.toLowerCase().replace(/^0x/, ''),
    id: randomUuid(),
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: bytesToPlainHex(ciphertext),
      cipherparams: { iv: bytesToPlainHex(iv) },
      kdf: 'pbkdf2',
      kdfparams: {
        c: iterations,
        dklen: 32,
        prf: 'hmac-sha256',
        salt: bytesToPlainHex(salt),
      },
      mac: bytesToPlainHex(mac),
    },
  };
}

/// Decrypt a v3 keystore. Throws on bad passphrase (mac mismatch) or
/// unsupported cipher / kdf.
export async function decryptKeystore(
  ks: Keystore,
  passphrase: string,
): Promise<Uint8Array> {
  if (ks.version !== 3) throw new Error(`unsupported keystore version: ${ks.version}`);
  if (ks.crypto.cipher !== 'aes-128-ctr')
    throw new Error(`unsupported cipher: ${ks.crypto.cipher}`);
  if (ks.crypto.kdf !== 'pbkdf2')
    throw new Error(`unsupported kdf: ${ks.crypto.kdf}`);
  if (ks.crypto.kdfparams.prf !== 'hmac-sha256')
    throw new Error(`unsupported prf: ${ks.crypto.kdfparams.prf}`);
  if (ks.crypto.kdfparams.dklen !== 32)
    throw new Error(`unsupported dklen: ${ks.crypto.kdfparams.dklen}`);

  const subtle = await getSubtle();
  const salt = plainHexToBytes(ks.crypto.kdfparams.salt);
  const iv = plainHexToBytes(ks.crypto.cipherparams.iv);
  const ciphertext = plainHexToBytes(ks.crypto.ciphertext);

  const derivedKey = await pbkdf2(
    passphrase,
    salt,
    ks.crypto.kdfparams.c,
    ks.crypto.kdfparams.dklen,
  );

  const macInput = concatBytes(derivedKey.slice(16, 32), ciphertext);
  const mac = await keccak256(macInput);
  if (bytesToPlainHex(mac) !== ks.crypto.mac.toLowerCase()) {
    throw new Error('invalid passphrase');
  }

  const aesKey = await subtle.importKey(
    'raw',
    derivedKey.slice(0, 16),
    { name: 'AES-CTR', length: 128 },
    false,
    ['decrypt'],
  );
  const plaintext = new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-CTR', counter: iv as BufferSource, length: 128 },
      aesKey,
      ciphertext as BufferSource,
    ),
  );
  return plaintext;
}

// ── Internals ──────────────────────────────────────────────────

async function getSubtle(): Promise<SubtleCrypto> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error(
    'keystore: globalThis.crypto.subtle unavailable. ' +
      'Browsers ship it; Node 18+ provides it via globalThis.crypto.',
  );
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  throw new Error(
    'randomBytes: globalThis.crypto.getRandomValues unavailable. ' +
      'Browsers ship it; Node 18+ provides it via globalThis.crypto.',
  );
}

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback — RFC 4122 v4 from random bytes.
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToPlainHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function pbkdf2(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  keylen: number,
): Promise<Uint8Array> {
  const subtle = await getSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    keylen * 8,
  );
  return new Uint8Array(bits);
}

/// keccak256 — viem ships a pure-JS impl; we use it via the hex
/// codec because the function expects/returns hex strings.
async function keccak256(input: Uint8Array): Promise<Uint8Array> {
  const { keccak256: kek } = await import('viem');
  const hexOut: Hex = kek(`0x${bytesToPlainHex(input)}` as Hex);
  return hexToBytes(hexOut);
}

function bytesToPlainHex(b: Uint8Array): string {
  // Strip viem's `0x` prefix — keystore JSON convention is bare hex.
  return bytesToHex(b).slice(2);
}

function plainHexToBytes(s: string): Uint8Array {
  return hexToBytes(`0x${s.replace(/^0x/, '')}` as Hex);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
