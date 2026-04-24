// InjectedSigner — fallback wallet adapter wrapping `window.ethereum`.
//
// For users who already have MetaMask / Rabby / etc. installed.
// The adapter requests an address, prompts the user to switch to
// the Citrate testnet if they're on a different chain, and signs
// digests via `personal_sign` semantics (which produces an EIP-155
// canonical 65-byte signature compatible with the SDK's Signer
// interface).
//
// Implements the SDK Signer interface (CM-04 WP-04.3).

import { numberToHex, type Address, type Hex } from 'viem';

import type { TxSigner } from '../x402.js';
import { CITRATE_TESTNET_CHAIN_ID } from '../contracts.js';

/// Minimal shape of `window.ethereum` we depend on. Avoids bringing
/// in a heavyweight EIP-1193 type package for one method.
export interface EthereumProvider {
  request(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }): Promise<unknown>;
}

/// `true` iff this browser appears to host an EIP-1193 provider.
/// Used by the wallet picker to hide the "Browser extension" option
/// when no extension is present.
export function hasInjectedProvider(): boolean {
  if (typeof window === 'undefined') return false;
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return typeof eth?.request === 'function';
}

/// Minimal config for the injected adapter. Only the chain id is
/// required for now; future params (RPC URL hint for chain-add
/// fallback, etc.) land in slice 2.
export interface InjectedSignerOptions {
  /// Citrate chain id. Defaults to testnet (40204).
  chainId?: number;
  /// Test seam — supply a mock provider in unit tests.
  provider?: EthereumProvider;
}

export class InjectedSigner implements TxSigner {
  readonly address: Address;
  /// The chain id this connection is locked to. The connect() flow
  /// already enforced it; exposed so callers can sanity-check
  /// before using the signer in chain-id-sensitive flows.
  readonly chainId: number;
  private readonly provider: EthereumProvider;

  private constructor(
    address: Address,
    provider: EthereumProvider,
    chainId: number,
  ) {
    this.address = address;
    this.provider = provider;
    this.chainId = chainId;
  }

  /// Connect to `window.ethereum` (or a supplied test provider),
  /// request accounts, ensure the active chain matches Citrate
  /// (prompts a switch otherwise), and return the connected signer.
  ///
  /// Throws on user rejection of either the connect or the chain
  /// switch.
  static async connect(opts: InjectedSignerOptions = {}): Promise<InjectedSigner> {
    const provider =
      opts.provider ??
      (typeof window === 'undefined'
        ? undefined
        : (window as unknown as { ethereum?: EthereumProvider }).ethereum);
    if (!provider) {
      throw new Error('InjectedSigner: no window.ethereum provider available');
    }
    const chainId = opts.chainId ?? CITRATE_TESTNET_CHAIN_ID;

    const accounts = (await provider.request({
      method: 'eth_requestAccounts',
    })) as string[];
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('InjectedSigner: no accounts returned');
    }
    const address = accounts[0] as Address;

    // Ensure the active chain matches; prompt to switch otherwise.
    // wallet_switchEthereumChain may reject with code 4902 when the
    // chain isn't yet known to the wallet — in that case the slice-2
    // path will call wallet_addEthereumChain with the Citrate
    // network params; for now, surface the error verbatim.
    const currentHex = (await provider.request({
      method: 'eth_chainId',
    })) as string;
    const currentId = parseInt(currentHex, 16);
    if (currentId !== chainId) {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + chainId.toString(16) }],
      });
    }

    return new InjectedSigner(address, provider, chainId);
  }

  /// Sign a 32-byte digest. Routes to `personal_sign` because that
  /// produces the EIP-155 canonical 65-byte signature shape the SDK
  /// X402Client's `signChallenge` expects.
  async sign(args: { hash: Hex }): Promise<Hex> {
    const sig = (await this.provider.request({
      method: 'personal_sign',
      params: [args.hash, this.address],
    })) as string;
    if (typeof sig !== 'string' || !sig.startsWith('0x') || sig.length !== 132) {
      throw new Error(
        `InjectedSigner: malformed signature from provider (length ${sig?.length ?? 'n/a'})`,
      );
    }
    return sig as Hex;
  }

  /// Send a transaction via the injected provider. Thin wrapper
  /// around `window.ethereum.request({ method: 'eth_sendTransaction' })`
  /// — the provider handles nonce + gas + signing + broadcast
  /// internally and returns the tx hash.
  ///
  /// W-01 slice 2. Mirrors CitrateWallet.sendTransaction's surface
  /// so DirectJobForm and the /credits buy form can swap backends
  /// freely.
  async sendTransaction(tx: {
    to: Address;
    data?: Hex;
    value?: bigint;
  }): Promise<Hex> {
    const params: Record<string, string> = {
      from: this.address,
      to: tx.to,
    };
    if (tx.data !== undefined) params.data = tx.data;
    if (tx.value !== undefined) params.value = numberToHex(tx.value);

    const result = (await this.provider.request({
      method: 'eth_sendTransaction',
      params: [params],
    })) as string;
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error(
        `InjectedSigner.sendTransaction: malformed tx hash from provider: ${result}`,
      );
    }
    return result as Hex;
  }
}
