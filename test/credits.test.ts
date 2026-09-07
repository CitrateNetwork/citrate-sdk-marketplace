// Tests for the credits-purchase helpers (CM-06 WP-06.3 slice 2).

import { describe, expect, test } from 'vitest';
import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  slice,
  type Hex,
  type Log,
} from 'viem';

import { erc20Abi } from '../src/abi/erc20.js';
import { bulkComputeGatewayAbi } from '../src/abi/bulk-compute-gateway.js';
import {
  erc20ApproveCalldata,
  parseCreditsEvents,
  purchaseComputeCreditsCalldata,
} from '../src/credits.js';

const USDC = ('0x' + 'aa'.repeat(20)) as `0x${string}`;
const GATEWAY = ('0x' + 'bb'.repeat(20)) as `0x${string}`;
const INSTITUTION = ('0x' + 'cc'.repeat(20)) as `0x${string}`;
const SPENDER = ('0x' + 'dd'.repeat(20)) as `0x${string}`;

describe('erc20ApproveCalldata', () => {
  test('selector matches ERC20.approve signature', () => {
    const { data } = erc20ApproveCalldata({ spender: GATEWAY, amount: 50_000_000n });
    const sigHash = keccak256(
      new TextEncoder().encode('approve(address,uint256)'),
    );
    expect(slice(data, 0, 4)).toBe(slice(sigHash, 0, 4));
  });

  test('round-trips spender and amount', () => {
    const { data } = erc20ApproveCalldata({
      spender: GATEWAY,
      amount: 123_456_789n,
    });
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    expect(decoded.functionName).toBe('approve');
    expect((decoded.args?.[0] as string).toLowerCase()).toBe(GATEWAY);
    expect(decoded.args?.[1]).toBe(123_456_789n);
  });

  test('encodes zero amount without throwing (revoke-allowance pattern)', () => {
    const { data } = erc20ApproveCalldata({ spender: GATEWAY, amount: 0n });
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    expect(decoded.args?.[1]).toBe(0n);
  });
});

describe('purchaseComputeCreditsCalldata', () => {
  test('selector matches purchaseComputeCredits signature', () => {
    const { data } = purchaseComputeCreditsCalldata({
      stablecoin: USDC,
      amount: 10_000_000n,
    });
    const sigHash = keccak256(
      new TextEncoder().encode('purchaseComputeCredits(address,uint256)'),
    );
    expect(slice(data, 0, 4)).toBe(slice(sigHash, 0, 4));
  });

  test('round-trips stablecoin and amount', () => {
    const { data } = purchaseComputeCreditsCalldata({
      stablecoin: USDC,
      amount: 25_000_000n,
    });
    const decoded = decodeFunctionData({ abi: bulkComputeGatewayAbi, data });
    expect(decoded.functionName).toBe('purchaseComputeCredits');
    expect((decoded.args?.[0] as string).toLowerCase()).toBe(USDC);
    expect(decoded.args?.[1]).toBe(25_000_000n);
  });
});

describe('parseCreditsEvents', () => {
  function creditsPurchasedLog(
    institution: Hex,
    stablecoin: Hex,
    usdAmount: bigint,
    creditsReceived: bigint,
    purchaseIndex: bigint,
  ): Log {
    const sigHash = keccak256(
      new TextEncoder().encode(
        'CreditsPurchased(address,address,uint256,uint256,uint256)',
      ),
    );
    return {
      address: GATEWAY as Hex,
      blockNumber: 42n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [usdAmount, creditsReceived, purchaseIndex],
      ) as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '11'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [
        sigHash,
        encodeAbiParameters([{ type: 'address' }], [institution]) as Hex,
        encodeAbiParameters([{ type: 'address' }], [stablecoin]) as Hex,
      ],
    } as Log;
  }

  function creditsSpentLog(
    institution: Hex,
    spender: Hex,
    creditAmount: bigint,
  ): Log {
    const sigHash = keccak256(
      new TextEncoder().encode('CreditsSpent(address,address,uint256)'),
    );
    return {
      address: GATEWAY as Hex,
      blockNumber: 50n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: encodeAbiParameters([{ type: 'uint256' }], [creditAmount]) as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '22'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [
        sigHash,
        encodeAbiParameters([{ type: 'address' }], [institution]) as Hex,
        encodeAbiParameters([{ type: 'address' }], [spender]) as Hex,
      ],
    } as Log;
  }

  test('decodes CreditsPurchased', () => {
    const log = creditsPurchasedLog(INSTITUTION, USDC, 100_000_000n, 769_230_769_230_769_230n, 7n);
    const events = parseCreditsEvents([log], GATEWAY);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('CreditsPurchased');
    if (events[0].kind === 'CreditsPurchased') {
      expect(events[0].institution.toLowerCase()).toBe(INSTITUTION);
      expect(events[0].stablecoin.toLowerCase()).toBe(USDC);
      expect(events[0].usdAmount).toBe(100_000_000n);
      expect(events[0].creditsReceived).toBe(769_230_769_230_769_230n);
      expect(events[0].purchaseIndex).toBe(7n);
      expect(events[0].blockNumber).toBe(42n);
    }
  });

  test('decodes CreditsSpent', () => {
    const log = creditsSpentLog(INSTITUTION, SPENDER, 1_000_000_000_000_000_000n);
    const events = parseCreditsEvents([log], GATEWAY);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('CreditsSpent');
    if (events[0].kind === 'CreditsSpent') {
      expect(events[0].institution.toLowerCase()).toBe(INSTITUTION);
      expect(events[0].spender.toLowerCase()).toBe(SPENDER);
      expect(events[0].creditAmount).toBe(1_000_000_000_000_000_000n);
    }
  });

  test('skips unrelated logs silently', () => {
    const noise = {
      address: GATEWAY as Hex,
      blockNumber: 1n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: '0x' as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '33'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [('0x' + 'ff'.repeat(32)) as Hex],
    } as Log;
    expect(parseCreditsEvents([noise], GATEWAY)).toEqual([]);
  });

  test('processes mixed logs preserving order', () => {
    const a = creditsPurchasedLog(INSTITUTION, USDC, 10_000_000n, 1n, 0n);
    const b = creditsSpentLog(INSTITUTION, SPENDER, 5n);
    const out = parseCreditsEvents([a, b], GATEWAY);
    expect(out.map((e) => e.kind)).toEqual(['CreditsPurchased', 'CreditsSpent']);
  });
});
