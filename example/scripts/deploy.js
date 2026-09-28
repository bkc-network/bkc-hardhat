/** Deploy, write, read - the script a developer already knows how to write. */
const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log(`deployer      ${await signer.getAddress()}`);

  const storage = await (await hre.ethers.getContractFactory("Storage")).deploy();
  await storage.waitForDeployment();
  const address = await storage.getAddress();
  console.log(`deployed      ${address}`);

  const code = await hre.ethers.provider.getCode(address);
  console.log(`runtime code  ${(code.length - 2) / 2} bytes`);

  const receipt = await (await storage.set(42n)).wait();
  console.log(`set(42)       ${receipt.hash} status=${receipt.status} gas=${receipt.gasUsed}`);

  const stored = await storage.get();
  console.log(`get()         ${stored}`);

  const events = await storage.queryFilter(storage.filters.Stored(), receipt.blockNumber, receipt.blockNumber);
  console.log(`Stored event  ${events.length} log(s), value ${events[0]?.args?.[0]}`);

  if (stored !== 42n) throw new Error(`expected 42, read ${stored}`);
  console.log("OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
