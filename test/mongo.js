const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectMongo, disconnectMongo, mongoose } = require("../src/db/connect");

let memoryServer;

async function setupTestDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  memoryServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memoryServer.getUri();
  return connectMongo(process.env.MONGODB_URI);
}

async function teardownTestDatabase() {
  await disconnectMongo();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = {
  setupTestDatabase,
  teardownTestDatabase,
};
