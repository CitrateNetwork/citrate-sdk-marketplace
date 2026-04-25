// Public re-exports for the wallet subsystem (Sprint W-01).

export {
  CitrateWallet,
  clearKeystore,
  createWallet,
  hasStoredKeystore,
  peekKeystoreAddress,
  unlockWallet,
  type CitrateWalletState,
} from './citrate.js';

export {
  hasInjectedProvider,
  InjectedSigner,
  type EthereumProvider,
  type InjectedSignerOptions,
} from './injected.js';

export {
  decryptKeystore,
  encryptKeystore,
  type Keystore,
} from './keystore.js';

/// Tag for the wallet picker UI / telemetry.
///
/// RM-B1 / WP-E6.4 follow-on (audit GUI-B-01): `DevSigner` was
/// removed when `lib/devSigner.ts` was deleted from the buyer
/// webapp. Tests that need a quick signer should construct a
/// `viem` `privateKeyToAccount` directly inside the test fixture
/// (`__tests__/fixtures/MockSigner.ts`), not through this enum.
export const WalletKind = {
  Citrate: 'citrate',
  Injected: 'injected',
} as const;
export type WalletKindValue = (typeof WalletKind)[keyof typeof WalletKind];
