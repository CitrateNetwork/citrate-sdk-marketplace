// unlockWallet must bind the address a stored keystore declares (what
// peekKeystoreAddress shows before unlock) to the address derived from the
// key that actually decrypts. A stored keystore whose declared address does
// not match must be refused, not unlocked as a different identity.

import { afterEach, describe, expect, test } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex } from 'viem';

import { encryptKeystore } from '../src/wallet/keystore.js';
import { peekKeystoreAddress, unlockWallet } from '../src/wallet/citrate.js';

// Must match the storage key the wallet module reads.
const STORAGE_KEY = 'citrate.buyer.citrateKeystore';
const PASS = 'correct horse battery staple';

const KEY = new Uint8Array(32).fill(7);
const KEY_ADDR = privateKeyToAccount(bytesToHex(KEY)).address;
const OTHER_ADDR = ('0x' + '5e'.repeat(20)) as `0x${string}`;

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

describe('unlockWallet address binding', () => {
  test('control: a keystore declaring its own address unlocks to that address', async () => {
    const ks = await encryptKeystore(new Uint8Array(KEY), PASS, KEY_ADDR);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ks));
    expect(peekKeystoreAddress()?.toLowerCase()).toBe(KEY_ADDR.toLowerCase());
    const wallet = await unlockWallet(PASS);
    expect(wallet.address.toLowerCase()).toBe(KEY_ADDR.toLowerCase());
  });

  test('a keystore declaring a different address is refused on unlock', async () => {
    // Valid envelope (correct MAC), but the declared address names another
    // account: the pre-unlock display and the signing key would disagree.
    const ks = await encryptKeystore(new Uint8Array(KEY), PASS, OTHER_ADDR);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ks));
    expect(peekKeystoreAddress()?.toLowerCase()).toBe(OTHER_ADDR.toLowerCase());
    await expect(unlockWallet(PASS)).rejects.toThrow(/does not match/);
  });
});
