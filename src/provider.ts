import { EventEmitter } from "node:events";

import type { EIP1193Provider, RequestArguments } from "hardhat/types";

import { badSeed, bothKeys, missingCosmosRpc, missingKey } from "./errors";
import type { Eip1193, OfflineSigner } from "./sdk";
import { sdk, stringToPath, toEvmAddress } from "./sdk";
import type { BkcNetworkConfig } from "./type-extensions";

/** The chain's own path. Not Ethereum's: an account here is a Cosmos account. */
const DEFAULT_HD_PATH = "m/44'/118'/0'/0/0";
const DEFAULT_PREFIX = "bkc";

function seedBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw badSeed();
  return new Uint8Array(Buffer.from(clean, "hex"));
}

async function buildSigner(config: BkcNetworkConfig, network: string): Promise<OfflineSigner> {
  const prefix = config.bech32Prefix ?? DEFAULT_PREFIX;

  if (config.seed && config.mnemonic) throw bothKeys(network);
  if (config.seed) return sdk().DirectMldsa65Wallet.fromSeed(seedBytes(config.seed), prefix);

  if (config.mnemonic) {
    return sdk().DirectMldsa65HdWallet.fromMnemonic(config.mnemonic.trim().replace(/\s+/g, " "), {
      prefix,
      hdPaths: [stringToPath(config.hdPath ?? DEFAULT_HD_PATH)],
    });
  }

  throw missingKey(network);
}

/**
 * Reads go to the EVM JSON-RPC. A write cannot: no ECDSA key exists for the account and the
 * node refuses `eth_sendRawTransaction`, so `eth_sendTransaction` is wrapped in
 * `/bkc.bkc.v1.MsgExecuteEvmCall`, signed with ML-DSA-65 and broadcast through the Cosmos
 * RPC. An ordinary Ethereum hash and receipt come back, so `tx.wait()` is unchanged.
 */
export class BkcProvider extends EventEmitter implements EIP1193Provider {
  private readonly config: BkcNetworkConfig;
  private readonly networkName: string;
  private readonly evmRpcUrl: string;
  private signed?: Promise<{ signer: OfflineSigner; account: { bech32: string; evm: string } }>;
  private inner?: Promise<Eip1193>;
  private writes: Promise<unknown> = Promise.resolve();

  public constructor(networkName: string, evmRpcUrl: string, config: BkcNetworkConfig) {
    super();
    if (!config.cosmosRpcUrl) throw missingCosmosRpc(networkName);

    this.networkName = networkName;
    this.evmRpcUrl = evmRpcUrl;
    this.config = config;
  }

  /**
   * Both spellings of the one account, from the key alone - no node involved. Also served as
   * the `bkc_account` request, since Hardhat hands scripts a wrapper where only `request`
   * survives the trip.
   */
  public async address(): Promise<{ bech32: string; evm: string }> {
    return (await this.signer()).account;
  }

  public async request(args: RequestArguments): Promise<unknown> {
    if (args.method === "bkc_ping") return "pong";
    if (args.method === "bkc_account") return this.address();

    const provider = await this.provider();
    if (args.method !== "eth_sendTransaction") return provider.request(args);

    // `call_nonce` is the account's Cosmos sequence and the handler insists the two match, so
    // two writes in flight is one rejected - not one delayed. A script doing Promise.all of
    // two deployments is ordinary enough that the queue belongs here.
    const queued = this.writes.then(
      () => provider.request(args),
      () => provider.request(args),
    );
    this.writes = queued.catch(() => undefined);
    return queued;
  }

  /** For tools that still speak the pre-EIP-1193 shape. */
  public send(method: string, params?: unknown[]): Promise<unknown> {
    return this.request({ method, params });
  }

  public sendAsync(
    payload: { method: string; params?: unknown[]; id?: number; jsonrpc?: string },
    callback: (error: Error | null, response?: unknown) => void,
  ): void {
    this.request({ method: payload.method, params: payload.params }).then(
      (result) => callback(null, { id: payload.id, jsonrpc: "2.0", result }),
      (error: Error) => callback(error),
    );
  }

  /** The key and the account it derives. Built once, and without touching the network. */
  private signer(): Promise<{ signer: OfflineSigner; account: { bech32: string; evm: string } }> {
    this.signed ??= (async () => {
      const signer = await buildSigner(this.config, this.networkName);
      const [{ address }] = await signer.getAccounts();

      return { signer, account: { bech32: address, evm: toEvmAddress(address) } };
    })();

    return this.signed;
  }

  /** The chain connection, opened on the first request that needs one. */
  private provider(): Promise<Eip1193> {
    this.inner ??= (async () => {
      const { signer } = await this.signer();

      return sdk().createBkcEip1193Provider({
        evmRpcUrl: this.evmRpcUrl,
        cosmosRpcUrl: this.config.cosmosRpcUrl,
        signer,
        ...(this.config.gasPrice ? { gasPrice: sdk().GasPrice.fromString(this.config.gasPrice) } : {}),
        ...(this.config.baseGasLimit ? { baseGasLimit: BigInt(this.config.baseGasLimit) } : {}),
      });
    })();

    return this.inner;
  }
}
