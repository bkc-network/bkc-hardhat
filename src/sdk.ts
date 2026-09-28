/** The one place this plugin reaches into `@bkc-network-lib`, loaded on first use. */

export interface OfflineSigner {
  getAccounts: () => Promise<ReadonlyArray<{ address: string }>>;
}

export interface Eip1193 {
  request: (args: { method: string; params?: readonly unknown[] | object }) => Promise<unknown>;
}

interface Sdk {
  createBkcEip1193Provider: (options: Record<string, unknown>) => Promise<Eip1193>;
  DirectMldsa65Wallet: { fromSeed: (seed: Uint8Array, prefix: string) => Promise<OfflineSigner> };
  DirectMldsa65HdWallet: {
    fromMnemonic: (mnemonic: string, options: Record<string, unknown>) => Promise<OfflineSigner>;
  };
  GasPrice: { fromString: (value: string) => unknown };
}

let cached: Sdk | undefined;

/**
 * Required lazily: loading the crypto stack costs time, and `hardhat compile` on a BKC
 * network should not pay for a signer it never uses.
 */
export function sdk(): Sdk {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cached ??= require("@bkc-network-lib/sdk") as Sdk;
  return cached;
}

/**
 * The EVM address of a Cosmos account: its own twenty bytes, hex encoded.
 *
 * Not the SDK's `toEvmAddress`, which accepts no bech32 prefix but `bkc` and would decide
 * for the user what their chain is called.
 */
export function toEvmAddress(bech32Address: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { fromBech32, toHex } = require("@bkc-network-lib/encoding") as {
    fromBech32: (address: string) => { data: Uint8Array };
    toHex: (bytes: Uint8Array) => string;
  };

  return `0x${toHex(fromBech32(bech32Address).data)}`;
}

/** `stringToPath` is exported by the crypto package, not the SDK's own surface. */
export function stringToPath(path: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { stringToPath: parse } = require("@bkc-network-lib/crypto") as {
    stringToPath: (path: string) => unknown;
  };
  return parse(path);
}
