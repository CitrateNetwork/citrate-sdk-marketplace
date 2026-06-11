// SECREM-02 5.3 — CITRATE_SDK_MARKETPLACE-2026-05-31-004.
//
// InjectedSigner's chain check was connect-time only (TOCTOU): the
// user (or a racing dapp) can switch the wallet to another chain
// after connect(), and every later sign / signEip712 /
// sendTransaction would silently operate against the wrong chain.
// Each signing-path method must re-query `eth_chainId` and FAIL
// CLOSED (throw) when the active chain no longer matches the chain
// the signer was connected to.

import { afterEach, describe, expect, test } from 'vitest';
import type { Hex } from 'viem';

import {
  InjectedSigner,
  type EthereumProvider,
} from '../src/wallet/injected.js';

const CITRATE_HEX = '0x9d0c'; // 40204
const MAINNET_HEX = '0x1';

/// Provider that reports the Citrate chain during connect(), then
/// switches to another chain for every subsequent eth_chainId query —
/// the TOCTOU window the finding describes.
function chainSwitchingProvider(): {
  provider: EthereumProvider;
  calls: Array<{ method: string; params?: unknown }>;
} {
  const calls: Array<{ method: string; params?: unknown }> = [];
  let chainQueries = 0;
  const handlers: Record<string, (params?: unknown) => unknown> = {
    eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
    eth_chainId: () => {
      chainQueries += 1;
      return chainQueries === 1 ? CITRATE_HEX : MAINNET_HEX;
    },
    personal_sign: () => '0x' + 'aa'.repeat(65),
    eth_signTypedData_v4: () => '0x' + 'bb'.repeat(65),
    eth_sendTransaction: () => '0x' + 'cc'.repeat(32),
  };
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

/// Provider that stays on the Citrate chain forever.
function stableProvider(): EthereumProvider {
  const handlers: Record<string, (params?: unknown) => unknown> = {
    eth_requestAccounts: () => ['0x' + 'a1'.repeat(20)],
    eth_chainId: () => CITRATE_HEX,
    personal_sign: () => '0x' + 'aa'.repeat(65),
    eth_signTypedData_v4: () => '0x' + 'bb'.repeat(65),
    eth_sendTransaction: () => '0x' + 'cc'.repeat(32),
  };
  return {
    async request(args) {
      const handler = handlers[args.method];
      if (!handler) throw new Error(`mock: no handler for ${args.method}`);
      return handler(args.params);
    },
  };
}

const TYPED_DATA = {
  domain: {
    name: 'Wrapped SALT',
    version: '1',
    chainId: 40204,
    verifyingContract: ('0x' + '11'.repeat(20)) as `0x${string}`,
  },
  types: { EIP712Domain: [] },
  primaryType: 'TransferWithAuthorization',
  message: {},
};

afterEach(() => {
  if (typeof window !== 'undefined') {
    delete (window as unknown as { ethereum?: unknown }).ethereum;
  }
});

describe('InjectedSigner chain TOCTOU (-004)', () => {
  test('TRIPWIRE: sign() refuses after the wallet switched chains post-connect', async () => {
    const { provider } = chainSwitchingProvider();
    const signer = await InjectedSigner.connect({ provider });
    await expect(
      signer.sign({ hash: ('0x' + 'cd'.repeat(32)) as Hex }),
    ).rejects.toThrow(/chain/i);
  });

  test('TRIPWIRE: signEip712() refuses after the wallet switched chains post-connect', async () => {
    const { provider } = chainSwitchingProvider();
    const signer = await InjectedSigner.connect({ provider });
    await expect(signer.signEip712(TYPED_DATA)).rejects.toThrow(/chain/i);
  });

  test('TRIPWIRE: sendTransaction() refuses after the wallet switched chains post-connect', async () => {
    const { provider } = chainSwitchingProvider();
    const signer = await InjectedSigner.connect({ provider });
    await expect(
      signer.sendTransaction({ to: ('0x' + 'a2'.repeat(20)) as `0x${string}` }),
    ).rejects.toThrow(/chain/i);
  });

  test('TRIPWIRE: the wrong-chain sign() refusal happens before personal_sign is invoked', async () => {
    const { provider, calls } = chainSwitchingProvider();
    const signer = await InjectedSigner.connect({ provider });
    await expect(
      signer.sign({ hash: ('0x' + 'cd'.repeat(32)) as Hex }),
    ).rejects.toThrow();
    expect(calls.some((c) => c.method === 'personal_sign')).toBe(false);
  });

  test('still signs normally when the chain has not changed', async () => {
    const signer = await InjectedSigner.connect({ provider: stableProvider() });
    const sig = await signer.sign({ hash: ('0x' + 'cd'.repeat(32)) as Hex });
    expect(sig).toBe('0x' + 'aa'.repeat(65));
    const sig712 = await signer.signEip712(TYPED_DATA);
    expect(sig712).toBe('0x' + 'bb'.repeat(65));
    const txHash = await signer.sendTransaction({
      to: ('0x' + 'a2'.repeat(20)) as `0x${string}`,
    });
    expect(txHash).toBe('0x' + 'cc'.repeat(32));
  });
});
