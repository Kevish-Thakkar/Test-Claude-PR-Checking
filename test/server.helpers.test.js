const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.GITHUB_TOKEN = "gh-token";
process.env.SONAR_TOKEN = "sonar-token";
process.env.SONAR_URL = "http://sonar.test";

const {
  generateId,
  verifyGitHubSignature,
  githubRequest,
  getSonarQualityGate,
  extractFailedConditions,
  handlePullRequest,
  handleReviewComment,
  handlePullRequestReview,
  handleIssueComment,
  resolveListenPort,
  resetStores,
  nexusBranches,
  githubPullRequests,
  claudeComments,
  claudeReviews,
} = require("../server");

const { mockFetchSequence, signPayload } = require("./helpers");

test.beforeEach(() => {
  resetStores();
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  process.env.GITHUB_TOKEN = "gh-token";
  process.env.SONAR_TOKEN = "sonar-token";
  process.env.SONAR_URL = "http://sonar.test";
});

test("generateId returns a UUID string", () => {
  const id = generateId();
  assert.match(id, /^[0-9a-f-]{36}$/i);
});

test("verifyGitHubSignature returns false when secret missing", () => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  assert.strictEqual(verifyGitHubSignature(Buffer.from("{}"), "sha256=abc"), false);
});

test("verifyGitHubSignature returns false when signature missing", () => {
  assert.strictEqual(verifyGitHubSignature(Buffer.from("{}"), undefined), false);
});

test("verifyGitHubSignature returns false when signature length mismatches", () => {
  assert.strictEqual(
    verifyGitHubSignature(Buffer.from("{}"), "sha256=short"),
    false,
  );
});

test("verifyGitHubSignature accepts a valid signature", () => {
  const body = Buffer.from(JSON.stringify({ ok: true }));
  const signature = signPayload(body, "test-secret");
  assert.strictEqual(verifyGitHubSignature(body, signature), true);
});

test("verifyGitHubSignature rejects an invalid signature of equal length", () => {
  const body = Buffer.from(JSON.stringify({ ok: true }));
  const valid = signPayload(body, "test-secret");
  const invalid =
    "sha256=" + "0".repeat(valid.length - "sha256=".length);
  assert.strictEqual(verifyGitHubSignature(body, invalid), false);
});

test("githubRequest throws when token missing", async () => {
  delete process.env.GITHUB_TOKEN;
  await assert.rejects(
    () => githubRequest("https://api.github.com/repos/a/b"),
    /GITHUB_TOKEN is not configured/,
  );
});

test("githubRequest returns json on success", async () => {
  const restore = mockFetchSequence([{ ok: true, json: { id: 1 } }]);
  try {
    const result = await githubRequest("https://api.github.com/repos/a/b");
    assert.deepStrictEqual(result, { id: 1 });
  } finally {
    restore();
  }
});

test("githubRequest throws on non-ok response", async () => {
  const restore = mockFetchSequence([
    { ok: false, status: 404, text: "not found" },
  ]);
  try {
    await assert.rejects(
      () => githubRequest("https://api.github.com/repos/a/b"),
      /GitHub API failed: 404 not found/,
    );
  } finally {
    restore();
  }
});

test("getSonarQualityGate uses default SONAR_URL when unset", async () => {
  delete process.env.SONAR_URL;
  const restore = mockFetchSequence([
    async (url) => {
      assert.match(String(url), /^http:\/\/localhost:9000\//);
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
  try {
    const result = await getSonarQualityGate("proj");
    assert.deepStrictEqual(result, { projectStatus: { status: "OK" } });
  } finally {
    restore();
  }
});

test("getSonarQualityGate throws when token missing", async () => {
  delete process.env.SONAR_TOKEN;
  await assert.rejects(
    () => getSonarQualityGate("proj"),
    /SONAR_TOKEN is not configured/,
  );
});

test("githubRequest merges custom headers", async () => {
  const restore = mockFetchSequence([
    async (_url, options) => {
      assert.strictEqual(options.headers["Content-Type"], "application/json");
      assert.match(options.headers.Authorization, /^Bearer /);
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true };
        },
        async text() {
          return "";
        },
      };
    },
  ]);
  try {
    const result = await githubRequest("https://api.github.com/repos/a/b", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.deepStrictEqual(result, { ok: true });
  } finally {
    restore();
  }
});

test("handlePullRequest ignores missing repository or pull_request", () => {
  handlePullRequest({ action: "opened", pull_request: { id: 1 } });
  handlePullRequest({
    action: "opened",
    repository: { id: 1, full_name: "o/r" },
  });
  assert.strictEqual(githubPullRequests.length, 0);
});

test("getSonarQualityGate returns json on success", async () => {
  const restore = mockFetchSequence([
    { ok: true, json: { projectStatus: { status: "OK" } } },
  ]);
  try {
    const result = await getSonarQualityGate("proj");
    assert.deepStrictEqual(result, { projectStatus: { status: "OK" } });
  } finally {
    restore();
  }
});

test("getSonarQualityGate throws on non-ok response", async () => {
  const restore = mockFetchSequence([
    { ok: false, status: 500, text: "boom" },
  ]);
  try {
    await assert.rejects(
      () => getSonarQualityGate("proj"),
      /SonarQube API failed: 500 boom/,
    );
  } finally {
    restore();
  }
});

test("extractFailedConditions maps ERROR conditions and defaults", () => {
  assert.deepStrictEqual(extractFailedConditions(undefined), []);
  assert.deepStrictEqual(extractFailedConditions({}), []);

  const result = extractFailedConditions({
    conditions: [
      {
        status: "OK",
        metricKey: "coverage",
        actualValue: "90",
        errorThreshold: "80",
        comparator: "LT",
      },
      {
        status: "ERROR",
        metricKey: "bugs",
        // missing optional fields exercise ?? null / operator fallback
      },
      {
        status: "ERROR",
        metricKey: "smells",
        actualValue: "3",
        errorThreshold: "0",
        operator: "GT",
      },
    ],
  });

  assert.deepStrictEqual(result, [
    {
      metric: "bugs",
      status: "ERROR",
      actualValue: null,
      threshold: null,
      operator: null,
    },
    {
      metric: "smells",
      status: "ERROR",
      actualValue: "3",
      threshold: "0",
      operator: "GT",
    },
  ]);
});

test("handlePullRequest ignores invalid payload", () => {
  handlePullRequest({ action: "opened" });
  assert.strictEqual(githubPullRequests.length, 0);
});

test("handlePullRequest returns when no nexus branch", () => {
  handlePullRequest({
    action: "opened",
    repository: { id: 1, full_name: "o/r" },
    pull_request: {
      id: 10,
      number: 1,
      head: { ref: "feature/x", sha: "abc" },
      html_url: "https://example.com/pr/1",
    },
  });
  assert.strictEqual(githubPullRequests.length, 0);
});

test("handlePullRequest creates and updates PR mapping", () => {
  nexusBranches.push({
    id: "branch-1",
    taskId: "TASK-1",
    githubRepositoryId: 1,
    branchName: "feature/x",
  });

  handlePullRequest({
    action: "opened",
    repository: { id: 1, full_name: "o/r" },
    pull_request: {
      id: 10,
      number: 1,
      head: { ref: "feature/x", sha: "abc" },
      html_url: "https://example.com/pr/1",
    },
  });

  assert.strictEqual(githubPullRequests.length, 1);
  assert.strictEqual(githubPullRequests[0].taskId, "TASK-1");

  handlePullRequest({
    action: "synchronize",
    repository: { id: 1, full_name: "o/r" },
    pull_request: {
      id: 10,
      number: 1,
      head: { ref: "feature/x", sha: "def" },
      html_url: "https://example.com/pr/1",
    },
  });

  assert.strictEqual(githubPullRequests.length, 1);
  assert.strictEqual(githubPullRequests[0].headSha, "def");
});

test("handleReviewComment ignores non-created and incomplete payloads", () => {
  handleReviewComment({ action: "edited" });
  handleReviewComment({ action: "created" });
  assert.strictEqual(claudeComments.length, 0);
});

test("handleReviewComment returns when PR unmapped", () => {
  handleReviewComment({
    action: "created",
    repository: { id: 1, full_name: "o/r" },
    pull_request: { id: 10, number: 1 },
    comment: {
      id: 99,
      path: "a.js",
      line: 1,
      body: "note",
      user: { login: "claude" },
    },
  });
  assert.strictEqual(claudeComments.length, 0);
});

test("handleReviewComment stores mapped comment", () => {
  githubPullRequests.push({
    taskId: "TASK-1",
    branchId: "branch-1",
    githubRepositoryId: 1,
    githubPrId: 10,
  });

  handleReviewComment({
    action: "created",
    repository: { id: 1, full_name: "o/r" },
    pull_request: { id: 10, number: 1 },
    comment: {
      id: 99,
      path: "a.js",
      line: 1,
      body: "note",
      user: { login: "claude" },
    },
  });

  assert.strictEqual(claudeComments.length, 1);
  assert.strictEqual(claudeComments[0].author, "claude");
});

test("handlePullRequestReview ignores non-submitted and incomplete payloads", () => {
  handlePullRequestReview({ action: "dismissed" });
  handlePullRequestReview({ action: "submitted" });
  assert.strictEqual(claudeReviews.length, 0);
});

test("handlePullRequestReview returns when PR unmapped", () => {
  handlePullRequestReview({
    action: "submitted",
    repository: { id: 1, full_name: "o/r" },
    pull_request: { id: 10, number: 1 },
    review: {
      id: 5,
      state: "COMMENTED",
      body: "looks ok",
      user: { login: "claude" },
      submitted_at: "2026-01-01T00:00:00Z",
    },
  });
  assert.strictEqual(claudeReviews.length, 0);
});

test("handlePullRequestReview stores mapped review", () => {
  githubPullRequests.push({
    taskId: "TASK-1",
    branchId: "branch-1",
    githubRepositoryId: 1,
    githubPrId: 10,
  });

  handlePullRequestReview({
    action: "submitted",
    repository: { id: 1, full_name: "o/r" },
    pull_request: { id: 10, number: 1 },
    review: {
      id: 5,
      state: "COMMENTED",
      body: "looks ok",
      user: { login: "claude" },
      submitted_at: "2026-01-01T00:00:00Z",
    },
  });

  assert.strictEqual(claudeReviews.length, 1);
  assert.strictEqual(claudeReviews[0].reviewer, "claude");
});

test("handleIssueComment ignores non-PR issues and logs PR comments", () => {
  assert.strictEqual(
    handleIssueComment({ issue: { number: 1 } }),
    undefined,
  );
  assert.strictEqual(
    handleIssueComment({
      issue: { number: 2, pull_request: { url: "https://example.com" } },
      repository: { full_name: "o/r" },
      comment: { id: 1, body: "hi", user: { login: "user" } },
    }),
    undefined,
  );
});

test("resolveListenPort prefers explicit port, then env, then 3000", () => {
  assert.strictEqual(resolveListenPort(0), 0);
  assert.strictEqual(resolveListenPort(8080), 8080);

  process.env.PORT = "0";
  assert.strictEqual(resolveListenPort(), 0);

  process.env.PORT = "";
  assert.strictEqual(resolveListenPort(), 3000);

  delete process.env.PORT;
  assert.strictEqual(resolveListenPort(), 3000);
});
