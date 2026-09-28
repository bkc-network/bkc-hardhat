/** Deploys a contract whose bytecode differs per run, for the verification test. */
const hre = require("hardhat");

async function main() {
  const tag = process.env.TAG;
  if (!tag) throw new Error("set TAG=0x<32 bytes>");

  const tagged = await (await hre.ethers.getContractFactory("Tagged")).deploy(tag);
  await tagged.waitForDeployment();

  console.log(`Tagged        ${await tagged.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
