# Changelog

## 1.0.0

First release.

- `eth_sendTransaction` is wrapped in `/bkc.bkc.v1.MsgExecuteEvmCall`, signed with ML-DSA-65
  and broadcast through the Cosmos RPC, so `hardhat run`, `hardhat test` and Hardhat Ignition
  work against a chain with no ECDSA keys.
- Accounts come from the chain: the network is forced to `accounts: "remote"` so
  `ethers.getSigners()` sees the ML-DSA-65 account.
- Writes are serialised, because `call_nonce` is the account's Cosmos sequence and two in
  flight means one rejected.
- `hardhat verify` works from a single `bkc.explorerUrl`.
- Tasks: `bkc-doctor`, `bkc-account`, `bkc-new-account`.
- Nothing about the chain is compiled in: endpoints, chain id, gas price, HD path, bech32
  prefix and explorer all come from the network's config.
