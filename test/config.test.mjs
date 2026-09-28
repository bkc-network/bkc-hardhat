/** What the plugin refuses, and what it says when it does. No chain needed. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BkcProvider } from "../dist/provider.js";

const RPC = "http://localhost:8545";

/** Any 32 bytes derive an account. Deliberately not a key anyone would fund. */
const DEMO_SEED = "11".repeat(32);

test("a network without a Cosmos RPC is rejected at construction", () => {
  assert.throws(
    () => new BkcProvider("bkc", RPC, { cosmosRpcUrl: "", seed: "00".repeat(32) }),
    /cosmosRpcUrl/,
  );
});

test("a network with no key says which setting is missing", async () => {
  const provider = new BkcProvider("bkc", RPC, { cosmosRpcUrl: "http://localhost:26657" });
  await assert.rejects(() => provider.request({ method: "eth_accounts" }), /bkc\.seed|bkc\.mnemonic/);
});

test("a seed and a mnemonic together are rejected rather than silently preferred", async () => {
  const provider = new BkcProvider("bkc", RPC, {
    cosmosRpcUrl: "http://localhost:26657",
    seed: "00".repeat(32),
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  });
  await assert.rejects(() => provider.request({ method: "eth_accounts" }), /derive different accounts/);
});

test("a seed that is not 32 bytes of hex is rejected", async () => {
  const provider = new BkcProvider("bkc", RPC, { cosmosRpcUrl: "http://localhost:26657", seed: "deadbeef" });
  await assert.rejects(() => provider.request({ method: "eth_accounts" }), /32 bytes of hex/);
});

test("bkc_ping identifies the plugin without touching the network", async () => {
  const provider = new BkcProvider("bkc", RPC, { cosmosRpcUrl: "http://localhost:26657" });
  assert.equal(await provider.request({ method: "bkc_ping" }), "pong");
});

test("both spellings of the account come from the seed alone, with no node to ask", async () => {
  const provider = new BkcProvider("bkc", RPC, {
    cosmosRpcUrl: "http://127.0.0.1:26657",
    seed: DEMO_SEED,
  });

  const account = await provider.request({ method: "bkc_account" });

  assert.match(account.bech32, /^bkc1[0-9a-z]{38}$/);
  assert.match(account.evm, /^0x[0-9a-fA-F]{40}$/);
  // The EVM address is the account's own twenty bytes, not a hash of a curve point.
  assert.equal(account.evm.length, 42);
});

test("a mnemonic derives an account too", async () => {
  const provider = new BkcProvider("bkc", RPC, {
    cosmosRpcUrl: "http://127.0.0.1:26657",
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  });

  const account = await provider.request({ method: "bkc_account" });
  assert.match(account.bech32, /^bkc1[0-9a-z]{38}$/);
});

test("an unknown method is passed on rather than swallowed", async () => {
  const provider = new BkcProvider("bkc", "http://127.0.0.1:1", {
    cosmosRpcUrl: "http://127.0.0.1:26657",
    seed: DEMO_SEED,
  });

  // Nothing is listening on port 1: the failure has to come from the request, which is how
  // we know the provider forwarded it instead of answering with a default.
  await assert.rejects(() => provider.request({ method: "eth_blockNumber", params: [] }));
});

test("the bech32 prefix is configuration, not a constant in this package", async () => {
  const seed = DEMO_SEED;
  const addressWith = async (bech32Prefix) => {
    const provider = new BkcProvider("net", RPC, { cosmosRpcUrl: "http://127.0.0.1:26657", seed, bech32Prefix });
    return (await provider.request({ method: "bkc_account" })).bech32;
  };

  assert.match(await addressWith(undefined), /^bkc1/);
  assert.match(await addressWith("cosmos"), /^cosmos1/);

  // The same key, so the twenty bytes behind both spellings are the same twenty bytes.
  const evm = async (bech32Prefix) => {
    const provider = new BkcProvider("net", RPC, { cosmosRpcUrl: "http://127.0.0.1:26657", seed, bech32Prefix });
    return (await provider.request({ method: "bkc_account" })).evm;
  };
  assert.equal(await evm(undefined), await evm("cosmos"));
});
