const mongoose = require("mongoose");
const crypto = require("crypto");

const pullRequestSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true,
    },
    githubRepositoryId: { type: Number, required: true, index: true },
    githubPrId: { type: Number, required: true, index: true },
    githubPrNumber: { type: Number, required: true },
    taskId: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    branchName: { type: String, required: true },
    headSha: { type: String, default: null, index: true },
    prUrl: { type: String, default: null },
  },
  { timestamps: true },
);

pullRequestSchema.index(
  { githubRepositoryId: 1, githubPrId: 1 },
  { unique: true },
);

module.exports = mongoose.model("PullRequest", pullRequestSchema);
