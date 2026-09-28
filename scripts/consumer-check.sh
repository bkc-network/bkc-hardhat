#!/usr/bin/env bash
# Packs the plugin and drives it from a project that has never seen this repository.
#
# Inside the workspace the local source always wins, so a broken "files" list, a missing
# dependency or a wrong entry point stays invisible until someone installs the package. This
# installs the tarball into a throwaway project and deploys a contract with it.
#
#   BKC_EVM_RPC=… BKC_COSMOS_RPC=… BKC_SEED=… ./scripts/consumer-check.sh
set -euo pipefail

: "${BKC_EVM_RPC:?set BKC_EVM_RPC}"
: "${BKC_COSMOS_RPC:?set BKC_COSMOS_RPC}"
: "${BKC_SEED:?set BKC_SEED}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

npm --prefix "$here" run build >/dev/null
tarball="$(cd "$here" && npm pack --silent | tail -1)"

mkdir -p "$work/contracts" "$work/scripts"
cd "$work"
echo '{ "name": "consumer", "private": true, "version": "1.0.0" }' > package.json

# hardhat-ethers 4 wants Hardhat 3; on the Hardhat 2 line it has to be the 3.x release
npm install --silent hardhat@^2.26.0 "@nomicfoundation/hardhat-ethers@^3.0.8" ethers@^6 "$here/$tarball"

cat > hardhat.config.js <<'CONFIG'
require("@nomicfoundation/hardhat-ethers");
require("@bkc-network-lib/hardhat");

module.exports = {
  solidity: "0.8.24",
  networks: {
    bkc: {
      url: process.env.BKC_EVM_RPC,
      chainId: Number(process.env.BKC_EVM_CHAIN_ID ?? 262144),
      bkc: { cosmosRpcUrl: process.env.BKC_COSMOS_RPC, seed: process.env.BKC_SEED, gasPrice: "5000000bkc" },
    },
  },
};
CONFIG

cat > contracts/Hello.sol <<'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Hello {
    string public greeting = "hello from a fresh install";

    function setGreeting(string calldata value) external { greeting = value; }
}
SOL

cat > scripts/go.js <<'SCRIPT'
const hre = require("hardhat");
const assert = require("node:assert/strict");

async function main() {
  const factory = await hre.ethers.getContractFactory("Hello");
  const hello = await factory.deploy();
  await hello.waitForDeployment();

  assert.equal(await hello.greeting(), "hello from a fresh install");
  await (await hello.setGreeting("changed")).wait();
  assert.equal(await hello.greeting(), "changed");

  console.log(`consumer check OK - deployed ${await hello.getAddress()}, wrote to it, read it back`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
SCRIPT

npx hardhat run scripts/go.js --network bkc
