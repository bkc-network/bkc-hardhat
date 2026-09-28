/** Errors a user can act on, rather than a stack trace from three libraries down. */
export class BkcPluginError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BkcPluginError";
  }
}

export const missingKey = (network: string): BkcPluginError =>
  new BkcPluginError(
    `Network "${network}" has no signing key. Set networks.${network}.bkc.seed to a 32-byte hex ` +
      `ML-DSA-65 seed, or networks.${network}.bkc.mnemonic to a BIP-39 phrase. Read it from an ` +
      `environment variable to keep it out of the repository.`,
  );

export const bothKeys = (network: string): BkcPluginError =>
  new BkcPluginError(`Network "${network}" sets both bkc.seed and bkc.mnemonic. Use one: they derive different accounts.`);

export const missingCosmosRpc = (network: string): BkcPluginError =>
  new BkcPluginError(
    `Network "${network}" has no bkc.cosmosRpcUrl. Writes are broadcast through the Cosmos RPC of ` +
      `the same chain, because eth_sendRawTransaction is disabled here.`,
  );

export const badSeed = (): BkcPluginError =>
  new BkcPluginError("bkc.seed must be 32 bytes of hex (64 characters, 0x optional).");
