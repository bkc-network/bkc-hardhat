import "hardhat/types/config";
import "hardhat/types/runtime";

/** What a BKC network needs beyond an ordinary EVM one. */
export interface BkcNetworkUserConfig {
  /** Tendermint RPC of the same chain. Writes are broadcast here, not to the EVM endpoint. */
  cosmosRpcUrl: string;
  /** 32-byte ML-DSA-65 seed, hex, `0x` optional. One of `seed` or `mnemonic` is required. */
  seed?: string;
  /** BIP-39 mnemonic, derived with the chain's own HKDF scheme. */
  mnemonic?: string;
  /** Defaults to `m/44'/118'/0'/0/0`. */
  hdPath?: string;
  /** bech32 prefix of the chain's accounts. Defaults to `bkc`. */
  bech32Prefix?: string;
  /** Cosmos gas price, e.g. `5000000bkc`. */
  gasPrice?: string;
  /** Cosmos gas covering the signature itself, before the EVM budget is added. */
  baseGasLimit?: number;
  /**
   * Block explorer, so `hardhat verify` works without hand-writing an etherscan block.
   * Blockscout speaks the Etherscan API at `<explorerUrl>/api`; set `explorerApiUrl` when
   * yours is served from somewhere else.
   */
  explorerUrl?: string;
  explorerApiUrl?: string;
}

export type BkcNetworkConfig = BkcNetworkUserConfig;

declare module "hardhat/types/config" {
  interface HttpNetworkUserConfig {
    bkc?: BkcNetworkUserConfig;
  }

  interface HttpNetworkConfig {
    bkc?: BkcNetworkConfig;
  }
}

declare module "hardhat/types/runtime" {
  interface Network {
    /** Present when the selected network is a BKC network. */
    bkc?: {
      /** Both spellings of the deploying account. Async: resolving it builds the signer. */
      address: () => Promise<{ bech32: string; evm: string }>;
      cosmosRpcUrl: string;
    };
  }
}
