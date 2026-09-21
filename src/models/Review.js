const mongoose = require("mongoose");
const crypto = require("crypto");

const reviewSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true,
    },
    taskId: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    githubRepositoryId: { type: Number, required: true },
    githubPrId: { type: Number, required: true, index: true },
    githubPrNumber: { type: Number, required: true },
    githubReviewId: { type: Number, required: true, unique: true },
    reviewer: { type: String, default: null },
    reviewState: { type: String, default: null },
    reviewBody: { type: String, default: null },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Review", reviewSchema);
