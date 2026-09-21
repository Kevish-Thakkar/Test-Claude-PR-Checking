const mongoose = require("mongoose");
const crypto = require("crypto");

const commentSchema = new mongoose.Schema(
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
    githubCommentId: { type: Number, required: true, unique: true },
    author: { type: String, default: null },
    filePath: { type: String, default: null },
    line: { type: Number, default: null },
    body: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Comment", commentSchema);
