// This plugin is required first on purpose: hardhat-verify normalises config.etherscan in
// its own config hook, and registering the chain there only survived the other order.
require("../dist/index.js");
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-ignition-ethers");
require("@nomicfoundation/hardhat-verify");

/** The example the e2e test drives. Everything that identifies a chain comes from the env. */
module.exports = {
  // Blocks here are under a second, so Ignition's default of five confirmations is a long
  // wait for no extra safety.
  ignition: { requiredConfirmations: 1 },
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    bkcTestnet: {
      url: process.env.BKC_EVM_RPC ?? "",
      chainId: Number(process.env.BKC_EVM_CHAIN_ID ?? 262144),
      bkc: {
        cosmosRpcUrl: process.env.BKC_COSMOS_RPC ?? "",
        seed: process.env.BKC_SEED,
        gasPrice: process.env.BKC_GAS_PRICE ?? "5000000bkc",
        explorerUrl: process.env.BKC_EXPLORER,
      },
    },
    // The same account, reached from the phrase instead of the seed. The chain derives an
    // ML-DSA-65 key from a BIP-39 seed with HKDF, since lattice keys have no BIP-32.
    bkcTestnetMnemonic: {
      url: process.env.BKC_EVM_RPC ?? "",
      chainId: Number(process.env.BKC_EVM_CHAIN_ID ?? 262144),
      bkc: {
        cosmosRpcUrl: process.env.BKC_COSMOS_RPC ?? "",
        mnemonic: process.env.BKC_MNEMONIC,
        gasPrice: process.env.BKC_GAS_PRICE ?? "5000000bkc",
      },
    },
  },
};
