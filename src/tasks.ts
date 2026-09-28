import { task } from "hardhat/config";
import type { HardhatConfig, HttpNetworkConfig } from "hardhat/types";

import { sdk, toEvmAddress } from "./sdk";

/** The network's BKC settings, or undefined when it is an ordinary Ethereum network. */
export function bkcConfigOf(config: HardhatConfig, networkName: string): HttpNetworkConfig | undefined {
  const network = config.networks[networkName] as HttpNetworkConfig | undefined;
  return network && "bkc" in network && network.bkc ? network : undefined;
}

const BKC = 10n ** 18n;

task("bkc-account", "Prints the account this network deploys from, and what it holds").setAction(
  async (_args, hre) => {
    const network = bkcConfigOf(hre.config, hre.network.name);
    if (!network) throw new Error(`Network "${hre.network.name}" has no networks.<name>.bkc block.`);

    const { bech32, evm } = await hre.network.bkc!.address();
    const [chainId, balance, nonce] = await Promise.all([
      hre.network.provider.request({ method: "eth_chainId" }),
      hre.network.provider.request({ method: "eth_getBalance", params: [evm, "latest"] }),
      hre.network.provider.request({ method: "eth_getTransactionCount", params: [evm, "latest"] }),
    ]);

    const wei = BigInt(balance as string);
    console.log(`network   ${hre.network.name}`);
    console.log(`chain id  ${Number(chainId as string)} (EVM) · ${network.bkc!.cosmosRpcUrl} (Cosmos RPC)`);
    console.log(`account   ${bech32}`);
    console.log(`          ${evm}`);
    console.log(`balance   ${wei / BKC}.${(wei % BKC).toString().padStart(18, "0").slice(0, 6)} BKC`);
    console.log(`nonce     ${Number(nonce as string)}`);
  },
);

task("bkc-new-account", "Generates a development account: a seed and the addresses it derives")
  .addOptionalParam("prefix", "bech32 prefix of the chain's accounts", "bkc")
  .setAction(async ({ prefix }: { prefix: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomBytes } = require("node:crypto") as typeof import("node:crypto");

    const seed = randomBytes(32);
    const [{ address }] = await (await sdk().DirectMldsa65Wallet.fromSeed(new Uint8Array(seed), prefix)).getAccounts();

    console.log(`seed     ${seed.toString("hex")}`);
    console.log(`account  ${address}`);
    console.log(`         ${toEvmAddress(address)}`);
    console.log("\nPut the seed in .env as BKC_SEED, and fund the address before deploying.");
    console.log("This is a development key printed to a terminal. Do not hold anything of value with it.");
  });

task("bkc-doctor", "Checks everything a deployment needs, and says what is missing").setAction(
  async (_args, hre) => {
    const network = bkcConfigOf(hre.config, hre.network.name);
    if (!network) {
      console.log(`Network "${hre.network.name}" is not a BKC network - it has no networks.<name>.bkc block.`);
      process.exitCode = 1;
      return;
    }

    const lines: string[] = [];
    let failures = 0;
    const ok = (label: string, detail: string) => lines.push(`  ok    ${label.padEnd(22)} ${detail}`);
    const bad = (label: string, detail: string, fix: string) => {
      failures += 1;
      lines.push(`  FAIL  ${label.padEnd(22)} ${detail}`);
      lines.push(`        ${" ".repeat(22)} -> ${fix}`);
    };
    const report = () => {
      const head = failures === 0 ? "Ready to deploy." : `${failures} problem${failures > 1 ? "s" : ""} to fix first.`;
      console.log(`\n${head}\n\n${lines.join("\n")}\n`);
      if (failures > 0) process.exitCode = 1;
    };

    const bkc = network.bkc!;
    const { provider } = hre.network;

    try {
      const reported = Number((await provider.request({ method: "eth_chainId" })) as string);
      if (network.chainId && reported !== network.chainId) {
        bad("EVM endpoint", `${network.url} reports chain ${reported}`, `config says ${network.chainId}; one of the two is wrong`);
      } else {
        ok("EVM endpoint", `${network.url} · chain ${reported}`);
      }
    } catch (error) {
      const message = String(error);

      // A missing key surfaces here, because the first request is what builds the signer.
      // Reported as an endpoint failure it sends people to check a URL that was fine.
      if (/no signing key|32 bytes of hex|derive different accounts/i.test(message)) {
        bad("account", "no usable key", message.replace(/^.*?Error:\s*/, "").slice(0, 160));
      } else if (/HH101|chain id/i.test(message)) {
        bad("EVM endpoint", `${network.url} is not chain ${network.chainId}`, "fix chainId, or point url at the chain you meant");
      } else {
        bad("EVM endpoint", `${network.url} did not answer`, `check the URL and that the node is up (${message.slice(0, 60)})`);
      }

      return report();
    }

    try {
      const response = await fetch(`${bkc.cosmosRpcUrl.replace(/\/$/, "")}/status`);
      const body = (await response.json()) as { result?: { node_info?: { network?: string } } };
      ok("Cosmos endpoint", `${bkc.cosmosRpcUrl} · ${body.result?.node_info?.network ?? "answered"}`);
    } catch (error) {
      bad("Cosmos endpoint", `${bkc.cosmosRpcUrl} did not answer`, `writes are broadcast here (${String(error).slice(0, 60)})`);
    }

    let evm = "";
    try {
      const account = await hre.network.bkc!.address();
      evm = account.evm;
      ok("account", account.bech32);
      ok("", account.evm);
    } catch (error) {
      bad("account", "no usable key", String(error).slice(0, 140));
      return report();
    }

    try {
      const wei = BigInt((await provider.request({ method: "eth_getBalance", params: [evm, "latest"] })) as string);
      if (wei === 0n) {
        bad("balance", "0 BKC", "fund this address before deploying - every write costs gas");
      } else if (wei < BKC) {
        ok("balance", `${wei} wei - enough for a few writes, top it up before a long deployment`);
      } else {
        ok("balance", `${wei / BKC} BKC`);
      }
    } catch {
      bad("balance", "could not be read", "the EVM endpoint answered chainId but not getBalance");
    }

    ok("gas price", bkc.gasPrice ?? "not set - the SDK default applies, which may not match this node");
    report();
  },
);
