# @bkc-network-lib/hardhat

Hardhat support for **BKC** — a Cosmos SDK chain whose accounts sign with ML-DSA-65
(FIPS 204) and which runs an EVM over those same accounts.

```bash
npm i -D @bkc-network-lib/hardhat
```

```js
// hardhat.config.js
require("@nomicfoundation/hardhat-ethers");
require("@bkc-network-lib/hardhat");

module.exports = {
  solidity: "0.8.24",
  networks: {
    bkc: {
      url: process.env.BKC_EVM_RPC,          // EVM JSON-RPC, for reads
      chainId: 262144,
      bkc: {
        cosmosRpcUrl: process.env.BKC_COSMOS_RPC,  // where writes are broadcast
        seed: process.env.BKC_SEED,                // 32-byte hex ML-DSA-65 seed
        gasPrice: "5000000bkc",
      },
    },
  },
};
```

Then everything you already know works:

```bash
npx hardhat run scripts/deploy.js --network bkc
npx hardhat test --network bkc
npx hardhat ignition deploy ignition/modules/Storage.js --network bkc
npx hardhat verify --network bkc 0xYourContract
```

Three tasks come with it:

```bash
npx hardhat bkc-new-account              # a development account: a seed and its addresses
npx hardhat bkc-doctor --network bkc     # what is missing, if anything, before deploying
npx hardhat bkc-account --network bkc    # the account in use, its balance and nonce
```

`bkc-doctor` is the one to run first on a new machine:

```
Ready to deploy.

  ok    EVM endpoint           http://<node>:8545 · chain 262144
  ok    Cosmos endpoint        http://<node>:26657 · bkc-testnet
  ok    account                bkc1vda7n49v9zny65fr3gfhjm4m9erpfcm5ds0aej
  ok                           0x637be9d4ac28a64d51238a13796ebb2e4614e374
  ok    balance                5 BKC
  ok    gas price              5000000bkc
```

## Why a plugin is needed at all

BKC has no ECDSA keys. Accounts are lattice keys, so nothing can produce the signature an
Ethereum transaction carries, and the node refuses `eth_sendRawTransaction` outright. Every
tool that deploys a contract — Hardhat, Foundry, Remix — signs locally and sends the raw
transaction, so on this chain every one of them fails at the last step.

A write here is a Cosmos message, `/bkc.bkc.v1.MsgExecuteEvmCall`, signed with ML-DSA-65 and
broadcast through the Cosmos RPC. The chain executes it in the EVM and returns an ordinary
Ethereum hash, receipt and logs — which is why everything *after* the send keeps working:
`tx.wait()`, `queryFilter`, gas figures, explorers.

This plugin puts that translation behind Hardhat's provider. Your scripts stay ordinary:

```js
const factory = await hre.ethers.getContractFactory("Storage");
const storage = await factory.deploy();
await storage.waitForDeployment();
await (await storage.set(42)).wait();
```

## What it does

- **`eth_sendTransaction`** is wrapped in `MsgExecuteEvmCall`, signed and broadcast. The EVM
  transaction hash comes back, so `tx.wait()` resolves against a real receipt.
- **Accounts come from the chain, not from Hardhat.** The network is forced to
  `accounts: "remote"` and `eth_accounts` answers with the ML-DSA-65 account, which is what
  makes `ethers.getSigners()` work. A private key in `networks.<name>.accounts` is ignored,
  with a warning: it cannot sign for this chain.
- **Writes are serialised.** `call_nonce` on that message is the account's Cosmos sequence and
  the handler insists the two match exactly, so two transactions in flight do not merely race —
  one is rejected. `Promise.all([a(), b()])` in a deployment script is queued here rather than
  left to fail.
- **Reads are untouched.** `eth_call`, `eth_getLogs`, receipts and gas estimation go straight
  to the EVM endpoint.
- **`hre.network.bkc.address()`** returns `{ bech32, evm }` for scripts that want to log it.

Contract addresses need no special handling: the chain derives a CREATE address from the
sender and the **EVM** nonce, the way Ethereum does, so the address ethers computes is the
address in the receipt.

## Configuration

| Field | Required | What it is |
|---|---|---|
| `url` | yes | EVM JSON-RPC of the chain (Hardhat's own field) |
| `chainId` | recommended | 262144 on the BKC test network |
| `bkc.cosmosRpcUrl` | yes | Tendermint RPC of the same chain, where writes are broadcast |
| `bkc.seed` | one of | 32-byte ML-DSA-65 seed, hex, `0x` optional |
| `bkc.mnemonic` | one of | BIP-39 phrase; derived with the chain's own HKDF scheme |
| `bkc.hdPath` | no | defaults to `m/44'/118'/0'/0/0` |
| `bkc.bech32Prefix` | no | defaults to `bkc` |
| `bkc.gasPrice` | no | e.g. `5000000bkc`; the node's minimum moves when the chain is rebuilt |
| `bkc.baseGasLimit` | no | Cosmos gas covering the signature itself, before the EVM budget |
| `bkc.explorerUrl` | no | Blockscout instance; setting it is all `hardhat verify` needs |
| `bkc.explorerApiUrl` | no | when the API is not at `<explorerUrl>/api` |

Keep the seed in the environment. A key in a config file is a key in the repository.

### Nothing about the chain is compiled into this package

No endpoint, no chain id, no gas price, no explorer. They are all read from the network's
entry in your own config, so a node that moves, a testnet that resets, or a gas price that
changes is an edit to your `.env` — not a release of this plugin. Point it at a different
network by writing a different network.

What a BKC deployment does need is supplied by `@bkc-network-lib`, which this depends on: the
message type an EVM call travels in, the HKDF salt a mnemonic is derived through, and the
signature scheme itself. Those follow the chain, and a change there arrives as a release of
that library within the `^1` range rather than as a change here.

## Verifying

Set `bkc.explorerUrl` and stock `hardhat verify` works — the plugin registers the chain with
`@nomicfoundation/hardhat-verify` itself, so no `etherscan.customChains` block to copy between
projects:

```js
bkc: {
  cosmosRpcUrl: process.env.BKC_COSMOS_RPC,
  seed: process.env.BKC_SEED,
  explorerUrl: process.env.BKC_EXPLORER,   // e.g. https://explorer.bkc.network
}
```

```bash
npm i -D @nomicfoundation/hardhat-verify
npx hardhat verify --network bkc 0xContract
npx hardhat verify --network bkc 0xContract "constructor" "arguments"
```

Two things Blockscout does that Etherscan does not:

- **It matches by bytecode.** Deploy a contract identical to one already verified and the
  explorer shows the source without you verifying anything; `hardhat verify` then reports
  "already verified" and exits non-zero. That is the explorer being helpful, not a failure.
- **It verifies asynchronously.** The address page can take a few seconds after the command
  returns.

The warning about Etherscan v2 API keys is harmless here: Blockscout ignores the key, and the
plugin supplies a placeholder because hardhat-verify insists on one.

## Limits

- **No local signing.** `eth_sign`, `personal_sign` and `eth_signTypedData_v4` cannot work:
  there is no ECDSA key. Requests for them fail with a message saying so.
- **`eth_sendRawTransaction` is not supported** and never will be on this chain.
- **Hardhat Ignition works**, and the end-to-end tests cover it. Two things to know: on
  Hardhat 2 it has to be the 0.15 line of `@nomicfoundation/hardhat-ignition-ethers` (which
  also pulls in `@nomicfoundation/hardhat-verify`), and blocks here are under a second, so set
  `ignition: { requiredConfirmations: 1 }` rather than waiting out its default of five.
  Ignition also refuses to start while earlier transactions from the same account are still
  settling (`IGN403`) - let a block or two pass after a script that sent some.
- One account per network. Multiple signers would need multiple sequences to track.

## Versions that go together

On the Hardhat 2 line the ecosystem packages have released majors that require Hardhat 3, and
npm resolves to those by default. A fresh project needs:

```bash
npm i -D hardhat@^2.26.0 "@nomicfoundation/hardhat-ethers@^3.0.8" ethers@^6
npm i -D "@nomicfoundation/hardhat-ignition-ethers@^0.15.0"   # only if you use Ignition
```

`scripts/consumer-check.sh` packs this package, installs it into a throwaway project with
those versions, and deploys a contract with it - which is the only way to catch a broken
entry point or a missing dependency, since inside this repository the local source always
wins.

## TypeScript

`hardhat.config.ts` works and the network's `bkc` block is typed. Hardhat 2 loads it through
`ts-node`, which needs TypeScript 5 - on TypeScript 6 or newer it fails while reading the
config, before this plugin is involved.

## Development

```bash
npm install
npm run build
npm test
```

`npm test` runs the whole suite. The tests that need a chain skip themselves unless it is
configured, so a checkout with nothing to talk to still covers the configuration and error
paths. To run the rest, export these before `npm test`:

| Variable | |
|---|---|
| `BKC_SEED` | 32-byte hex seed of a funded account |
| `BKC_EVM_RPC` | EVM JSON-RPC: reads and gas estimation |
| `BKC_COSMOS_RPC` | Tendermint RPC: where writes are broadcast |
| `BKC_EXPLORER` | optional; enables the verification test |
| `BKC_MNEMONIC` | optional; enables the test that a phrase and the seed derived from it reach the same account |

These belong to this repository's tests. **The published package reads no environment
variable at all** — every value it uses comes from the network's entry in your Hardhat
config, whether you write it as a literal or read it from somewhere yourself.

The `example/` project is not a fixture: it is the project the end-to-end tests drive, so
anything that works there works for a user who copies it.

## Licence

MIT.
