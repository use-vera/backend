const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

let replSet = null;

/**
 * A single-node replica set (not a standalone server) is required here —
 * mongoose.startSession()+withTransaction() throws against a standalone
 * mongod, and the wallet ledger relies on transactions for correctness.
 */
const startTestDb = async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  const uri = replSet.getUri();
  await mongoose.connect(uri);
};

const stopTestDb = async () => {
  await mongoose.disconnect();

  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
};

const clearTestDb = async () => {
  const { collections } = mongoose.connection;

  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
};

module.exports = { startTestDb, stopTestDb, clearTestDb };
