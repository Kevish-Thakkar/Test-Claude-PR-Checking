const express = require("express");
const crypto = require("crypto");

const app = express();

const PORT = 3000;

// Use the same secret configured in:
// GitHub -> Settings -> Webhooks -> Secret
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// IMPORTANT:
// Keep the raw request body for GitHub signature verification.
app.post(
  "/webhooks/github",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];
    const signature = req.headers["x-hub-signature-256"];

    console.log("\n=================================");
    console.log("GitHub Webhook Received");
    console.log("=================================");

    console.log("Event:", event);
    console.log("Delivery ID:", deliveryId);

    // Verify GitHub signature
    if (!verifySignature(req.body, signature)) {
      console.log("❌ Invalid GitHub signature");

      return res.status(401).json({
        success: false,
        message: "Invalid signature",
      });
    }

    console.log("✅ Signature verified");

    let payload;

    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid JSON payload",
      });
    }

    // Handle Claude's PR review
    if (event === "pull_request_review") {
      handlePullRequestReview(payload);
    }

    // Handle Claude's inline review comments
    else if (event === "pull_request_review_comment") {
      handleReviewComment(payload);
    }

    // Handle normal PR conversation comments
    else if (event === "issue_comment") {
      handleIssueComment(payload);
    } else {
      console.log("Ignoring event:", event);
    }

    // Respond quickly to GitHub
    return res.status(200).json({
      success: true,
      received: true,
    });
  },
);

// ============================================
// Verify GitHub webhook signature
// ============================================

function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET) {
    console.error("❌ GITHUB_WEBHOOK_SECRET is not configured");
    return false;
  }

  if (!signature) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

// ============================================
// PR Review
// ============================================

function handlePullRequestReview(payload) {
  const action = payload.action;
  const review = payload.review;
  const pullRequest = payload.pull_request;
  const repository = payload.repository;

  console.log("\n========== PR REVIEW ==========");

  console.log("Action:", action);

  console.log("Repository:", repository.full_name);

  console.log("PR Number:", pullRequest.number);

  console.log("PR Title:", pullRequest.title);

  console.log("Reviewer:", review.user?.login);

  console.log("Review ID:", review.id);

  console.log("Review State:", review.state);

  console.log("Review Body:");
  console.log(review.body);

  console.log("===============================");

  /*
    Here you would save to your database.

    Example:

    await db.aiReviews.create({
      repository: repository.full_name,
      pullRequestNumber: pullRequest.number,
      githubReviewId: review.id,
      reviewer: review.user?.login,
      state: review.state,
      body: review.body,
    });
  */
}

// ============================================
// Inline PR Review Comment
// ============================================

function handleReviewComment(payload) {
  const action = payload.action;
  const comment = payload.comment;
  const pullRequest = payload.pull_request;
  const repository = payload.repository;

  console.log("\n======= REVIEW COMMENT =======");

  console.log("Action:", action);

  console.log("Repository:", repository.full_name);

  console.log("PR Number:", pullRequest.number);

  console.log("Comment ID:", comment.id);

  console.log("Author:", comment.user?.login);

  console.log("File:", comment.path);

  console.log("Line:", comment.line);

  console.log("Body:");
  console.log(comment.body);

  console.log("==============================");

  /*
    Save individual finding to DB.

    Example:

    await db.aiReviewFindings.create({
      githubCommentId: comment.id,
      pullRequestNumber: pullRequest.number,
      filePath: comment.path,
      line: comment.line,
      body: comment.body,
    });
  */
}

// ============================================
// Normal PR conversation comment
// ============================================

function handleIssueComment(payload) {
  const action = payload.action;
  const comment = payload.comment;
  const issue = payload.issue;
  const repository = payload.repository;

  // issue_comment can be for issues AND PRs.
  // Pull requests have pull_request inside the issue payload.
  if (!issue.pull_request) {
    return;
  }

  console.log("\n======= PR COMMENT =======");

  console.log("Action:", action);

  console.log("Repository:", repository.full_name);

  console.log("PR Number:", issue.number);

  console.log("Comment ID:", comment.id);

  console.log("Author:", comment.user?.login);

  console.log("Body:");
  console.log(comment.body);

  console.log("==========================");
}

// ============================================
// Health check
// ============================================

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "GitHub Webhook Server",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
