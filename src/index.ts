import { extendConfig, extendEnvironment, extendProvider } from "hardhat/config";
import type { HardhatConfig, HardhatUserConfig, HttpNetworkConfig } from "hardhat/types";

import { BkcProvider } from "./provider";
import { bkcConfigOf } from "./tasks";

import "./tasks";
import "./type-extensions";

export { BkcPluginError } from "./errors";
export { BkcProvider } from "./provider";
export type { BkcNetworkConfig, BkcNetworkUserConfig } from "./type-extensions";

extendConfig((config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
  for (const [name, userNetwork] of Object.entries(userConfig.networks ?? {})) {
    const bkc = (userNetwork as { bkc?: unknown }).bkc;
    if (!bkc) continue;

    const network = config.networks[name] as HttpNetworkConfig;
    network.bkc = bkc as HttpNetworkConfig["bkc"];

    if (Array.isArray(network.accounts) && network.accounts.length > 0) {
      console.warn(
        `[hardhat-bkc] Ignoring networks.${name}.accounts: this chain has no ECDSA keys, so a ` +
          `private key cannot sign for it. The account comes from networks.${name}.bkc.seed.`,
      );
    }

    // Anything but "remote" installs Hardhat's local-accounts wrapper in front of this
    // plugin, and that wrapper answers eth_accounts itself - with an empty list, since no
    // Ethereum private key exists here. getSigners() then returns nothing.
    network.accounts = "remote";
  }
});

/**
 * Registers the chain with hardhat-verify, so one URL replaces a customChains block.
 *
 * Not in extendConfig: hardhat-verify normalises `config.etherscan` in its own config hook,
 * so registering there survives only one order of requires.
 */
function registerExplorer(config: HardhatConfig, name: string, network: HttpNetworkConfig): void {
  const explorer = network.bkc?.explorerUrl;
  if (!explorer) return;

  // Guessing a chain id would register the wrong one silently, and hardhat-verify would then
  // post the source to whatever chain that id belongs to.
  if (network.chainId === undefined) {
    console.warn(
      `[hardhat-bkc] networks.${name}.bkc.explorerUrl is set but networks.${name}.chainId is not, ` +
        `so hardhat verify cannot be configured for it.`,
    );
    return;
  }

  const base = explorer.replace(/\/$/, "");
  const etherscan = ((config as unknown as { etherscan?: EtherscanConfig }).etherscan ??= {});

  // Per network, not a single string: hardhat-verify resolves a custom chain's key from this
  // map and refuses the string form for one. The deprecation warning it prints alongside is
  // about Etherscan's own v2 API and does not apply to Blockscout.
  etherscan.apiKey = typeof etherscan.apiKey === "object" ? etherscan.apiKey : {};
  etherscan.apiKey[name] ??= PLACEHOLDER_API_KEY;

  etherscan.customChains ??= [];

  if (etherscan.customChains.some((chain) => chain.network === name)) return;

  etherscan.customChains.push({
    network: name,
    chainId: network.chainId,
    urls: { apiURL: network.bkc?.explorerApiUrl ?? `${base}/api`, browserURL: base },
  });
}

const PLACEHOLDER_API_KEY = "blockscout-needs-no-key";

interface EtherscanConfig {
  apiKey?: string | Record<string, string>;
  customChains?: { network: string; chainId: number; urls: { apiURL: string; browserURL: string } }[];
}

extendProvider(async (provider, config, networkName) => {
  const network = bkcConfigOf(config, networkName);
  return network ? new BkcProvider(networkName, network.url, network.bkc!) : provider;
});

extendEnvironment((hre) => {
  // Every BKC network, not just the selected one: `hardhat verify --list-networks` runs
  // without a network, and a project with two of them should see both.
  for (const name of Object.keys(hre.config.networks)) {
    const network = bkcConfigOf(hre.config, name);
    if (network) registerExplorer(hre.config, name, network);
  }

  const network = bkcConfigOf(hre.config, hre.network.name);
  if (!network) return;

  hre.network.bkc = {
    cosmosRpcUrl: network.bkc!.cosmosRpcUrl,
    address: () =>
      hre.network.provider.request({ method: "bkc_account" }) as Promise<{ bech32: string; evm: string }>,
  };
});
