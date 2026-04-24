// Wallet primitives — Sprint W-01 WP-W.1.
// Mirrors the WalletLifecycle.tla state-machine invariants where
// they map to user-facing API behavior.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

import {
  CitrateWallet,
  decryptKeystore,
  encryptKeystore,
} from '../src/wallet/index.js';
import {
  hasInjectedProvider,
  InjectedSigner,
  type EthereumProvider,
} from '../src/wallet/injected.js';
import { isTxSigner } from '../src/x402.js';

// Deterministic test key — mirrors the dev key the gateway smoke
// tests use, so signatures from this wallet match what the gateway
// has already validated end-to-end.
const TEST_KEY_HEX =
  '0x1122334455667788' +
  '99aabbccddee0011' +
  '2233445566778899' +
  'aabbccddee001122';
const TEST_KEY = hexToBytes(TEST_KEY_HEX);

function hexToBytes(s: string): Uint8Array {
  const stripped = s.replace(/^0x/, '');
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('keystore (Web3 Secret Storage v3)', () => {
  test('encrypt → decrypt round-trip recovers the original key', async () => {
    const ks = await encryptKeystore(TEST_KEY, 'correct-horse-battery-staple', '0xdeadbeef');
    expect(ks.version).toBe(3);
    expect(ks.crypto.cipher).toBe('aes-128-ctr');
    expect(ks.crypto.kdf).toBe('pbkdf2');
    expect(ks.crypto.kdfparams.prf).toBe('hmac-sha256');

    const recovered = await decryptKeystore(ks, 'correct-horse-battery-staple');
    expect(Array.from(recovered)).toEqual(Array.from(TEST_KEY));
  });

  test('wrong passphrase rejects with "invalid passphrase"', async () => {
    const ks = await encryptKeystore(TEST_KEY, 'right', '0xabcd');
    await expect(decryptKeystore(ks, 'wrong')).rejects.toThrow(/invalid passphrase/i);
  });

  test('rejects non-32-byte private key', async () => {
    await expect(
      encryptKeystore(new Uint8Array(16), 'p', '0xab'),
    ).rejects.toThrow(/32-byte/);
  });

  test('keystore JSON serialises round-trip', async () => {
    const ks = await encryptKeystore(TEST_KEY, 'pp123456789012', '0xabcd');
    const roundTripped = JSON.parse(JSON.stringify(ks));
    const recovered = await decryptKeystore(roundTripped, 'pp123456789012');
    expect(Array.from(recovered)).toEqual(Array.from(TEST_KEY));
  });

  test('different keys produce different ciphertexts even at same passphrase', async () => {
    const k1 = new Uint8Array(32);
    k1.fill(0x11);
    const k2 = new Uint8Array(32);
    k2.fill(0x22);
    const ks1 = await encryptKeystore(k1, 'pw1234567890', '0xa');
    const ks2 = await encryptKeystore(k2, 'pw1234567890', '0xb');
    expect(ks1.crypto.ciphertext).not.toBe(ks2.crypto.ciphertext);
  });
});

describe('CitrateWallet', () => {
  test('derives address matching viem privateKeyToAccount', () => {
    const wallet = new CitrateWallet(TEST_KEY);
    const expected = privateKeyToAccount(TEST_KEY_HEX as Hex).address;
    expect(wallet.address).toBe(expected);
  });

  test('starts unlocked when constructed from raw key', () => {
    const wallet = new CitrateWallet(TEST_KEY);
    expect(wallet.unlocked).toBe(true);
  });

  test('signs digests producing 65-byte hex', async () => {
    const wallet = new CitrateWallet(TEST_KEY);
    const sig = await wallet.sign({ hash: ('0x' + 'ab'.repeat(32)) as Hex });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  test('lock() drops the in-memory key; sign() then rejects', async () => {
    const wallet = new CitrateWallet(TEST_KEY);
    wallet.lock();
    expect(wallet.unlocked).toBe(false);
    await expect(
      wallet.sign({ hash: ('0x' + '00'.repeat(32)) as Hex }),
    ).rejects.toThrow(/locked/i);
  });

  test('signatures are deterministic (RFC 6979)', async () => {
    const w = new CitrateWallet(TEST_KEY);
    const hash = ('0x' + 'cd'.repeat(32)) as Hex;
    const a = await w.sign({ hash });
    const b = await w.sign({ hash });
    expect(a).toBe(b);
  });

  test('rejects non-32-byte key in constructor', () => {
    expect(() => new CitrateWallet(new Uint8Array(16))).toThrow(/32-byte/);
  });

  // W-01 slice 2 — sendTransaction requires connect() first.
  test('sendTransaction rejects when not connected to a chain', async () => {
    const wallet = new CitrateWallet(TEST_KEY);
    await expect(
      wallet.sendTransaction({
        to: ('0x' + 'ab'.repeat(20)) as Hex,
      }),
    ).rejects.toThrow(/not connected/i);
  });

  test('sendTransaction rejects when locked', async () => {
    const wallet = new CitrateWallet(TEST_KEY);
    wallet.lock();
    await expect(
      wallet.sendTransaction({
        to: ('0x' + 'ab'.repeat(20)) as Hex,
      }),
    ).rejects.toThrow(/locked/i);
  });

  test('implements TxSigner runtime guard', () => {
    const wallet = new CitrateWallet(TEST_KEY);
    expect(isTxSigner(wallet)).toBe(true);
  });
});

describe('InjectedSigner', () => {
  function mockProvider(handlers: Record<string, (params?: unknown) => unknown>): {
    provider: EthereumProvider;
    calls: Array<{ method: string; params?: unknown }>;
  } {
    const calls: Array<{ method: string; params?: unknown }> = [];
    const provider: EthereumProvider = {
      async request(args) {
        calls.push({ method: args.method, params: args.params });
        const handler = handlers[args.method];
        if (!handler) throw new Error(`mock: no handler for ${args.method}`);
        return handler(args.params);
      },
    };
    return { provider, calls };
  }

  afterEach(() => {
    if (typeof window !== 'undefined') {
      // happy-dom test env may have a leftover ethereum stub.
      delete (window as unknown as { ethereum?: unknown }).ethereum;
    }
  });

  test('connect requests accounts and returns the first address', async () => {
    const accounts = ['0x' + 'a1'.repeat(20)];
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => accounts,
      eth_chainId: () => '0x9d0c', // 40204 in hex
    });
    const signer = await InjectedSigner.connect({ provider });
    expect(signer.address.toLowerCase()).toBe(accounts[0]);
    expect(calls[0].method).toBe('eth_requestAccounts');
  });

  test('switches chain when active id differs', async () => {
    const accounts = ['0x' + 'b2'.repeat(20)];
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => accounts,
      eth_chainId: () => '0x1', // mainnet
      wallet_switchEthereumChain: () => null,
    });
    await InjectedSigner.connect({ provider });
    const switchCall = calls.find((c) => c.method === 'wallet_switchEthereumChain');
    expect(switchCall).toBeDefined();
    const params = switchCall!.params as Array<{ chainId: string }>;
    expect(params[0].chainId).toBe('0x9d0c');
  });

  test('does not call switch when already on target chain', async () => {
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c', // 40204
    });
    await InjectedSigner.connect({ provider });
    expect(calls.find((c) => c.method === 'wallet_switchEthereumChain')).toBeUndefined();
  });

  test('sign routes to personal_sign and returns the 65-byte sig', async () => {
    const sig = '0x' + 'aa'.repeat(65); // 65-byte canonical
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c',
      personal_sign: () => sig,
    });
    const signer = await InjectedSigner.connect({ provider });
    const out = await signer.sign({ hash: ('0x' + 'cd'.repeat(32)) as Hex });
    expect(out).toBe(sig);
    expect(calls[calls.length - 1].method).toBe('personal_sign');
  });

  test('rejects malformed signature shape from provider', async () => {
    const { provider } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c',
      personal_sign: () => '0xdeadbeef', // wrong length
    });
    const signer = await InjectedSigner.connect({ provider });
    await expect(
      signer.sign({ hash: ('0x' + '00'.repeat(32)) as Hex }),
    ).rejects.toThrow(/malformed signature/i);
  });

  test('connect throws when no provider is available', async () => {
    await expect(InjectedSigner.connect({})).rejects.toThrow(/no window\.ethereum/i);
  });

  // W-01 slice 2 — sendTransaction routes to eth_sendTransaction.

  test('sendTransaction routes to eth_sendTransaction', async () => {
    const txHash = '0x' + 'ab'.repeat(32);
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c',
      eth_sendTransaction: () => txHash,
    });
    const signer = await InjectedSigner.connect({ provider });
    const out = await signer.sendTransaction({
      to: ('0x' + 'ff'.repeat(20)) as Hex,
      value: 1_000_000_000_000_000_000n,
    });
    expect(out).toBe(txHash);
    const sendCall = calls.find((c) => c.method === 'eth_sendTransaction');
    expect(sendCall).toBeDefined();
    const params = sendCall!.params as Array<Record<string, string>>;
    expect(params[0].from.toLowerCase()).toBe('0x' + 'a1'.repeat(20));
    expect(params[0].to.toLowerCase()).toBe('0x' + 'ff'.repeat(20));
    // value is serialised as hex: 1e18 = 0xDE0B6B3A7640000
    expect(params[0].value).toBe('0xde0b6b3a7640000');
  });

  test('sendTransaction omits value + data when unset', async () => {
    const { provider, calls } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c',
      eth_sendTransaction: () => '0x' + 'cd'.repeat(32),
    });
    const signer = await InjectedSigner.connect({ provider });
    await signer.sendTransaction({
      to: ('0x' + 'ff'.repeat(20)) as Hex,
    });
    const sendCall = calls.find((c) => c.method === 'eth_sendTransaction');
    const params = sendCall!.params as Array<Record<string, string>>;
    expect('value' in params[0]).toBe(false);
    expect('data' in params[0]).toBe(false);
  });

  test('sendTransaction rejects malformed hash from provider', async () => {
    const { provider } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c',
      eth_sendTransaction: () => '0xbad', // wrong length
    });
    const signer = await InjectedSigner.connect({ provider });
    await expect(
      signer.sendTransaction({ to: ('0x' + '00'.repeat(20)) as Hex }),
    ).rejects.toThrow(/malformed tx hash/i);
  });

  test('InjectedSigner implements TxSigner runtime guard', async () => {
    const { provider } = mockProvider({
      eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
      eth_chainId: () => '0x9d0c',
    });
    const signer = await InjectedSigner.connect({ provider });
    expect(isTxSigner(signer)).toBe(true);
  });

  test('hasInjectedProvider reflects window.ethereum presence', () => {
    // happy-dom env doesn't ship window.ethereum by default.
    expect(hasInjectedProvider()).toBe(false);
    (window as unknown as { ethereum: EthereumProvider }).ethereum = {
      request: vi.fn(),
    };
    expect(hasInjectedProvider()).toBe(true);
  });
});
