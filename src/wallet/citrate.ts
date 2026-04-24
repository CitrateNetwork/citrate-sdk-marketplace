// CitrateWallet — primary in-browser wallet implementation.
//
// Wraps the in-repo wallet primitives (Web3 Secret Storage v3
// keystore, secp256k1 signing) so the buyer-webapp doesn't depend on
// a browser extension that isn't published yet. Compatible with the
// Rust wallet-core's keystore format — a key created by the desktop
// app's wallet manager will load here, and vice versa.
//
// Implements the SDK's Signer interface (CM-04 WP-04.3) so the
// existing Flow A x402 path works without modification.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { TxSigner } from '../x402.js';
import {
  decryptKeystore,
  encryptKeystore,
  type Keystore,
} from './keystore.js';

const STORAGE_KEY = 'citrate.buyer.citrateKeystore';

export interface CitrateWalletState {
  /// `true` once decrypted in memory; signing is enabled.
  unlocked: boolean;
  /// EOA address derived from the private key. Always present as
  /// long as the keystore exists, even when locked (so the UI can
  /// show "0xabcd…" without prompting for the passphrase).
  address: Address;
}

/// In-memory wallet handle. Use the factory `loadOrCreate` /
/// `unlock` / `clear` functions to manage keystore state in
/// localStorage; this class is the runtime representation only.
///
/// To get a `Signer` for use with the SDK's X402Client, instantiate
/// CitrateWallet via `unlock(passphrase)` and pass it to the form.
///
/// W-01 slice 2: also implements `TxSigner` — `sendTransaction`
/// builds an EIP-155 legacy tx, signs via viem, posts via
/// `eth_sendRawTransaction`. Requires an RPC URL + chain id at
/// construction time (or via `connect()` after unlock).
export class CitrateWallet implements TxSigner {
  /// EVM address derived from the private key. Stable across lock /
  /// unlock cycles.
  readonly address: Address;
  /// In-memory account handle from viem. Cleared on `lock()`.
  private account: ReturnType<typeof privateKeyToAccount> | null;
  /// Tx-send chain config. Populated by `connect()` (or the
  /// convenience `createWallet` / `unlockWallet` factories when
  /// they're given a chain). `sendTransaction` requires this;
  /// digest-only flows (x402 sign) do not.
  private chain: Chain | null = null;
  private publicClient: PublicClient | null = null;

  constructor(privateKey: Uint8Array) {
    if (privateKey.length !== 32) {
      throw new Error(`CitrateWallet: expected 32-byte key, got ${privateKey.length}`);
    }
    const hex = ('0x' + bytesToHex(privateKey)) as Hex;
    this.account = privateKeyToAccount(hex);
    this.address = this.account.address;
  }

  /// True iff the wallet currently holds the private key in memory.
  get unlocked(): boolean {
    return this.account !== null;
  }

  /// Wire the wallet to a chain so `sendTransaction` works. Digest-
  /// only flows (x402) don't require this. Returns `this` for
  /// chaining.
  connect(chain: Chain, rpcUrl?: string): this {
    this.chain = chain;
    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    return this;
  }

  /// Sign a 32-byte digest. Throws if locked. Conforms to the
  /// SDK Signer interface — viem's account.sign returns the 65-byte
  /// EIP-155 hex which X402Client's signChallenge parses.
  async sign(args: { hash: Hex }): Promise<Hex> {
    if (!this.account) {
      throw new Error('CitrateWallet: locked; call unlock() first');
    }
    return this.account.sign({ hash: args.hash });
  }

  /// Build, sign, and broadcast an EIP-155 tx. Returns the tx
  /// hash from `eth_sendRawTransaction`. Caller polls for the
  /// receipt separately (or uses
  /// `publicClient.waitForTransactionReceipt`).
  async sendTransaction(tx: {
    to: Address;
    data?: Hex;
    value?: bigint;
  }): Promise<Hex> {
    if (!this.account) {
      throw new Error('CitrateWallet: locked; call unlock() first');
    }
    if (!this.chain || !this.publicClient) {
      throw new Error(
        'CitrateWallet: not connected to a chain; call connect(chain, rpcUrl)',
      );
    }
    const wallet = createWalletClient({
      chain: this.chain,
      transport: http(this.publicClient.transport.url),
      account: this.account,
    });
    return wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value,
    });
  }

  /// Drop the in-memory key. Subsequent sign() calls reject.
  /// Persisted keystore is unaffected — re-unlock with passphrase.
  lock(): void {
    this.account = null;
  }
}

/// Create a brand-new wallet: generate a 32-byte key, derive the
/// address, encrypt the key under `passphrase`, persist the keystore
/// to localStorage, return an unlocked CitrateWallet.
export async function createWallet(passphrase: string): Promise<CitrateWallet> {
  if (passphrase.length < 12) {
    throw new Error('CitrateWallet: passphrase must be at least 12 characters');
  }
  const privateKey = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(privateKey);
  } else {
    throw new Error(
      'createWallet: globalThis.crypto.getRandomValues unavailable. ' +
        'Browsers ship it; Node 18+ provides it via globalThis.crypto.',
    );
  }
  const wallet = new CitrateWallet(privateKey);
  const ks = await encryptKeystore(privateKey, passphrase, wallet.address);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ks));
  }
  return wallet;
}

/// Try to load a keystore from localStorage and unlock it with the
/// given passphrase. Returns the unlocked wallet or throws on bad
/// passphrase / missing keystore.
export async function unlockWallet(passphrase: string): Promise<CitrateWallet> {
  const raw = readKeystoreJson();
  if (!raw) throw new Error('CitrateWallet: no keystore in storage');
  const ks = JSON.parse(raw) as Keystore;
  const privateKey = await decryptKeystore(ks, passphrase);
  return new CitrateWallet(privateKey);
}

/// Read the keystore's address WITHOUT decrypting. Lets the UI
/// show a partial identity (truncated 0x…) before the user types
/// their passphrase.
export function peekKeystoreAddress(): Address | null {
  const raw = readKeystoreJson();
  if (!raw) return null;
  try {
    const ks = JSON.parse(raw) as Keystore;
    return ('0x' + ks.address.toLowerCase()) as Address;
  } catch {
    return null;
  }
}

/// True iff a keystore exists in localStorage (regardless of
/// whether the wallet is currently unlocked in memory).
export function hasStoredKeystore(): boolean {
  return readKeystoreJson() !== null;
}

/// Permanently delete the stored keystore. The user can NEVER
/// recover the key after this — they must save the passphrase
/// elsewhere if they want recovery, or write down the seed phrase
/// (slice 2 will add seed-phrase export).
export function clearKeystore(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function readKeystoreJson(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}
