const mongoose = require("mongoose");
const crypto = require("crypto");

const failedConditionSchema = new mongoose.Schema(
  {
    metric: { type: String, default: null },
    status: { type: String, default: null },
    actualValue: { type: mongoose.Schema.Types.Mixed, default: null },
    threshold: { type: mongoose.Schema.Types.Mixed, default: null },
    operator: { type: String, default: null },
  },
  { _id: false },
);

const qualityGateSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true,
    },
    taskId: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    githubRepositoryId: { type: Number, default: null, index: true },
    githubPrId: { type: Number, default: null, index: true },
    // Same value as GitHub head SHA / Sonar revision
    commitSha: { type: String, default: null, index: true },
    revision: { type: String, default: null, index: true },
    sonarProjectKey: { type: String, default: null },
    sonarAnalysisId: { type: String, default: null },
    sonarTaskId: { type: String, default: null },
    status: { type: String, required: true },
    passed: { type: Boolean, required: true },
    failed: { type: Boolean, required: true },
    failedConditions: { type: [failedConditionSchema], default: [] },
    source: {
      type: String,
      enum: ["ci", "webhook", "manual"],
      default: "ci",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("QualityGate", qualityGateSchema);
