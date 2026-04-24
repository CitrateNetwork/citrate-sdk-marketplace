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
export const WalletKind = {
  Citrate: 'citrate',
  Injected: 'injected',
  /// Demoted holdover from CM-04 WP-04.3 — only available in dev
  /// builds for testing convenience. Production builds hide it.
  DevSigner: 'dev-signer',
} as const;
export type WalletKindValue = (typeof WalletKind)[keyof typeof WalletKind];
