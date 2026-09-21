// require("dotenv").config();

// const express = require("express");
// const crypto = require("crypto");

// const app = express();

// /*
// |--------------------------------------------------------------------------
// | Configuration
// |--------------------------------------------------------------------------
// */

// const PORT = process.env.PORT || 3000;

// const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// const SONAR_URL = process.env.SONAR_URL || "http://localhost:9000";
// const SONAR_TOKEN = process.env.SONAR_TOKEN;

// /*
// |--------------------------------------------------------------------------
// | Temporary in-memory storage
// |--------------------------------------------------------------------------
// |
// | Replace these with PostgreSQL tables in Nexus.
// |
// */

// const nexusBranches = [];

// const githubPullRequests = [];

// const claudeComments = [];

// const claudeReviews = [];

// const sonarReports = [];

// /*
// |--------------------------------------------------------------------------
// | Helpers
// |--------------------------------------------------------------------------
// */

// function generateId() {
//   return crypto.randomUUID();
// }

// /*
// |--------------------------------------------------------------------------
// | GitHub Signature Verification
// |--------------------------------------------------------------------------
// */

// function verifyGitHubSignature(payload, signature) {
//   if (!GITHUB_WEBHOOK_SECRET) {
//     console.log("❌ GITHUB_WEBHOOK_SECRET is not configured");
//     return false;
//   }

//   if (!signature) {
//     console.log("❌ X-Hub-Signature-256 missing");
//     return false;
//   }

//   const expectedSignature =
//     "sha256=" +
//     crypto
//       .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
//       .update(payload)
//       .digest("hex");

//   if (signature.length !== expectedSignature.length) {
//     return false;
//   }

//   return crypto.timingSafeEqual(
//     Buffer.from(signature),
//     Buffer.from(expectedSignature),
//   );
// }

// /*
// |--------------------------------------------------------------------------
// | SonarQube API
// |--------------------------------------------------------------------------
// */

// /**
//  * Get the Quality Gate result from SonarQube.
//  *
//  * API:
//  *
//  * GET /api/qualitygates/project_status?projectKey=...
//  */
// async function getSonarQualityGate(projectKey) {
//   if (!SONAR_URL) {
//     throw new Error("SONAR_URL is not configured");
//   }

//   if (!SONAR_TOKEN) {
//     throw new Error("SONAR_TOKEN is not configured");
//   }

//   const url =
//     `${SONAR_URL}/api/qualitygates/project_status` +
//     `?projectKey=${encodeURIComponent(projectKey)}`;

//   const auth = Buffer.from(`${SONAR_TOKEN}:`).toString("base64");

//   const response = await fetch(url, {
//     method: "GET",

//     headers: {
//       Authorization: `Basic ${auth}`,
//       Accept: "application/json",
//     },
//   });

//   if (!response.ok) {
//     const body = await response.text();

//     throw new Error(`SonarQube API failed: ${response.status} ${body}`);
//   }

//   return response.json();
// }

// /*
// |--------------------------------------------------------------------------
// | Extract SonarQube Failed Conditions
// |--------------------------------------------------------------------------
// */

// function extractFailedSonarConditions(projectStatus) {
//   const conditions = projectStatus?.conditions || [];

//   return conditions
//     .filter((condition) => condition.status === "ERROR")
//     .map((condition) => ({
//       metric: condition.metricKey,

//       actualValue: condition.actualValue ?? null,

//       threshold: condition.errorThreshold ?? null,

//       operator: condition.comparator ?? condition.operator ?? null,

//       status: condition.status,
//     }));
// }

// /*
// |--------------------------------------------------------------------------
// | SonarQube Webhook
// |--------------------------------------------------------------------------
// |
// | IMPORTANT:
// |
// | This route uses express.json().
// |
// | We intentionally DO NOT use express.json()
// | globally because GitHub needs the original
// | raw request body for HMAC signature verification.
// |
// */

// app.post(
//   "/webhooks/sonarqube",

//   express.json(),

//   async (req, res) => {
//     console.log("\n=================================");
//     console.log("SonarQube Webhook Received");
//     console.log("=================================");

//     try {
//       const payload = req.body;

//       console.log("\n========== RAW SONAR PAYLOAD ==========");

//       console.log(JSON.stringify(payload, null, 2));

//       /*
//       |--------------------------------------------------------------------------
//       | Basic validation
//       |--------------------------------------------------------------------------
//       */

//       if (!payload || typeof payload !== "object") {
//         return res.status(400).json({
//           success: false,
//           message: "SonarQube webhook body is missing",
//         });
//       }

//       const projectKey = payload.project?.key;

//       const projectName = payload.project?.name;

//       const analysisId = payload.analysisId;

//       const webhookStatus = payload.status;

//       const qualityGateStatus = payload.qualityGate?.status;

//       /*
//       |--------------------------------------------------------------------------
//       | Validate project
//       |--------------------------------------------------------------------------
//       */

//       if (!projectKey) {
//         console.log("❌ Project key missing from SonarQube webhook");

//         return res.status(400).json({
//           success: false,
//           message: "Project key missing",
//         });
//       }

//       console.log("\n========== SONAR ANALYSIS ==========");

//       console.log("Project Key:", projectKey);

//       console.log("Project Name:", projectName);

//       console.log("Analysis ID:", analysisId);

//       console.log("Webhook Status:", webhookStatus);

//       console.log("Webhook Quality Gate:", qualityGateStatus);

//       /*
//       |--------------------------------------------------------------------------
//       | Get detailed Quality Gate information
//       |--------------------------------------------------------------------------
//       */

//       console.log("\nFetching detailed Quality Gate from SonarQube...");

//       const sonarResult = await getSonarQualityGate(projectKey);

//       const projectStatus = sonarResult.projectStatus;

//       console.log("\n========== QUALITY GATE ==========");

//       console.log("Status:", projectStatus?.status);

//       /*
//       |--------------------------------------------------------------------------
//       | Extract all conditions
//       |--------------------------------------------------------------------------
//       */

//       const allConditions = projectStatus?.conditions || [];

//       console.log("\n========== ALL CONDITIONS ==========");

//       console.table(allConditions);

//       /*
//       |--------------------------------------------------------------------------
//       | Extract failed conditions
//       |--------------------------------------------------------------------------
//       */

//       const failedConditions = extractFailedSonarConditions(projectStatus);

//       console.log("\n========== FAILED CONDITIONS ==========");

//       if (failedConditions.length === 0) {
//         console.log("✅ No failed conditions");
//       } else {
//         console.table(failedConditions);
//       }

//       /*
//       |--------------------------------------------------------------------------
//       | Build Nexus Quality Gate Report
//       |--------------------------------------------------------------------------
//       */

//       const sonarReport = {
//         id: generateId(),

//         projectKey,

//         projectName,

//         analysisId,

//         qualityGateStatus: projectStatus?.status || null,

//         conditions: allConditions.map((condition) => ({
//           metric: condition.metricKey,

//           status: condition.status,

//           actualValue: condition.actualValue ?? null,

//           threshold: condition.errorThreshold ?? null,

//           operator: condition.comparator ?? condition.operator ?? null,
//         })),

//         failedConditions,

//         createdAt: new Date().toISOString(),
//       };

//       /*
//       |--------------------------------------------------------------------------
//       | Store temporarily
//       |--------------------------------------------------------------------------
//       */

//       sonarReports.push(sonarReport);

//       /*
//       |--------------------------------------------------------------------------
//       | This is what Nexus would receive
//       |--------------------------------------------------------------------------
//       */

//       const nexusPayload = {
//         source: "sonarqube",

//         projectKey,

//         projectName,

//         analysisId,

//         qualityGate: {
//           status: sonarReport.qualityGateStatus,

//           passed: sonarReport.qualityGateStatus === "OK",

//           failed: sonarReport.qualityGateStatus !== "OK",

//           failedConditions,
//         },

//         createdAt: sonarReport.createdAt,
//       };

//       console.log("\n========== NEXUS PAYLOAD ==========");

//       console.log(JSON.stringify(nexusPayload, null, 2));

//       /*
//       |--------------------------------------------------------------------------
//       | Respond to SonarQube
//       |--------------------------------------------------------------------------
//       */

//       return res.status(200).json({
//         success: true,

//         projectKey,

//         qualityGate: {
//           status: sonarReport.qualityGateStatus,

//           failedConditions,
//         },
//       });
//     } catch (error) {
//       console.error("\n❌ SonarQube webhook processing failed:");

//       console.error(error);

//       return res.status(500).json({
//         success: false,

//         message: error.message,
//       });
//     }
//   },
// );

// /*
// |--------------------------------------------------------------------------
// | GitHub Webhook
// |--------------------------------------------------------------------------
// |
// | DO NOT put express.json() before this route.
// |
// | GitHub signature verification requires
// | the original raw request body.
// |
// */

// app.post(
//   "/webhooks/github",

//   express.raw({
//     type: "application/json",
//   }),

//   (req, res) => {
//     console.log("\n=================================");
//     console.log("GitHub Webhook Received");
//     console.log("=================================");

//     const event = req.headers["x-github-event"];

//     const deliveryId = req.headers["x-github-delivery"];

//     const signature = req.headers["x-hub-signature-256"];

//     console.log("Event:", event);

//     console.log("Delivery ID:", deliveryId);

//     /*
//     |--------------------------------------------------------------------------
//     | Verify GitHub Signature
//     |--------------------------------------------------------------------------
//     */

//     if (!verifyGitHubSignature(req.body, signature)) {
//       console.log("❌ Invalid GitHub signature");

//       return res.status(401).json({
//         success: false,
//         message: "Invalid signature",
//       });
//     }

//     console.log("✅ GitHub signature verified");

//     /*
//     |--------------------------------------------------------------------------
//     | Parse JSON
//     |--------------------------------------------------------------------------
//     */

//     let payload;

//     try {
//       payload = JSON.parse(req.body.toString("utf8"));
//     } catch (error) {
//       console.log("❌ Invalid GitHub JSON");

//       return res.status(400).json({
//         success: false,
//         message: "Invalid JSON",
//       });
//     }

//     /*
//     |--------------------------------------------------------------------------
//     | Event Routing
//     |--------------------------------------------------------------------------
//     */

//     switch (event) {
//       case "pull_request":
//         handlePullRequest(payload);
//         break;

//       case "pull_request_review_comment":
//         handleReviewComment(payload);
//         break;

//       case "pull_request_review":
//         handlePullRequestReview(payload);
//         break;

//       case "issue_comment":
//         handleIssueComment(payload);
//         break;

//       default:
//         console.log("Event ignored:", event);
//     }

//     /*
//     |--------------------------------------------------------------------------
//     | Respond quickly
//     |--------------------------------------------------------------------------
//     */

//     return res.status(200).json({
//       success: true,
//       received: true,
//     });
//   },
// );

// /*
// |--------------------------------------------------------------------------
// | Handle Pull Request
// |--------------------------------------------------------------------------
// */

// function handlePullRequest(payload) {
//   const action = payload.action;

//   const repository = payload.repository;

//   const pr = payload.pull_request;

//   if (!repository || !pr) {
//     console.log("❌ Invalid pull_request payload");

//     return;
//   }

//   const repositoryId = repository.id;

//   const prId = pr.id;

//   const prNumber = pr.number;

//   const branchName = pr.head?.ref;

//   const headSha = pr.head?.sha;

//   console.log("\n======= PULL REQUEST =======");

//   console.log("Action:", action);

//   console.log("Repository:", repository.full_name);

//   console.log("Repository ID:", repositoryId);

//   console.log("PR ID:", prId);

//   console.log("PR Number:", prNumber);

//   console.log("Branch:", branchName);

//   console.log("Head SHA:", headSha);

//   /*
//   |--------------------------------------------------------------------------
//   | Find Nexus branch
//   |--------------------------------------------------------------------------
//   */

//   const nexusBranch = nexusBranches.find(
//     (branch) =>
//       branch.githubRepositoryId === repositoryId &&
//       branch.branchName === branchName,
//   );

//   if (!nexusBranch) {
//     console.log("⚠️ No Nexus task found for branch:", branchName);

//     return;
//   }

//   console.log("✅ Nexus Task found:", nexusBranch.taskId);

//   /*
//   |--------------------------------------------------------------------------
//   | Find existing PR mapping
//   |--------------------------------------------------------------------------
//   */

//   const existingPr = githubPullRequests.find(
//     (item) =>
//       item.githubRepositoryId === repositoryId && item.githubPrId === prId,
//   );

//   if (existingPr) {
//     existingPr.prNumber = prNumber;

//     existingPr.branchName = branchName;

//     existingPr.headSha = headSha;

//     existingPr.updatedAt = new Date().toISOString();

//     console.log("🔄 PR mapping updated");

//     return;
//   }

//   /*
//   |--------------------------------------------------------------------------
//   | Create PR → Task mapping
//   |--------------------------------------------------------------------------
//   */

//   const prMapping = {
//     id: generateId(),

//     githubRepositoryId: repositoryId,

//     githubPrId: prId,

//     githubPrNumber: prNumber,

//     taskId: nexusBranch.taskId,

//     branchId: nexusBranch.id,

//     branchName,

//     headSha,

//     prUrl: pr.html_url,

//     createdAt: new Date().toISOString(),

//     updatedAt: new Date().toISOString(),
//   };

//   githubPullRequests.push(prMapping);

//   console.log("\n✅ PR mapped to Nexus task");

//   console.log(prMapping);
// }

// /*
// |--------------------------------------------------------------------------
// | Handle Claude Inline Review Comment
// |--------------------------------------------------------------------------
// */

// function handleReviewComment(payload) {
//   const action = payload.action;

//   if (action !== "created") {
//     return;
//   }

//   const repository = payload.repository;

//   const pr = payload.pull_request;

//   const comment = payload.comment;

//   if (!repository || !pr || !comment) {
//     return;
//   }

//   console.log("\n======= REVIEW COMMENT =======");

//   console.log("Repository:", repository.full_name);

//   console.log("PR Number:", pr.number);

//   console.log("Comment ID:", comment.id);

//   console.log("Author:", comment.user?.login);

//   console.log("File:", comment.path);

//   console.log("Line:", comment.line);

//   console.log("Body:");

//   console.log(comment.body);

//   /*
//   |--------------------------------------------------------------------------
//   | Find PR → Nexus Task
//   |--------------------------------------------------------------------------
//   |
//   | IMPORTANT:
//   |
//   | We use GitHub PR ID here.
//   |
//   | We do NOT use branch name.
//   |
//   */

//   const prMapping = githubPullRequests.find(
//     (item) =>
//       item.githubRepositoryId === repository.id && item.githubPrId === pr.id,
//   );

//   if (!prMapping) {
//     console.log("⚠️ PR is not mapped to a Nexus task");

//     return;
//   }

//   console.log("✅ Claude comment belongs to Nexus Task:", prMapping.taskId);

//   /*
//   |--------------------------------------------------------------------------
//   | Store Claude comment
//   |--------------------------------------------------------------------------
//   */

//   const claudeComment = {
//     id: generateId(),

//     taskId: prMapping.taskId,

//     branchId: prMapping.branchId,

//     githubRepositoryId: repository.id,

//     githubPrId: pr.id,

//     githubPrNumber: pr.number,

//     githubCommentId: comment.id,

//     author: comment.user?.login,

//     filePath: comment.path,

//     line: comment.line,

//     body: comment.body,

//     createdAt: new Date().toISOString(),
//   };

//   claudeComments.push(claudeComment);

//   console.log("\n✅ Claude finding stored");

//   console.log(claudeComment);
// }

// /*
// |--------------------------------------------------------------------------
// | Handle Complete Claude PR Review
// |--------------------------------------------------------------------------
// */

// function handlePullRequestReview(payload) {
//   const action = payload.action;

//   if (action !== "submitted") {
//     return;
//   }

//   const repository = payload.repository;

//   const pr = payload.pull_request;

//   const review = payload.review;

//   if (!repository || !pr || !review) {
//     return;
//   }

//   console.log("\n======= CLAUDE PR REVIEW =======");

//   console.log("Repository:", repository.full_name);

//   console.log("PR Number:", pr.number);

//   console.log("PR ID:", pr.id);

//   console.log("Review ID:", review.id);

//   console.log("Reviewer:", review.user?.login);

//   console.log("State:", review.state);

//   console.log("Body:");

//   console.log(review.body);

//   /*
//   |--------------------------------------------------------------------------
//   | Find PR → Nexus Task
//   |--------------------------------------------------------------------------
//   */

//   const prMapping = githubPullRequests.find(
//     (item) =>
//       item.githubRepositoryId === repository.id && item.githubPrId === pr.id,
//   );

//   if (!prMapping) {
//     console.log("⚠️ PR is not mapped to a Nexus task");

//     return;
//   }

//   console.log("✅ Review belongs to Nexus Task:", prMapping.taskId);

//   /*
//   |--------------------------------------------------------------------------
//   | Store review
//   |--------------------------------------------------------------------------
//   */

//   const claudeReview = {
//     id: generateId(),

//     taskId: prMapping.taskId,

//     branchId: prMapping.branchId,

//     githubRepositoryId: repository.id,

//     githubPrId: pr.id,

//     githubPrNumber: pr.number,

//     githubReviewId: review.id,

//     reviewer: review.user?.login,

//     reviewState: review.state,

//     reviewBody: review.body,

//     submittedAt: review.submitted_at,

//     createdAt: new Date().toISOString(),
//   };

//   claudeReviews.push(claudeReview);

//   console.log("\n✅ Claude PR review stored");
// }

// /*
// |--------------------------------------------------------------------------
// | Handle Normal PR Conversation Comment
// |--------------------------------------------------------------------------
// */

// function handleIssueComment(payload) {
//   const issue = payload.issue;

//   /*
//   |--------------------------------------------------------------------------
//   | issue_comment works for Issues and PRs.
//   |
//   | Ignore normal issues.
//   |--------------------------------------------------------------------------
//   */

//   if (!issue?.pull_request) {
//     return;
//   }

//   const repository = payload.repository;

//   const comment = payload.comment;

//   console.log("\n======= PR COMMENT =======");

//   console.log("Repository:", repository.full_name);

//   console.log("PR Number:", issue.number);

//   console.log("Comment ID:", comment.id);

//   console.log("Author:", comment.user?.login);

//   console.log("Body:", comment.body);
// }

// /*
// |--------------------------------------------------------------------------
// | Nexus → Create GitHub Branch
// |--------------------------------------------------------------------------
// |
// | POST /nexus/branches
// |
// | Body:
// |
// | {
// |   "taskId": "TASK-123",
// |   "owner": "Kevish-Thakkar",
// |   "repo": "Test-Claude-PR-Checking",
// |   "branchName": "feature/task-123"
// | }
// |
// */

// app.post(
//   "/nexus/branches",

//   express.json(),

//   async (req, res) => {
//     try {
//       const { taskId, owner, repo, branchName } = req.body;

//       if (!taskId || !owner || !repo || !branchName) {
//         return res.status(400).json({
//           success: false,

//           message: "taskId, owner, repo and branchName are required",
//         });
//       }

//       if (!GITHUB_TOKEN) {
//         return res.status(500).json({
//           success: false,

//           message: "GITHUB_TOKEN is not configured",
//         });
//       }

//       /*
//       |--------------------------------------------------------------------------
//       | 1. Get repository
//       |--------------------------------------------------------------------------
//       */

//       const repoResponse = await fetch(
//         `https://api.github.com/repos/${owner}/${repo}`,

//         {
//           headers: {
//             Authorization: `Bearer ${GITHUB_TOKEN}`,

//             Accept: "application/vnd.github+json",

//             "X-GitHub-Api-Version": "2022-11-28",
//           },
//         },
//       );

//       if (!repoResponse.ok) {
//         const error = await repoResponse.text();

//         console.error("GitHub repository error:", error);

//         return res.status(repoResponse.status).json({
//           success: false,

//           message: "Failed to get GitHub repository",

//           error,
//         });
//       }

//       const repository = await repoResponse.json();

//       console.log("\n======= GITHUB REPOSITORY =======");

//       console.log("Repository ID:", repository.id);

//       console.log("Repository:", repository.full_name);

//       /*
//       |--------------------------------------------------------------------------
//       | 2. Get default branch
//       |--------------------------------------------------------------------------
//       */

//       const defaultBranch = repository.default_branch;

//       console.log("Default branch:", defaultBranch);

//       /*
//       |--------------------------------------------------------------------------
//       | 3. Get default branch SHA
//       |--------------------------------------------------------------------------
//       */

//       const branchResponse = await fetch(
//         `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,

//         {
//           headers: {
//             Authorization: `Bearer ${GITHUB_TOKEN}`,

//             Accept: "application/vnd.github+json",

//             "X-GitHub-Api-Version": "2022-11-28",
//           },
//         },
//       );

//       if (!branchResponse.ok) {
//         const error = await branchResponse.text();

//         console.error("GitHub branch lookup error:", error);

//         return res.status(branchResponse.status).json({
//           success: false,

//           message: "Failed to get base branch",

//           error,
//         });
//       }

//       const branchData = await branchResponse.json();

//       const baseSha = branchData.object.sha;

//       console.log("Base SHA:", baseSha);

//       /*
//       |--------------------------------------------------------------------------
//       | 4. Create GitHub branch
//       |--------------------------------------------------------------------------
//       */

//       const createBranchResponse = await fetch(
//         `https://api.github.com/repos/${owner}/${repo}/git/refs`,

//         {
//           method: "POST",

//           headers: {
//             Authorization: `Bearer ${GITHUB_TOKEN}`,

//             Accept: "application/vnd.github+json",

//             "Content-Type": "application/json",

//             "X-GitHub-Api-Version": "2022-11-28",
//           },

//           body: JSON.stringify({
//             ref: `refs/heads/${branchName}`,

//             sha: baseSha,
//           }),
//         },
//       );

//       if (!createBranchResponse.ok) {
//         const error = await createBranchResponse.text();

//         console.error("GitHub branch creation error:", error);

//         return res.status(createBranchResponse.status).json({
//           success: false,

//           message: "Failed to create GitHub branch",

//           error,
//         });
//       }

//       const createdBranch = await createBranchResponse.json();

//       /*
//       |--------------------------------------------------------------------------
//       | 5. Create Nexus branch mapping
//       |--------------------------------------------------------------------------
//       */

//       const branch = {
//         id: generateId(),

//         taskId,

//         githubRepositoryId: repository.id,

//         owner,

//         repo,

//         branchName,

//         baseSha,

//         createdAt: new Date().toISOString(),

//         updatedAt: new Date().toISOString(),
//       };

//       nexusBranches.push(branch);

//       /*
//       |--------------------------------------------------------------------------
//       | 6. Response
//       |--------------------------------------------------------------------------
//       */

//       console.log("\n======= GITHUB BRANCH CREATED =======");

//       console.log("Nexus Branch ID:", branch.id);

//       console.log("Task:", taskId);

//       console.log("Repository:", repository.full_name);

//       console.log("Repository ID:", repository.id);

//       console.log("Branch:", branchName);

//       return res.status(201).json({
//         success: true,

//         branch: {
//           ...branch,

//           githubRef: createdBranch.ref,

//           githubObjectSha: createdBranch.object.sha,
//         },
//       });
//     } catch (error) {
//       console.error("Branch creation error:", error);

//       return res.status(500).json({
//         success: false,

//         message: "Internal server error",

//         error: error.message,
//       });
//     }
//   },
// );

// /*
// |--------------------------------------------------------------------------
// | Debug APIs
// |--------------------------------------------------------------------------
// */

// app.get("/debug/branches", (req, res) => {
//   res.json(nexusBranches);
// });

// app.get("/debug/prs", (req, res) => {
//   res.json(githubPullRequests);
// });

// app.get("/debug/comments", (req, res) => {
//   res.json(claudeComments);
// });

// app.get("/debug/reviews", (req, res) => {
//   res.json(claudeReviews);
// });

// app.get("/debug/sonar", (req, res) => {
//   res.json(sonarReports);
// });

// /*
// |--------------------------------------------------------------------------
// | Health Check
// |--------------------------------------------------------------------------
// */

// app.get("/", (req, res) => {
//   res.json({
//     status: "ok",

//     service: "Nexus GitHub + SonarQube Gateway",

//     sonarUrl: SONAR_URL,

//     githubWebhookConfigured: Boolean(GITHUB_WEBHOOK_SECRET),

//     githubTokenConfigured: Boolean(GITHUB_TOKEN),

//     sonarTokenConfigured: Boolean(SONAR_TOKEN),
//   });
// });

// /*
// |--------------------------------------------------------------------------
// | Start Server
// |--------------------------------------------------------------------------
// */

// app.listen(PORT, () => {
//   console.log(`🚀 Server running on http://localhost:${PORT}`);

//   console.log(
//     "GitHub webhook secret configured:",
//     Boolean(GITHUB_WEBHOOK_SECRET),
//   );

//   console.log("GitHub token configured:", Boolean(GITHUB_TOKEN));

//   console.log("SonarQube URL:", SONAR_URL);

//   console.log("SonarQube token configured:", Boolean(SONAR_TOKEN));
// });

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { connectMongo } = require("./src/db/connect");
const {
  Branch,
  PullRequest,
  Comment,
  Review,
  QualityGate,
  WebhookEvent,
} = require("./src/models");
const {
  resetStores,
  logWebhookEvent,
  markWebhookProcessed,
  resolveBranchForQualityGate,
  applyQualityGateToBranch,
} = require("./src/services/persistence");

const app = express();

/*
|--------------------------------------------------------------------------
| Utility
|--------------------------------------------------------------------------
*/

function generateId() {
  return crypto.randomUUID();
}

/*
|--------------------------------------------------------------------------
| GitHub Signature Verification
|--------------------------------------------------------------------------
*/

function verifyGitHubSignature(payload, signature) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.log("❌ GITHUB_WEBHOOK_SECRET is not configured");

    return false;
  }

  if (!signature) {
    console.log("❌ X-Hub-Signature-256 missing");

    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto
      .createHmac("sha256", webhookSecret)
      .update(payload)
      .digest("hex");

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}

/*
|--------------------------------------------------------------------------
| GitHub API Helper
|--------------------------------------------------------------------------
*/

async function githubRequest(url, options = {}) {
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const response = await fetch(url, {
    ...options,

    headers: {
      Authorization: `Bearer ${githubToken}`,

      Accept: "application/vnd.github+json",

      "X-GitHub-Api-Version": "2022-11-28",

      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`GitHub API failed: ${response.status} ${body}`);
  }

  return response.json();
}

/*
|--------------------------------------------------------------------------
| SonarQube API
|--------------------------------------------------------------------------
*/

/**
 * Get Quality Gate information.
 *
 * GET:
 *
 * /api/qualitygates/project_status
 *
 * Example:
 *
 * http://localhost:9000/api/qualitygates/project_status?projectKey=test-claude-pr-checking
 */

async function getSonarQualityGate(projectKey) {
  const sonarToken = process.env.SONAR_TOKEN;
  const sonarUrl = process.env.SONAR_URL || "http://localhost:9000";

  if (!sonarToken) {
    throw new Error("SONAR_TOKEN is not configured");
  }

  const url =
    `${sonarUrl}/api/qualitygates/project_status` +
    `?projectKey=${encodeURIComponent(projectKey)}`;

  const auth = Buffer.from(`${sonarToken}:`).toString("base64");

  const response = await fetch(url, {
    method: "GET",

    headers: {
      Authorization: `Basic ${auth}`,

      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`SonarQube API failed: ${response.status} ${body}`);
  }

  return response.json();
}

/*
|--------------------------------------------------------------------------
| Extract Failed SonarQube Conditions
|--------------------------------------------------------------------------
*/

function extractFailedConditions(projectStatus) {
  const conditions = projectStatus?.conditions || [];

  return conditions
    .filter((condition) => condition.status === "ERROR")
    .map((condition) => ({
      metric: condition.metricKey,

      status: condition.status,

      actualValue: condition.actualValue ?? null,

      threshold: condition.errorThreshold ?? null,

      operator: condition.comparator ?? condition.operator ?? null,
    }));
}

/*
|--------------------------------------------------------------------------
| SONARQUBE WEBHOOK
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| SonarQube sends JSON.
|
| Therefore this route uses express.json().
|
| We do NOT use express.json() globally because
| GitHub signature verification requires the raw body.
|
*/

app.post(
  "/webhooks/sonarqube",

  express.json(),

  async (req, res) => {
    console.log("\n=================================");

    console.log("SonarQube Webhook Received");

    console.log("=================================");

    let webhookEvent = null;

    try {
      const payload = req.body;

      webhookEvent = await logWebhookEvent({
        source: "sonarqube",
        eventType: "qualitygate",
        deliveryId: payload.analysisId || null,
        payload,
      });

      console.log("\n========== SONAR PAYLOAD ==========");

      console.log(JSON.stringify(payload, null, 2));

      /*
      |--------------------------------------------------------------------------
      | Extract Sonar information
      |--------------------------------------------------------------------------
      */

      const projectKey = payload.project?.key;

      const projectName = payload.project?.name;

      const analysisId = payload.analysisId;

      const revision = payload.revision || null;

      const webhookStatus = payload.status;

      const webhookQualityGateStatus = payload.qualityGate?.status;

      /*
      |--------------------------------------------------------------------------
      | Validate project key
      |--------------------------------------------------------------------------
      */

      if (!projectKey) {
        console.log("❌ Project key missing");

        if (webhookEvent) {
          await markWebhookProcessed(webhookEvent.id, "Project key missing");
        }

        return res.status(400).json({
          success: false,

          message: "Project key missing",
        });
      }

      console.log("\n========== SONAR ANALYSIS ==========");

      console.log("Project Key:", projectKey);

      console.log("Project Name:", projectName);

      console.log("Analysis ID:", analysisId);

      console.log("Revision:", revision);

      console.log("Webhook Status:", webhookStatus);

      console.log("Webhook Quality Gate:", webhookQualityGateStatus);

      /*
      |--------------------------------------------------------------------------
      | Get detailed Quality Gate
      |--------------------------------------------------------------------------
      */

      const sonarResult = await getSonarQualityGate(projectKey);

      const projectStatus = sonarResult.projectStatus;

      const qualityGateStatus = projectStatus?.status;

      /*
      |--------------------------------------------------------------------------
      | Extract conditions
      |--------------------------------------------------------------------------
      */

      const conditions = projectStatus?.conditions || [];

      const failedConditions = extractFailedConditions(projectStatus);

      /*
      |--------------------------------------------------------------------------
      | Log Quality Gate
      |--------------------------------------------------------------------------
      */

      console.log("\n========== QUALITY GATE ==========");

      console.log("Status:", qualityGateStatus);

      console.log("\n========== CONDITIONS ==========");

      console.table(conditions);

      console.log("\n========== FAILED CONDITIONS ==========");

      if (failedConditions.length === 0) {
        console.log("✅ No failed conditions");
      } else {
        console.table(failedConditions);
      }

      /*
      |--------------------------------------------------------------------------
      | Correlate revision (Sonar) with branch headSha (GitHub PR sync/open)
      |--------------------------------------------------------------------------
      */

      const passed = qualityGateStatus === "OK";

      let matchedBranch = null;

      if (revision) {
        const resolved = await resolveBranchForQualityGate({
          commitSha: revision,
          revision,
        });
        matchedBranch = resolved.branch;
      }

      const qualityReport = await QualityGate.create({
        taskId: matchedBranch?.taskId || "unmapped",
        branchId: matchedBranch?.id || "unmapped",
        githubRepositoryId: matchedBranch?.githubRepositoryId || null,
        githubPrId: null,
        commitSha: revision,
        revision,
        sonarProjectKey: projectKey,
        sonarAnalysisId: analysisId || null,
        status: qualityGateStatus || "ERROR",
        passed,
        failed: !passed,
        failedConditions,
        source: "webhook",
      });

      if (matchedBranch) {
        await applyQualityGateToBranch(matchedBranch, qualityReport);
        console.log(
          "✅ Quality Gate linked to branch:",
          matchedBranch.branchName,
        );
      } else {
        console.log("⚠️ No branch matched Sonar revision:", revision);
      }

      if (webhookEvent) {
        await markWebhookProcessed(webhookEvent.id);
      }

      /*
      |--------------------------------------------------------------------------
      | Return Sonar Result
      |--------------------------------------------------------------------------
      */

      return res.status(200).json({
        success: true,

        projectKey,

        analysisId,

        revision,

        branchId: matchedBranch?.id || null,

        qualityGate: {
          status: qualityGateStatus,

          passed,

          failed: !passed,

          failedConditions,
        },
      });
    } catch (error) {
      console.error("\n❌ SonarQube webhook error:");

      console.error(error);

      if (webhookEvent) {
        await markWebhookProcessed(webhookEvent.id, error.message);
      }

      return res.status(500).json({
        success: false,

        message: error.message,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GitHub Webhook
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| GitHub requires the RAW body for signature verification.
|
*/

app.post(
  "/webhooks/github",

  express.raw({
    type: "application/json",
  }),

  async (req, res) => {
    console.log("\n=================================");

    console.log("GitHub Webhook Received", new Date().toISOString());

    console.log("=================================");

    const event = req.headers["x-github-event"];

    const deliveryId = req.headers["x-github-delivery"];

    const signature = req.headers["x-hub-signature-256"];

    console.log("Event:", event);

    console.log("Delivery ID:", deliveryId);

    /*
    |--------------------------------------------------------------------------
    | Verify signature
    |--------------------------------------------------------------------------
    */

    if (!verifyGitHubSignature(req.body, signature)) {
      console.log("❌ Invalid GitHub signature");

      return res.status(401).json({
        success: false,

        message: "Invalid signature",
      });
    }

    console.log("✅ GitHub signature verified");

    /*
    |--------------------------------------------------------------------------
    | Parse payload
    |--------------------------------------------------------------------------
    */

    let payload;

    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (error) {
      console.log("❌ Invalid GitHub JSON");

      return res.status(400).json({
        success: false,

        message: "Invalid JSON",
      });
    }

    const webhookEvent = await logWebhookEvent({
      source: "github",
      eventType: event,
      deliveryId: deliveryId || null,
      payload,
    });

    try {
      /*
      |--------------------------------------------------------------------------
      | Route event
      |--------------------------------------------------------------------------
      */

      switch (event) {
        case "pull_request":
          await handlePullRequest(payload);
          break;

        case "pull_request_review_comment":
          await handleReviewComment(payload);
          break;

        case "pull_request_review":
          await handlePullRequestReview(payload);
          break;

        case "issue_comment":
          await handleIssueComment(payload);
          break;

        default:
          console.log("Event ignored:", event);
      }

      await markWebhookProcessed(webhookEvent.id);

      /*
      |--------------------------------------------------------------------------
      | Respond
      |--------------------------------------------------------------------------
      */

      return res.status(200).json({
        success: true,

        received: true,
      });
    } catch (error) {
      console.error("❌ GitHub webhook handler failed:", error);
      await markWebhookProcessed(webhookEvent.id, error.message);

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| Handle GitHub Pull Request
|--------------------------------------------------------------------------
*/

async function handlePullRequest(payload) {
  const action = payload.action;

  const repository = payload.repository;

  const pr = payload.pull_request;

  if (!repository || !pr) {
    console.log("❌ Invalid pull_request payload");

    return;
  }

  const repositoryId = repository.id;

  const prId = pr.id;

  const prNumber = pr.number;

  const branchName = pr.head?.ref;

  const headSha = pr.head?.sha;

  console.log("\n======= PULL REQUEST =======");

  console.log("Action:", action);

  console.log("Repository:", repository.full_name);

  console.log("Repository ID:", repositoryId);

  console.log("PR ID:", prId);

  console.log("PR Number:", prNumber);

  console.log("Branch:", branchName);

  console.log("Head SHA:", headSha);

  /*
  |--------------------------------------------------------------------------
  | Find Nexus Branch
  |--------------------------------------------------------------------------
  */

  const nexusBranch = await Branch.findOne({
    githubRepositoryId: repositoryId,
    branchName,
  });

  if (!nexusBranch) {
    console.log("⚠️ No Nexus task found for branch:", branchName);

    return;
  }

  console.log("✅ Nexus Task found:", nexusBranch.taskId);

  // Keep branch.headSha in sync with PR opened / synchronize (matches Sonar revision)
  if (headSha) {
    nexusBranch.headSha = headSha;
    await nexusBranch.save();
  }

  /*
  |--------------------------------------------------------------------------
  | Check existing PR mapping
  |--------------------------------------------------------------------------
  */

  const existingPr = await PullRequest.findOne({
    githubRepositoryId: repositoryId,
    githubPrId: prId,
  });

  if (existingPr) {
    existingPr.githubPrNumber = prNumber;
    existingPr.branchName = branchName;
    existingPr.headSha = headSha;
    await existingPr.save();

    console.log("🔄 PR mapping updated");

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Create PR → Task mapping
  |--------------------------------------------------------------------------
  */

  const prMapping = await PullRequest.create({
    githubRepositoryId: repositoryId,
    githubPrId: prId,
    githubPrNumber: prNumber,
    taskId: nexusBranch.taskId,
    branchId: nexusBranch.id,
    branchName,
    headSha,
    prUrl: pr.html_url,
  });

  console.log("\n✅ PR mapped to Nexus task");

  console.log(prMapping.toObject());
}

/*
|--------------------------------------------------------------------------
| Handle Claude Inline Review Comment
|--------------------------------------------------------------------------
*/

async function handleReviewComment(payload) {
  const action = payload.action;

  if (action !== "created") {
    return;
  }

  const repository = payload.repository;

  const pr = payload.pull_request;

  const comment = payload.comment;

  if (!repository || !pr || !comment) {
    return;
  }

  console.log("\n======= CLAUDE REVIEW COMMENT =======");

  console.log("Repository:", repository.full_name);

  console.log("PR Number:", pr.number);

  console.log("PR ID:", pr.id);

  console.log("Comment ID:", comment.id);

  console.log("Author:", comment.user?.login);

  console.log("File:", comment.path);

  console.log("Line:", comment.line);

  console.log("Body:", comment.body);

  /*
  |--------------------------------------------------------------------------
  | IMPORTANT
  |--------------------------------------------------------------------------
  |
  | Use PR ID, NOT branch name.
  |
  */

  const prMapping = await PullRequest.findOne({
    githubRepositoryId: repository.id,
    githubPrId: pr.id,
  }).lean();

  if (!prMapping) {
    console.log("⚠️ PR is not mapped to Nexus task");

    return;
  }

  console.log("✅ Claude comment belongs to:", prMapping.taskId);

  /*
  |--------------------------------------------------------------------------
  | Store Claude comment on the branch
  |--------------------------------------------------------------------------
  */

  const claudeComment = await Comment.create({
    taskId: prMapping.taskId,
    branchId: prMapping.branchId,
    githubRepositoryId: repository.id,
    githubPrId: pr.id,
    githubPrNumber: pr.number,
    githubCommentId: comment.id,
    author: comment.user?.login,
    filePath: comment.path,
    line: comment.line,
    body: comment.body,
  });

  console.log("\n✅ Claude finding stored");

  console.log(claudeComment.toObject());
}

/*
|--------------------------------------------------------------------------
| Handle Complete Claude PR Review
|--------------------------------------------------------------------------
*/

async function handlePullRequestReview(payload) {
  const action = payload.action;

  if (action !== "submitted") {
    return;
  }

  const repository = payload.repository;

  const pr = payload.pull_request;

  const review = payload.review;

  if (!repository || !pr || !review) {
    return;
  }

  console.log("\n======= CLAUDE PR REVIEW =======");

  console.log("Repository:", repository.full_name);

  console.log("PR Number:", pr.number);

  console.log("PR ID:", pr.id);

  console.log("Review ID:", review.id);

  console.log("Reviewer:", review.user?.login);

  console.log("State:", review.state);

  console.log("Body:", review.body);

  /*
  |--------------------------------------------------------------------------
  | Find PR → Nexus Task
  |--------------------------------------------------------------------------
  */

  const prMapping = await PullRequest.findOne({
    githubRepositoryId: repository.id,
    githubPrId: pr.id,
  }).lean();

  if (!prMapping) {
    console.log("⚠️ PR is not mapped to Nexus task");

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Store review
  |--------------------------------------------------------------------------
  */

  const claudeReview = await Review.create({
    taskId: prMapping.taskId,
    branchId: prMapping.branchId,
    githubRepositoryId: repository.id,
    githubPrId: pr.id,
    githubPrNumber: pr.number,
    githubReviewId: review.id,
    reviewer: review.user?.login,
    reviewState: review.state,
    reviewBody: review.body,
    submittedAt: review.submitted_at || null,
  });

  console.log("\n✅ Claude PR review stored");

  console.log(claudeReview.toObject());
}

/*
|--------------------------------------------------------------------------
| Handle Normal PR Conversation Comment
|--------------------------------------------------------------------------
*/

async function handleIssueComment(payload) {
  const issue = payload.issue;

  /*
  |--------------------------------------------------------------------------
  | issue_comment is used for both Issues and PRs.
  |--------------------------------------------------------------------------
  */

  if (!issue?.pull_request) {
    return;
  }

  const repository = payload.repository;

  const comment = payload.comment;

  console.log("\n======= PR COMMENT =======");

  console.log("Repository:", repository.full_name);

  console.log("PR Number:", issue.number);

  console.log("Comment ID:", comment.id);

  console.log("Author:", comment.user?.login);

  console.log("Body:", comment.body);
}

/*
|--------------------------------------------------------------------------
| NEXUS → CREATE GITHUB BRANCH
|--------------------------------------------------------------------------
|
| POST /nexus/branches
|
| Body:
|
| {
|   "taskId": "TASK-123",
|   "owner": "Kevish-Thakkar",
|   "repo": "Test-Claude-PR-Checking",
|   "branchName": "feature/task-123"
| }
|
*/

app.post(
  "/nexus/branches",

  express.json(),

  async (req, res) => {
    try {
      const { taskId, owner, repo, branchName } = req.body;

      if (!taskId || !owner || !repo || !branchName) {
        return res.status(400).json({
          success: false,

          message: "taskId, owner, repo and branchName are required",
        });
      }

      if (!process.env.GITHUB_TOKEN) {
        return res.status(500).json({
          success: false,

          message: "GITHUB_TOKEN is not configured",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Get repository
      |--------------------------------------------------------------------------
      */

      const repository = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}`,
      );

      console.log("\n======= GITHUB REPOSITORY =======");

      console.log("Repository:", repository.full_name);

      console.log("Repository ID:", repository.id);

      /*
      |--------------------------------------------------------------------------
      | Get default branch
      |--------------------------------------------------------------------------
      */

      const defaultBranch = repository.default_branch;

      console.log("Default branch:", defaultBranch);

      /*
      |--------------------------------------------------------------------------
      | Get default branch SHA
      |--------------------------------------------------------------------------
      */

      const branchData = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
      );

      const baseSha = branchData.object.sha;

      console.log("Base SHA:", baseSha);

      /*
      |--------------------------------------------------------------------------
      | Create branch
      |--------------------------------------------------------------------------
      */

      const createdBranch = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/git/refs`,

        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,

            sha: baseSha,
          }),
        },
      );

      /*
      |--------------------------------------------------------------------------
      | Create Nexus branch mapping in MongoDB
      |--------------------------------------------------------------------------
      */

      const branch = await Branch.create({
        taskId,
        githubRepositoryId: repository.id,
        owner,
        repo,
        branchName,
        baseSha,
        headSha: baseSha,
      });

      console.log("\n======= BRANCH CREATED =======");

      console.log("Nexus Branch ID:", branch.id);

      console.log("Task:", taskId);

      console.log("Branch:", branchName);

      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      return res.status(201).json({
        success: true,

        branch: {
          ...branch.toObject(),
          githubRef: createdBranch.ref,
          githubObjectSha: createdBranch.object.sha,
        },
      });
    } catch (error) {
      console.error("\n❌ Branch creation failed:");

      console.error(error);

      return res.status(500).json({
        success: false,

        message: error.message,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| NEXUS → QUALITY GATE
|--------------------------------------------------------------------------
|
| THIS IS THE IMPORTANT ENDPOINT.
|
| GitHub Actions can call this after SonarQube
| analysis.
|
| POST /nexus/quality-gate
|
| Body:
|
| {
|   "githubRepositoryId": 123,
|   "githubPrId": 456,
|   "commitSha": "abc123",
|   "sonarProjectKey": "test-claude-pr-checking",
|   "sonarAnalysisId": "xyz123",
|   "status": "ERROR",
|   "failedConditions": []
| }
|
*/

app.post(
  "/nexus/quality-gate",

  express.json(),

  async (req, res) => {
    try {
      const {
        githubRepositoryId,
        githubPrId,
        commitSha,
        revision,
        sonarProjectKey,
        sonarAnalysisId,
        sonarTaskId,
        status,
        failedConditions = [],
      } = req.body;

      const sha = commitSha || revision || null;

      console.log("\n=================================");

      console.log("Nexus Quality Gate Received");

      console.log("=================================");

      console.log("Repository ID:", githubRepositoryId);

      console.log("PR ID:", githubPrId);

      console.log("Commit SHA / revision:", sha);

      console.log("Sonar Project:", sonarProjectKey);

      console.log("Sonar Analysis:", sonarAnalysisId);

      console.log("Status:", status);

      /*
      |--------------------------------------------------------------------------
      | Validate — need repo + (PR id or commit SHA/revision)
      |--------------------------------------------------------------------------
      */

      if (!githubRepositoryId || (!githubPrId && !sha)) {
        return res.status(400).json({
          success: false,

          message:
            "githubRepositoryId and either githubPrId or commitSha/revision are required",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Correlate:
      | 1) GitHub PR ID → PullRequest → Branch
      | 2) commitSha/revision === Branch.headSha (from PR opened/synchronize)
      |--------------------------------------------------------------------------
      */

      const { branch, pr, matchedBy } = await resolveBranchForQualityGate({
        githubRepositoryId,
        githubPrId,
        commitSha: sha,
        revision: sha,
      });

      if (!branch) {
        console.log("❌ Could not map Quality Gate to a Nexus branch");

        return res.status(404).json({
          success: false,

          message: "No Nexus branch found for PR id or commit SHA/revision",

          githubRepositoryId,

          githubPrId: githubPrId || null,

          commitSha: sha,
        });
      }

      console.log("\n✅ QUALITY GATE → NEXUS BRANCH");

      console.log("Matched by:", matchedBy);

      console.log("Task ID:", branch.taskId);

      console.log("Branch ID:", branch.id);

      console.log("Branch:", branch.branchName);

      // CI may post empty status when earlier Sonar steps fail (if: always()).
      // Treat blank/missing as ERROR so Mongo validation succeeds and the branch is marked failed.
      const normalizedStatus =
        typeof status === "string" && status.trim() !== ""
          ? status.trim()
          : "ERROR";

      if (normalizedStatus !== status) {
        console.log(
          "⚠️ Quality Gate status missing/empty — defaulting to ERROR",
        );
      }

      const passed = normalizedStatus === "OK";

      const qualityReport = await QualityGate.create({
        taskId: branch.taskId,
        branchId: branch.id,
        githubRepositoryId,
        githubPrId: githubPrId || pr?.githubPrId || null,
        commitSha: sha,
        revision: sha,
        sonarProjectKey: sonarProjectKey || null,
        sonarAnalysisId: sonarAnalysisId || null,
        sonarTaskId: sonarTaskId || null,
        status: normalizedStatus,
        passed,
        failed: !passed,
        failedConditions: Array.isArray(failedConditions)
          ? failedConditions
          : [],
        source: "ci",
      });

      await applyQualityGateToBranch(branch, qualityReport);

      return res.status(201).json({
        success: true,

        message: "Quality Gate mapped to Nexus branch",

        matchedBy,

        task: {
          taskId: branch.taskId,

          branchId: branch.id,

          branchName: branch.branchName,

          githubPrId: githubPrId || pr?.githubPrId || null,

          commitSha: sha,

          status: normalizedStatus,

          passed,

          failed: !passed,

          failedConditions: Array.isArray(failedConditions)
            ? failedConditions
            : [],

          latestQualityGatePassed: branch.latestQualityGatePassed,
        },
      });
    } catch (error) {
      console.error("\n❌ Quality Gate processing failed:");

      console.error(error);

      return res.status(500).json({
        success: false,

        message: error.message,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| Check Quality Gate for a branch
|--------------------------------------------------------------------------
*/

app.get("/nexus/branches/:branchId/quality-gate", async (req, res) => {
  try {
    const branch = await Branch.findOne({ id: req.params.branchId }).lean();

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const history = await QualityGate.find({ branchId: branch.id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      branch: {
        id: branch.id,
        taskId: branch.taskId,
        branchName: branch.branchName,
        headSha: branch.headSha,
        latestQualityGateStatus: branch.latestQualityGateStatus,
        latestQualityGatePassed: branch.latestQualityGatePassed,
        latestQualityGateAt: branch.latestQualityGateAt,
      },
      passed: branch.latestQualityGatePassed === true,
      history,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| Branch comments
|--------------------------------------------------------------------------
*/

app.get("/nexus/branches/:branchId/comments", async (req, res) => {
  try {
    const comments = await Comment.find({ branchId: req.params.branchId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, comments });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| Debug APIs
|--------------------------------------------------------------------------
*/

app.get("/debug/branches", async (req, res) => {
  res.json(await Branch.find().lean());
});

app.get("/debug/prs", async (req, res) => {
  res.json(await PullRequest.find().lean());
});

app.get("/debug/comments", async (req, res) => {
  res.json(await Comment.find().lean());
});

app.get("/debug/reviews", async (req, res) => {
  res.json(await Review.find().lean());
});

app.get("/debug/sonar", async (req, res) => {
  res.json(await QualityGate.find().lean());
});

app.get("/debug/webhooks", async (req, res) => {
  res.json(await WebhookEvent.find().sort({ createdAt: -1 }).limit(100).lean());
});

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "ok",

    service: "Nexus GitHub + SonarQube Gateway",

    sonarUrl: process.env.SONAR_URL || "http://localhost:9000",

    mongodbConfigured: Boolean(process.env.MONGODB_URI),

    githubWebhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),

    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),

    sonarTokenConfigured: Boolean(process.env.SONAR_TOKEN),
  });
});

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

function resolveListenPort(port) {
  if (port !== undefined) {
    return port;
  }

  if (process.env.PORT !== undefined && process.env.PORT !== "") {
    return Number(process.env.PORT);
  }

  return 3000;
}

function startServer(port) {
  const resolvedPort = resolveListenPort(port);

  const server = app.listen(resolvedPort, () => {
    const boundPort = server.address().port;

    console.log(`🚀 Server running on http://localhost:${boundPort}`);

    console.log(
      "GitHub webhook secret:",
      Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    );

    console.log("GitHub token:", Boolean(process.env.GITHUB_TOKEN));

    console.log(
      "SonarQube URL:",
      process.env.SONAR_URL || "http://localhost:9000",
    );

    console.log("SonarQube token:", Boolean(process.env.SONAR_TOKEN));
  });

  return server;
}

async function boot(port) {
  await connectMongo();
  return startServer(port);
}

module.exports = {
  app,
  startServer,
  boot,
  resolveListenPort,
  resetStores,
  generateId,
  verifyGitHubSignature,
  githubRequest,
  getSonarQualityGate,
  extractFailedConditions,
  handlePullRequest,
  handleReviewComment,
  handlePullRequestReview,
  handleIssueComment,
  resolveBranchForQualityGate,
  applyQualityGateToBranch,
  Branch,
  PullRequest,
  Comment,
  Review,
  QualityGate,
  WebhookEvent,
};

/* c8 ignore start */
if (require.main === module) {
  boot().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
/* c8 ignore stop */
