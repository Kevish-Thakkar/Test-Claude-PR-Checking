const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { setupTestDatabase, teardownTestDatabase } = require("./mongo");
const { mockFetchSequence, signPayload } = require("./helpers");

let serverModule;

test.before(async () => {
  await setupTestDatabase();
  process.env.GITHUB_WEBHOOK_SECRET = "helper-webhook-secret";
  process.env.GITHUB_TOKEN = "ghp_test_token";
  process.env.SONAR_TOKEN = "sonar_test_token";
  process.env.SONAR_URL = "http://sonar.test";
  delete process.env.PORT;

  serverModule = require("../server");
});

test.after(async () => {
  await teardownTestDatabase();
});

test.beforeEach(async () => {
  await serverModule.resetStores();
});

test("generateId returns a UUID", () => {
  const id = serverModule.generateId();
  assert.match(id, /^[0-9a-f-]{36}$/i);
});

test("verifyGitHubSignature covers all branches", () => {
  const { verifyGitHubSignature } = serverModule;
  const body = Buffer.from('{"ok":true}');
  const goodSig = signPayload(body, process.env.GITHUB_WEBHOOK_SECRET);

  assert.strictEqual(verifyGitHubSignature(body, goodSig), true);

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  delete process.env.GITHUB_WEBHOOK_SECRET;
  assert.strictEqual(verifyGitHubSignature(body, goodSig), false);
  process.env.GITHUB_WEBHOOK_SECRET = secret;

  assert.strictEqual(verifyGitHubSignature(body, undefined), false);
  assert.strictEqual(verifyGitHubSignature(body, "sha256=short"), false);

  const badSameLength = `sha256=${"a".repeat(goodSig.length - 7)}`;
  assert.strictEqual(verifyGitHubSignature(body, badSameLength), false);
});

test("githubRequest succeeds and fails appropriately", async () => {
  const restore = mockFetchSequence([
    { json: { id: 99, full_name: "o/r" } },
    { ok: false, status: 403, text: "nope" },
  ]);

  const ok = await serverModule.githubRequest("https://api.github.com/repos/o/r");
  assert.strictEqual(ok.id, 99);

  await assert.rejects(
    () => serverModule.githubRequest("https://api.github.com/x"),
    /GitHub API failed: 403/,
  );

  const token = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  await assert.rejects(
    () => serverModule.githubRequest("https://api.github.com/y"),
    /GITHUB_TOKEN/,
  );
  process.env.GITHUB_TOKEN = token;

  restore();
});

test("getSonarQualityGate succeeds and fails appropriately", async () => {
  const restore = mockFetchSequence([
    { json: { projectStatus: { status: "OK" } } },
    { ok: false, status: 500, text: "sonar down" },
  ]);

  const ok = await serverModule.getSonarQualityGate("my-project");
  assert.strictEqual(ok.projectStatus.status, "OK");

  await assert.rejects(
    () => serverModule.getSonarQualityGate("my-project"),
    /SonarQube API failed: 500/,
  );

  const token = process.env.SONAR_TOKEN;
  delete process.env.SONAR_TOKEN;
  await assert.rejects(
    () => serverModule.getSonarQualityGate("x"),
    /SONAR_TOKEN/,
  );
  process.env.SONAR_TOKEN = token;

  restore();
});

test("extractFailedConditions maps ERROR conditions", () => {
  const { extractFailedConditions } = serverModule;

  assert.deepStrictEqual(extractFailedConditions(undefined), []);
  assert.deepStrictEqual(extractFailedConditions({ conditions: [] }), []);

  const failed = extractFailedConditions({
    conditions: [
      { status: "OK", metricKey: "coverage" },
      {
        status: "ERROR",
        metricKey: "bugs",
        actualValue: "2",
        errorThreshold: "0",
        comparator: "GT",
      },
      {
        status: "ERROR",
        metricKey: "smells",
        operator: "LT",
      },
    ],
  });

  assert.strictEqual(failed.length, 2);
  assert.strictEqual(failed[0].metric, "bugs");
  assert.strictEqual(failed[0].operator, "GT");
  assert.strictEqual(failed[1].operator, "LT");
  assert.strictEqual(failed[1].actualValue, null);

  const comparatorOnly = extractFailedConditions({
    conditions: [
      {
        status: "ERROR",
        metricKey: "duplications",
        comparator: "GT",
      },
    ],
  });
  assert.strictEqual(comparatorOnly[0].operator, "GT");
});

test("getSonarQualityGate uses default SONAR_URL when unset", async () => {
  const sonarUrl = process.env.SONAR_URL;
  delete process.env.SONAR_URL;

  const restore = mockFetchSequence([
    (input) => {
      assert.match(String(input), /localhost:9000/);
      return {
        ok: true,
        status: 200,
        async json() {
          return { projectStatus: { status: "OK" } };
        },
        async text() {
          return "";
        },
      };
    },
  ]);

  await serverModule.getSonarQualityGate("default-url-project");
  process.env.SONAR_URL = sonarUrl;
  restore();
});

test("resolveListenPort resolves explicit, env, and default", () => {
  const { resolveListenPort } = serverModule;

  assert.strictEqual(resolveListenPort(8080), 8080);

  process.env.PORT = "4001";
  assert.strictEqual(resolveListenPort(), 4001);

  process.env.PORT = "";
  assert.strictEqual(resolveListenPort(), 3000);

  delete process.env.PORT;
  assert.strictEqual(resolveListenPort(), 3000);
});

test("handlePullRequest paths", async () => {
  const { handlePullRequest, Branch, PullRequest } = serverModule;

  await handlePullRequest({});
  await handlePullRequest({ repository: {}, pull_request: {} });

  await Branch.create({
    taskId: "T-PR",
    githubRepositoryId: 42,
    owner: "o",
    repo: "r",
    branchName: "feature/pr",
  });

  await handlePullRequest({
    action: "opened",
    repository: { id: 42, full_name: "o/r" },
    pull_request: {
      id: 9001,
      number: 7,
      head: { ref: "feature/missing", sha: "sha-m" },
      html_url: "https://github.com/o/r/pull/7",
    },
  });

  await handlePullRequest({
    action: "opened",
    repository: { id: 42, full_name: "o/r" },
    pull_request: {
      id: 9003,
      number: 9,
      head: { ref: "feature/pr" },
      html_url: "https://github.com/o/r/pull/9",
    },
  });

  await handlePullRequest({
    action: "opened",
    repository: { id: 42, full_name: "o/r" },
    pull_request: {
      id: 9002,
      number: 8,
      head: { ref: "feature/pr", sha: "head-sha-1" },
      html_url: "https://github.com/o/r/pull/8",
    },
  });

  const created = await PullRequest.findOne({ githubPrId: 9002 }).lean();
  assert.ok(created);
  assert.strictEqual(created.headSha, "head-sha-1");

  await handlePullRequest({
    action: "synchronize",
    repository: { id: 42, full_name: "o/r" },
    pull_request: {
      id: 9002,
      number: 8,
      head: { ref: "feature/pr", sha: "head-sha-2" },
      html_url: "https://github.com/o/r/pull/8",
    },
  });

  const updated = await PullRequest.findOne({ githubPrId: 9002 }).lean();
  assert.strictEqual(updated.headSha, "head-sha-2");
});

test("handleReviewComment paths", async () => {
  const { handleReviewComment, Branch, PullRequest, Comment } = serverModule;

  await handleReviewComment({ action: "edited" });
  await handleReviewComment({ action: "created" });

  const branch = await Branch.create({
    taskId: "T-CMT",
    githubRepositoryId: 50,
    owner: "o",
    repo: "r",
    branchName: "feature/cmt",
  });

  await PullRequest.create({
    githubRepositoryId: 50,
    githubPrId: 500,
    githubPrNumber: 5,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
    headSha: "cmt-sha",
  });

  await handleReviewComment({
    action: "created",
    repository: { id: 50, full_name: "o/r" },
    pull_request: { id: 501, number: 6 },
    comment: { id: 1, path: "a.js", line: 1, body: "x" },
  });

  await handleReviewComment({
    action: "created",
    repository: { id: 50, full_name: "o/r" },
    pull_request: { id: 500, number: 5 },
    comment: {
      id: 77,
      user: { login: "claude" },
      path: "src/a.js",
      line: 10,
      body: "fix this",
    },
  });

  const stored = await Comment.findOne({ githubCommentId: 77 }).lean();
  assert.ok(stored);
  assert.strictEqual(stored.author, "claude");
});

test("handlePullRequestReview paths", async () => {
  const { handlePullRequestReview, Branch, PullRequest, Review } = serverModule;

  await handlePullRequestReview({ action: "edited" });
  await handlePullRequestReview({ action: "submitted" });

  const branch = await Branch.create({
    taskId: "T-REV",
    githubRepositoryId: 60,
    owner: "o",
    repo: "r",
    branchName: "feature/rev",
  });

  await PullRequest.create({
    githubRepositoryId: 60,
    githubPrId: 600,
    githubPrNumber: 6,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
  });

  await handlePullRequestReview({
    action: "submitted",
    repository: { id: 60, full_name: "o/r" },
    pull_request: { id: 601, number: 7 },
    review: { id: 1, state: "COMMENTED", body: "h" },
  });

  await handlePullRequestReview({
    action: "submitted",
    repository: { id: 60, full_name: "o/r" },
    pull_request: { id: 600, number: 6 },
    review: {
      id: 88,
      user: { login: "claude-bot" },
      state: "CHANGES_REQUESTED",
      body: "please fix",
      submitted_at: "2024-01-01T00:00:00Z",
    },
  });

  const stored = await Review.findOne({ githubReviewId: 88 }).lean();
  assert.ok(stored);
  assert.strictEqual(stored.reviewState, "CHANGES_REQUESTED");
});

test("handleIssueComment ignores non-PR and logs PR comments", async () => {
  const { handleIssueComment } = serverModule;

  await handleIssueComment({ issue: { number: 1 } });

  await handleIssueComment({
    issue: { number: 2, pull_request: { url: "https://api.github.com/pulls/2" } },
    repository: { full_name: "o/r" },
    comment: { id: 3, user: { login: "dev" }, body: "hello" },
  });
});

test("resolveBranchForQualityGate and applyQualityGateToBranch via exports", async () => {
  const {
    resolveBranchForQualityGate,
    applyQualityGateToBranch,
    Branch,
    PullRequest,
    QualityGate,
  } = serverModule;

  const branch = await Branch.create({
    taskId: "T-QG",
    githubRepositoryId: 70,
    owner: "o",
    repo: "r",
    branchName: "feature/qg",
    headSha: "commit-match",
  });

  await PullRequest.create({
    githubRepositoryId: 70,
    githubPrId: 700,
    githubPrNumber: 70,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
    headSha: "commit-match",
  });

  const byPr = await resolveBranchForQualityGate({
    githubRepositoryId: 70,
    githubPrId: 700,
  });
  assert.strictEqual(byPr.matchedBy, "pull_request");

  const bySha = await resolveBranchForQualityGate({
    githubRepositoryId: 70,
    commitSha: "commit-match",
  });
  assert.strictEqual(bySha.matchedBy, "commit_sha");

  const report = await QualityGate.create({
    taskId: branch.taskId,
    branchId: branch.id,
    status: "ERROR",
    passed: false,
    failed: true,
    commitSha: "commit-match",
    revision: "commit-match",
    failedConditions: [],
  });

  const updated = await applyQualityGateToBranch(branch, report);
  assert.strictEqual(updated.latestQualityGatePassed, false);
  assert.strictEqual(updated.latestQualityGateStatus, "ERROR");
});
