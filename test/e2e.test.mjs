/**
 * The plugin driven the way a developer drives it, on a live chain, from the example project.
 * Skips itself when the chain settings are absent.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), "..", "example");

const env = {
  ...process.env,
  BKC_EVM_RPC: process.env.BKC_EVM_RPC ?? "",
  BKC_COSMOS_RPC: process.env.BKC_COSMOS_RPC ?? "",
  BKC_SEED: process.env.BKC_SEED ?? "",
  BKC_MNEMONIC: process.env.BKC_MNEMONIC ?? "",
  BKC_EXPLORER: process.env.BKC_EXPLORER ?? "",
};

const configured = Boolean(env.BKC_EVM_RPC && env.BKC_COSMOS_RPC && env.BKC_SEED);

const rpc = async (method, params = []) => {
  const response = await fetch(env.BKC_EVM_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()).result;
};

/** Waits for the chain to move on by `count` blocks. */
async function waitForBlocks(count) {
  const start = Number(await rpc("eth_blockNumber"));
  for (let i = 0; i < 60; i += 1) {
    if (Number(await rpc("eth_blockNumber")) >= start + count) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const hardhat = (args, extraEnv = {}) =>
  run("npx", ["hardhat", ...args], { cwd: EXAMPLE, env: { ...env, ...extraEnv }, timeout: 600000 });

// bkc-doctor exits non-zero when it finds a problem, and execFile rejects on that - but the
// report it printed is the thing under test, so tests read stdout off either outcome.

/** Ignition asks before it deploys to a network it does not recognise as a dev one. */
const hardhatConfirmed = (command) =>
  run("bash", ["-c", `printf 'y\n' | npx hardhat ${command}`], { cwd: EXAMPLE, env, timeout: 900000 });

test("hardhat run deploys, writes and reads back", { skip: !configured && "set BKC_EVM_RPC, BKC_COSMOS_RPC and BKC_SEED" }, async () => {
  const { stdout } = await hardhat(["run", "scripts/deploy.js", "--network", "bkcTestnet"]);

  assert.match(stdout, /deployed {6}0x[0-9a-fA-F]{40}/, "no contract address in the output");
  assert.match(stdout, /get\(\) {9}42/, "the value read back was not the one written");
  assert.match(stdout, /Stored event {2}1 log/, "the event the write emitted did not come back");
  assert.match(stdout, /\nOK\n?$/, "the script did not finish");
});

test("hardhat test runs a normal test file against the chain", { skip: !configured && "chain settings absent" }, async () => {
  const { stdout } = await hardhat(["test", "--network", "bkcTestnet"]);
  assert.match(stdout, /7 passing/, stdout.slice(-400));
});

test("bkc-account reports both spellings of one account", { skip: !configured && "chain settings absent" }, async () => {
  const { stdout } = await hardhat(["bkc-account", "--network", "bkcTestnet"]);

  assert.match(stdout, /account {3}bkc1[0-9a-z]{38}/, "no bech32 address");
  assert.match(stdout, /0x[0-9a-fA-F]{40}/, "no EVM address");
  assert.match(stdout, /balance {3}[\d.]+ BKC/, "no balance");
});

test(
  "a mnemonic reaches the same account as the seed derived from it",
  { skip: !(configured && env.BKC_MNEMONIC) && "set BKC_MNEMONIC too" },
  async () => {
    const [fromSeed, fromMnemonic] = await Promise.all([
      hardhat(["bkc-account", "--network", "bkcTestnet"]),
      hardhat(["bkc-account", "--network", "bkcTestnetMnemonic"]),
    ]);

    const account = (out) => out.stdout.match(/account {3}(bkc1[0-9a-z]+)/)?.[1];
    assert.ok(account(fromSeed), "no account from the seed network");
    assert.equal(account(fromMnemonic), account(fromSeed));
  },
);

test(
  "hardhat ignition deploys a module and runs its calls",
  { skip: !configured && "chain settings absent" },
  async () => {
    // Ignition refuses to start while transactions from the same account are still settling,
    // and the tests above have just sent several. Let the chain get ahead of them.
    await waitForBlocks(2);

    const id = `e2e-${process.pid}`;
    const { stdout } = await hardhatConfirmed(
      // a fresh id each run, so nothing has to be reset - and resetting asks a second question
      `ignition deploy ignition/modules/Storage.js --network bkcTestnet --deployment-id ${id}`,
    );

    assert.match(stdout, /successfully deployed/, stdout.slice(-400));
    const address = stdout.match(/StorageModule#Storage - (0x[0-9a-fA-F]{40})/)?.[1];
    assert.ok(address, "no deployed address in the Ignition output");

    // the module's m.call(set, 42) has to have landed, not just the deployment
    const response = await fetch(env.BKC_EVM_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: address, data: "0x6d4ce63c" }, "latest"],
      }),
    });
    const { result } = await response.json();
    assert.equal(BigInt(result), 42n);
  },
);

test(
  "hardhat verify publishes the source to the explorer",
  { skip: !(configured && env.BKC_EXPLORER) && "set BKC_EXPLORER to a Blockscout instance" },
  async () => {
    // A fresh tag per run: the immutable lands in the runtime bytecode, so the explorer
    // cannot satisfy this by matching a contract verified earlier.
    const tag = `0x${Date.now().toString(16).padStart(64, "0")}`;
    const deploy = await hardhat(["run", "scripts/deploy-tagged.js", "--network", "bkcTestnet"], { TAG: tag });
    const address = deploy.stdout.match(/Tagged {8}(0x[0-9a-fA-F]{40})/)?.[1];
    assert.ok(address, `no address in: ${deploy.stdout.slice(-200)}`);

    await waitForBlocks(2);

    const output = await hardhat(["verify", "--network", "bkcTestnet", address, tag]).then(
      (result) => result.stdout,
      (error) => `${error.stdout ?? ""}${error.message ?? ""}`,
    );
    assert.match(output, /Successfully verified|already been verified/i, output.slice(-400));

    // Confirm from the explorer, not from the CLI's own report. It indexes and matches
    // asynchronously, so a contract deployed seconds ago is not there the instant
    // hardhat-verify returns.
    const base = env.BKC_EXPLORER.replace(/\/$/, "");
    let contract = {};
    for (let i = 0; i < 30 && !contract.is_verified; i += 1) {
      contract = await fetch(`${base}/api/v2/smart-contracts/${address}`).then(
        (response) => response.json(),
        () => ({}),
      );
      if (!contract.is_verified) await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    assert.equal(contract.is_verified, true, `explorer reports: ${JSON.stringify(contract).slice(0, 200)}`);
    assert.equal(contract.name, "Tagged");
    assert.ok((contract.abi ?? []).length > 0, "a verified contract should expose an ABI");
  },
);

test("bkc-new-account works with no network configured at all", { skip: !configured && "needs the example project's dependencies" }, async () => {
  const { stdout } = await hardhat(["bkc-new-account"]);

  const seed = stdout.match(/seed {5}([0-9a-f]{64})/)?.[1];
  assert.ok(seed, `no seed in: ${stdout}`);
  assert.match(stdout, /account {2}bkc1[0-9a-z]{38}/);
  assert.match(stdout, /0x[0-9a-fA-F]{40}/);
});

test("bkc-doctor names the missing key", { skip: !configured && "chain settings absent" }, async () => {
  const { stdout } = await hardhat(["bkc-doctor", "--network", "bkcTestnet"], { BKC_SEED: "" }).catch((error) => error);

  assert.match(stdout, /FAIL {2}account/);
  assert.match(stdout, /has no signing key/);
});

test("bkc-doctor names an account with no gas", { skip: !configured && "chain settings absent" }, async () => {
  // A key nothing has ever funded: 32 bytes that are not going to collide with an account.
  const unfunded = "ab".repeat(32);
  const { stdout } = await hardhat(["bkc-doctor", "--network", "bkcTestnet"], { BKC_SEED: unfunded }).catch((error) => error);

  assert.match(stdout, /ok {4}EVM endpoint/);
  assert.match(stdout, /FAIL {2}balance\s+0 BKC/);
  assert.match(stdout, /fund this address/);
});

test("bkc-doctor catches a chain id that does not match the node", { skip: !configured && "chain settings absent" }, async () => {
  const { stdout } = await hardhat(["bkc-doctor", "--network", "bkcTestnet"], { BKC_EVM_CHAIN_ID: "999" }).catch((error) => error);

  assert.match(stdout, /FAIL {2}EVM endpoint/);
  assert.match(stdout, /is not chain 999|reports chain/);
});

test("bkc-doctor passes on a funded account", { skip: !configured && "chain settings absent" }, async () => {
  const { stdout } = await hardhat(["bkc-doctor", "--network", "bkcTestnet"]);

  assert.match(stdout, /Ready to deploy/);
  assert.doesNotMatch(stdout, /FAIL/);
});

test("the explorer is registered with hardhat-verify", { skip: !(configured && env.BKC_EXPLORER) && "set BKC_EXPLORER" }, async () => {
  const { stdout } = await hardhat(["verify", "--list-networks"]);

  assert.match(stdout, /bkcTestnet/);
  assert.match(stdout, /262144/);
});
