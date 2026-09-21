const mongoose = require("mongoose");

let connectingPromise = null;

async function connectMongo(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = mongoose
    .connect(uri)
    .then((connection) => {
      console.log("✅ Connected to MongoDB");
      return connection;
    })
    .finally(() => {
      connectingPromise = null;
    });

  return connectingPromise;
}

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  connectMongo,
  disconnectMongo,
  mongoose,
};
