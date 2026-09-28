const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("StorageModule", (m) => {
  const storage = m.contract("Storage");
  m.call(storage, "set", [42n]);
  return { storage };
});
