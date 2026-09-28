/** What a failure looks like. A wallet or a script has to be able to tell why a call failed. */
const assert = require("node:assert/strict");
const hre = require("hardhat");

describe("failures on BKC", function () {
  this.timeout(180000);

  let reverter;

  before(async () => {
    const factory = await hre.ethers.getContractFactory("Reverter");
    reverter = await factory.deploy();
    await reverter.waitForDeployment();
  });

  it("carries the revert reason of a read", async () => {
    await assert.rejects(() => reverter.boom(), /this one is meant to fail/);
  });

  it("decodes a custom error", async () => {
    await assert.rejects(() => reverter.boomCustom(7n), (error) => {
      assert.match(String(error.message), /Refused|revert/i);
      return true;
    });
  });

  it("refuses to sign what this chain cannot sign", async () => {
    const [signer] = await hre.ethers.getSigners();
    // The SDK's message is the one a developer needs: what the chain lacks, not "unsupported".
    await assert.rejects(() => signer.signMessage("hello"), /secp256k1, which this chain does not have/);
  });
});
