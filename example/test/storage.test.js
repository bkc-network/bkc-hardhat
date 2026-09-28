/** `hardhat test --network bkcTestnet` - the same test file a normal EVM project would have. */
const assert = require("node:assert/strict");
const hre = require("hardhat");

describe("Storage on BKC", function () {
  this.timeout(180000);

  let storage;

  before(async () => {
    const factory = await hre.ethers.getContractFactory("Storage");
    storage = await factory.deploy();
    await storage.waitForDeployment();
  });

  it("deploys with runtime code on chain", async () => {
    const code = await hre.ethers.provider.getCode(await storage.getAddress());
    assert.ok(code.length > 2, "deployed contract has no runtime code");
  });

  it("stores a value and reads it back", async () => {
    await (await storage.set(7n)).wait();
    assert.equal(await storage.get(), 7n);
  });

  it("emits the event the write produced", async () => {
    const receipt = await (await storage.set(9n)).wait();
    const logs = await storage.queryFilter(storage.filters.Stored(), receipt.blockNumber, receipt.blockNumber);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].args[0], 9n);
  });

  it("serialises writes that a script fires at once", async () => {
    // The Cosmos sequence is the EVM call nonce here, so two writes in flight would collide.
    // The plugin queues them; a script written the obvious way should still work.
    const results = await Promise.all([storage.set(11n), storage.set(12n)]);
    const receipts = await Promise.all(results.map((tx) => tx.wait()));

    assert.equal(receipts.filter((r) => r.status === 1).length, 2, "both writes should land");
    assert.ok([11n, 12n].includes(await storage.get()));
  });
});
