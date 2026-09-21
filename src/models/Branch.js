const mongoose = require("mongoose");
const crypto = require("crypto");

const branchSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true,
    },
    taskId: { type: String, required: true, index: true },
    githubRepositoryId: { type: Number, required: true, index: true },
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    branchName: { type: String, required: true, index: true },
    baseSha: { type: String, default: null },
    // Latest commit SHA from PR opened / synchronize (matches Sonar revision)
    headSha: { type: String, default: null, index: true },
    latestQualityGateStatus: {
      type: String,
      enum: ["OK", "ERROR", "NONE"],
      default: "NONE",
    },
    latestQualityGatePassed: { type: Boolean, default: null },
    latestQualityGateAt: { type: Date, default: null },
  },
  { timestamps: true },
);

branchSchema.index(
  { githubRepositoryId: 1, branchName: 1 },
  { unique: true },
);

module.exports = mongoose.model("Branch", branchSchema);
