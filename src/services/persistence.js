const {
  Branch,
  PullRequest,
  Comment,
  Review,
  QualityGate,
  WebhookEvent,
} = require("../models");

async function resetStores() {
  await Promise.all([
    Branch.deleteMany({}),
    PullRequest.deleteMany({}),
    Comment.deleteMany({}),
    Review.deleteMany({}),
    QualityGate.deleteMany({}),
    WebhookEvent.deleteMany({}),
  ]);
}

async function logWebhookEvent({ source, eventType, deliveryId, payload }) {
  return WebhookEvent.create({
    source,
    eventType: eventType || null,
    deliveryId: deliveryId || null,
    payload,
    processed: false,
  });
}

async function markWebhookProcessed(eventId, error = null) {
  return WebhookEvent.findOneAndUpdate(
    { id: eventId },
    {
      processed: !error,
      processingError: error,
    },
    { returnDocument: "after" },
  );
}

/**
 * Resolve a branch for a quality gate result.
 *
 * Correlation order:
 * 1. GitHub PR ID → PullRequest → Branch
 * 2. commitSha/revision → Branch.headSha (PR opened/synchronize SHA matches Sonar revision)
 */
async function resolveBranchForQualityGate({
  githubRepositoryId,
  githubPrId,
  commitSha,
  revision,
}) {
  const sha = commitSha || revision || null;

  if (githubRepositoryId && githubPrId) {
    const pr = await PullRequest.findOne({
      githubRepositoryId,
      githubPrId,
    }).lean();

    if (pr) {
      const branch = await Branch.findOne({ id: pr.branchId });
      if (branch) {
        return { branch, pr, matchedBy: "pull_request" };
      }
    }
  }

  if (sha) {
    const query = { headSha: sha };
    if (githubRepositoryId) {
      query.githubRepositoryId = githubRepositoryId;
    }

    const branch = await Branch.findOne(query);

    if (branch) {
      const prQuery = {
        branchId: branch.id,
        headSha: sha,
      };
      if (githubRepositoryId) {
        prQuery.githubRepositoryId = githubRepositoryId;
      }

      const pr = await PullRequest.findOne(prQuery).lean();

      return { branch, pr: pr || null, matchedBy: "commit_sha" };
    }
  }

  return { branch: null, pr: null, matchedBy: null };
}

async function applyQualityGateToBranch(branch, report) {
  branch.latestQualityGateStatus = report.status === "OK" ? "OK" : "ERROR";
  branch.latestQualityGatePassed = report.passed;
  branch.latestQualityGateAt = new Date();

  if (report.commitSha || report.revision) {
    branch.headSha = report.commitSha || report.revision;
  }

  await branch.save();
  return branch;
}

module.exports = {
  resetStores,
  logWebhookEvent,
  markWebhookProcessed,
  resolveBranchForQualityGate,
  applyQualityGateToBranch,
};
