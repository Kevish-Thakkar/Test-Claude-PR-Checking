const test = require("node:test");
const assert = require("node:assert");
const { setupTestDatabase, teardownTestDatabase } = require("./mongo");
const {
  startTestServer,
  request,
  mockFetchSequence,
  signPayload,
} = require("./helpers");

let app;
let startServer;
let boot;
let Branch;
let PullRequest;
let Comment;
let Review;
let QualityGate;
let WebhookEvent;
let resetStores;

test.before(async () => {
  await setupTestDatabase();
  process.env.GITHUB_WEBHOOK_SECRET = "route-webhook-secret";
  process.env.GITHUB_TOKEN = "ghp_route_token";
  process.env.SONAR_TOKEN = "sonar_route_token";
  process.env.SONAR_URL = "http://sonar.route.test";

  ({
    app,
    startServer,
    boot,
    Branch,
    PullRequest,
    Comment,
    Review,
    QualityGate,
    WebhookEvent,
    resetStores,
  } = require("../server"));
});

test.after(async () => {
  await teardownTestDatabase();
});

test.beforeEach(async () => {
  await resetStores();
});

function sonarStatusResponse(status = "OK") {
  return {
    json: {
      projectStatus: {
        status,
        conditions: [
          { status: "OK", metricKey: "coverage" },
          {
            status: "ERROR",
            metricKey: "bugs",
            actualValue: "1",
            errorThreshold: "0",
            comparator: "GT",
          },
        ],
      },
    },
  };
}

function githubPullRequestPayload(overrides = {}) {
  return {
    action: "opened",
    repository: { id: 101, full_name: "o/r" },
    pull_request: {
      id: 10001,
      number: 11,
      head: { ref: "feature/route", sha: "route-head-sha" },
      html_url: "https://github.com/o/r/pull/11",
    },
    ...overrides,
  };
}

async function postGitHubWebhook(baseUrl, event, payload, { secret } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = {
    "Content-Type": "application/json",
    "X-GitHub-Event": event,
    "X-GitHub-Delivery": "delivery-test-1",
  };
  if (secret !== null) {
    headers["X-Hub-Signature-256"] = signPayload(
      body,
      secret ?? process.env.GITHUB_WEBHOOK_SECRET,
    );
  }
  return request(baseUrl, "POST", "/webhooks/github", { headers, body });
}

test("GET / returns health payload", async () => {
  const ctx = await startTestServer(app);
  try {
    const res = await request(ctx.baseUrl, "GET", "/");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.status, "ok");
    assert.strictEqual(res.json.mongodbConfigured, true);
    assert.strictEqual(res.json.githubWebhookConfigured, true);

    const sonarUrl = process.env.SONAR_URL;
    delete process.env.SONAR_URL;
    const resDefaultSonar = await request(ctx.baseUrl, "GET", "/");
    assert.strictEqual(resDefaultSonar.json.sonarUrl, "http://localhost:9000");
    process.env.SONAR_URL = sonarUrl;
  } finally {
    await ctx.close();
  }
});

test("debug endpoints return collections", async () => {
  const branch = await Branch.create({
    taskId: "T-DBG",
    githubRepositoryId: 1,
    owner: "o",
    repo: "r",
    branchName: "feature/dbg",
  });
  await PullRequest.create({
    githubRepositoryId: 1,
    githubPrId: 1,
    githubPrNumber: 1,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
  });
  await Comment.create({
    taskId: branch.taskId,
    branchId: branch.id,
    githubRepositoryId: 1,
    githubPrId: 1,
    githubPrNumber: 1,
    githubCommentId: 1,
    body: "c",
  });
  await Review.create({
    taskId: branch.taskId,
    branchId: branch.id,
    githubRepositoryId: 1,
    githubPrId: 1,
    githubPrNumber: 1,
    githubReviewId: 1,
    reviewState: "APPROVED",
    reviewBody: "ok",
  });
  await QualityGate.create({
    taskId: branch.taskId,
    branchId: branch.id,
    status: "OK",
    passed: true,
    failed: false,
  });
  await WebhookEvent.create({
    source: "github",
    eventType: "ping",
    payload: {},
    processed: true,
  });

  const ctx = await startTestServer(app);
  try {
    for (const path of [
      "/debug/branches",
      "/debug/prs",
      "/debug/comments",
      "/debug/reviews",
      "/debug/sonar",
      "/debug/webhooks",
    ]) {
      const res = await request(ctx.baseUrl, "GET", path);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length >= 1);
    }
  } finally {
    await ctx.close();
  }
});

test("POST /webhooks/sonarqube success links branch by revision", async () => {
  const branch = await Branch.create({
    taskId: "T-SONAR",
    githubRepositoryId: 2,
    owner: "o",
    repo: "r",
    branchName: "feature/sonar",
    headSha: "rev-sha-1",
  });

  const restore = mockFetchSequence([sonarStatusResponse("OK")]);
  const ctx = await startTestServer(app);
  try {
    const res = await request(ctx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        analysisId: "analysis-1",
        revision: "rev-sha-1",
        project: { key: "proj-key", name: "Proj" },
        status: "SUCCESS",
        qualityGate: { status: "OK" },
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.branchId, branch.id);
    assert.strictEqual(res.json.qualityGate.passed, true);
    assert.strictEqual(res.json.qualityGate.failedConditions.length, 1);

    const updated = await Branch.findOne({ id: branch.id }).lean();
    assert.strictEqual(updated.latestQualityGatePassed, true);
  } finally {
    await ctx.close();
    restore();
  }
});

test("POST /webhooks/sonarqube missing project key and server error", async () => {
  const ctx = await startTestServer(app);
  try {
    const missing = await request(ctx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: { analysisId: "x" },
    });
    assert.strictEqual(missing.status, 400);
    assert.match(missing.json.message, /Project key/);
  } finally {
    await ctx.close();
  }

  const restore = mockFetchSequence([
    { ok: false, status: 502, text: "bad gateway" },
  ]);
  const ctx2 = await startTestServer(app);
  try {
    const err = await request(ctx2.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        analysisId: "a2",
        project: { key: "proj-key" },
      },
    });
    assert.strictEqual(err.status, 500);
    assert.match(err.json.message, /SonarQube API failed/);
  } finally {
    await ctx2.close();
    restore();
  }
});

test("POST /webhooks/sonarqube without revision still succeeds unmapped", async () => {
  const restore = mockFetchSequence([sonarStatusResponse("ERROR")]);
  const ctx = await startTestServer(app);
  try {
    const res = await request(ctx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        analysisId: "a3",
        project: { key: "proj-key" },
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.branchId, null);
    assert.strictEqual(res.json.qualityGate.passed, false);
  } finally {
    await ctx.close();
    restore();
  }
});

test("POST /webhooks/github signature and JSON validation", async () => {
  const ctx = await startTestServer(app);
  try {
    const badSig = await request(ctx.baseUrl, "POST", "/webhooks/github", {
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "ping",
        "X-Hub-Signature-256": "sha256=deadbeef",
      },
      body: Buffer.from("{}"),
    });
    assert.strictEqual(badSig.status, 401);

    const goodBody = Buffer.from("{not-json");
    const goodSigHeaders = {
      "Content-Type": "application/json",
      "X-GitHub-Event": "ping",
      "X-Hub-Signature-256": signPayload(
        goodBody,
        process.env.GITHUB_WEBHOOK_SECRET,
      ),
    };
    const badJson = await request(ctx.baseUrl, "POST", "/webhooks/github", {
      headers: goodSigHeaders,
      body: goodBody,
    });
    assert.strictEqual(badJson.status, 400);
  } finally {
    await ctx.close();
  }
});

test("POST /webhooks/github routes pull_request and ignored events", async () => {
  await Branch.create({
    taskId: "T-GH",
    githubRepositoryId: 101,
    owner: "o",
    repo: "r",
    branchName: "feature/route",
  });

  const ctx = await startTestServer(app);
  try {
    const pr = await postGitHubWebhook(
      ctx.baseUrl,
      "pull_request",
      githubPullRequestPayload(),
    );
    assert.strictEqual(pr.status, 200);
    assert.strictEqual(pr.json.success, true);

    const mapped = await PullRequest.findOne({ githubPrId: 10001 }).lean();
    assert.ok(mapped);

    const ignored = await postGitHubWebhook(ctx.baseUrl, "ping", { zen: true });
    assert.strictEqual(ignored.status, 200);
  } finally {
    await ctx.close();
  }
});

test("POST /webhooks/github review comment, review, and issue_comment", async () => {
  const branch = await Branch.create({
    taskId: "T-EV",
    githubRepositoryId: 202,
    owner: "o",
    repo: "r",
    branchName: "feature/ev",
  });
  await PullRequest.create({
    githubRepositoryId: 202,
    githubPrId: 20202,
    githubPrNumber: 22,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
  });

  const ctx = await startTestServer(app);
  try {
    const issueOnly = await postGitHubWebhook(ctx.baseUrl, "issue_comment", {
      issue: { number: 1 },
      repository: { full_name: "o/r" },
      comment: { id: 1, body: "x" },
    });
    assert.strictEqual(issueOnly.status, 200);

    const prComment = await postGitHubWebhook(ctx.baseUrl, "issue_comment", {
      issue: {
        number: 22,
        pull_request: { url: "https://api.github.com/pulls/22" },
      },
      repository: { full_name: "o/r" },
      comment: { id: 2, user: { login: "dev" }, body: "on pr" },
    });
    assert.strictEqual(prComment.status, 200);

    const reviewComment = await postGitHubWebhook(
      ctx.baseUrl,
      "pull_request_review_comment",
      {
        action: "created",
        repository: { id: 202, full_name: "o/r" },
        pull_request: { id: 20202, number: 22 },
        comment: {
          id: 55,
          user: { login: "claude" },
          path: "x.js",
          line: 1,
          body: "note",
        },
      },
    );
    assert.strictEqual(reviewComment.status, 200);
    assert.ok(await Comment.findOne({ githubCommentId: 55 }).lean());

    const review = await postGitHubWebhook(ctx.baseUrl, "pull_request_review", {
      action: "submitted",
      repository: { id: 202, full_name: "o/r" },
      pull_request: { id: 20202, number: 22 },
      review: {
        id: 66,
        user: { login: "claude" },
        state: "COMMENTED",
        body: "review body",
      },
    });
    assert.strictEqual(review.status, 200);
    assert.ok(await Review.findOne({ githubReviewId: 66 }).lean());
  } finally {
    await ctx.close();
  }
});

test("POST /nexus/branches validation, token, success, and errors", async () => {
  const ctx = await startTestServer(app);
  try {
    const missing = await request(ctx.baseUrl, "POST", "/nexus/branches", {
      body: { taskId: "T" },
    });
    assert.strictEqual(missing.status, 400);

    const token = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const noToken = await request(ctx.baseUrl, "POST", "/nexus/branches", {
      body: {
        taskId: "T1",
        owner: "o",
        repo: "r",
        branchName: "feature/new",
      },
    });
    assert.strictEqual(noToken.status, 500);
    process.env.GITHUB_TOKEN = token;
  } finally {
    await ctx.close();
  }

  const restore = mockFetchSequence([
    { json: { id: 999, full_name: "o/r", default_branch: "main" } },
    { json: { object: { sha: "base-sha-99" } } },
    { json: { ref: "refs/heads/feature/new", object: { sha: "base-sha-99" } } },
  ]);
  const ctx2 = await startTestServer(app);
  try {
    const ok = await request(ctx2.baseUrl, "POST", "/nexus/branches", {
      body: {
        taskId: "T-NEW",
        owner: "o",
        repo: "r",
        branchName: "feature/new",
      },
    });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.json.branch.taskId, "T-NEW");
    assert.ok(await Branch.findOne({ taskId: "T-NEW" }).lean());
  } finally {
    await ctx2.close();
    restore();
  }

  const restoreErr = mockFetchSequence([
    { ok: false, status: 404, text: "repo missing" },
  ]);
  const ctx3 = await startTestServer(app);
  try {
    const fail = await request(ctx3.baseUrl, "POST", "/nexus/branches", {
      body: {
        taskId: "T-FAIL",
        owner: "o",
        repo: "missing",
        branchName: "feature/x",
      },
    });
    assert.strictEqual(fail.status, 500);
  } finally {
    await ctx3.close();
    restoreErr();
  }
});

test("POST /nexus/quality-gate validates, 404s, and correlates by PR and SHA", async () => {
  const ctx = await startTestServer(app);
  try {
    const bad = await request(ctx.baseUrl, "POST", "/nexus/quality-gate", {
      body: { githubRepositoryId: 1 },
    });
    assert.strictEqual(bad.status, 400);

    const missing = await request(ctx.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 55,
        githubPrId: 999,
        status: "OK",
      },
    });
    assert.strictEqual(missing.status, 404);
  } finally {
    await ctx.close();
  }

  const branch = await Branch.create({
    taskId: "T-NQG",
    githubRepositoryId: 303,
    owner: "o",
    repo: "r",
    branchName: "feature/nqg",
    headSha: "nqg-sha",
  });
  await PullRequest.create({
    githubRepositoryId: 303,
    githubPrId: 30303,
    githubPrNumber: 30,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
    headSha: "nqg-sha",
  });

  const ctx2 = await startTestServer(app);
  try {
    const byPr = await request(ctx2.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 303,
        githubPrId: 30303,
        status: "OK",
        sonarProjectKey: "proj",
      },
    });
    assert.strictEqual(byPr.status, 201);
    assert.strictEqual(byPr.json.matchedBy, "pull_request");

    const bySha = await request(ctx2.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 303,
        revision: "nqg-sha",
        status: "ERROR",
        failedConditions: [{ metric: "bugs" }],
      },
    });
    assert.strictEqual(bySha.status, 201);
    assert.strictEqual(bySha.json.matchedBy, "commit_sha");
    assert.strictEqual(bySha.json.task.failed, true);
  } finally {
    await ctx2.close();
  }
});

test("POST /nexus/quality-gate defaults empty status to ERROR", async () => {
  const branch = await Branch.create({
    taskId: "T-EMPTY",
    githubRepositoryId: 4044,
    owner: "o",
    repo: "r",
    branchName: "feature/empty-status",
    headSha: "empty-status-sha",
  });
  await PullRequest.create({
    githubRepositoryId: 4044,
    githubPrId: 404404,
    githubPrNumber: 44,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
    headSha: "empty-status-sha",
  });

  const ctx = await startTestServer(app);
  try {
    const res = await request(ctx.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 4044,
        githubPrId: 404404,
        commitSha: "empty-status-sha",
        sonarProjectKey: "",
        sonarTaskId: "",
        sonarAnalysisId: "",
        status: "",
        failedConditions: [],
      },
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.task.status, "ERROR");
    assert.strictEqual(res.json.task.passed, false);
    assert.strictEqual(res.json.task.failed, true);

    const stored = await QualityGate.findOne({ branchId: branch.id }).lean();
    assert.strictEqual(stored.status, "ERROR");
    assert.strictEqual(stored.sonarProjectKey, null);
  } finally {
    await ctx.close();
  }
});

test("POST /nexus/quality-gate coerces non-array failedConditions to []", async () => {
  const branch = await Branch.create({
    taskId: "T-FC",
    githubRepositoryId: 5055,
    owner: "o",
    repo: "r",
    branchName: "feature/fc",
    headSha: "fc-sha",
  });
  await PullRequest.create({
    githubRepositoryId: 5055,
    githubPrId: 505505,
    githubPrNumber: 55,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
    headSha: "fc-sha",
  });

  const ctx = await startTestServer(app);
  try {
    const res = await request(ctx.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 5055,
        githubPrId: 505505,
        commitSha: "fc-sha",
        status: "ERROR",
        failedConditions: null,
      },
    });

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.json.task.failedConditions, []);

    const stored = await QualityGate.findOne({ branchId: branch.id }).lean();
    assert.deepStrictEqual(stored.failedConditions, []);
  } finally {
    await ctx.close();
  }
});

test("GET branch quality-gate and comments endpoints", async () => {
  const branch = await Branch.create({
    taskId: "T-GET",
    githubRepositoryId: 404,
    owner: "o",
    repo: "r",
    branchName: "feature/get",
    headSha: "get-sha",
    latestQualityGateStatus: "OK",
    latestQualityGatePassed: true,
  });
  await QualityGate.create({
    taskId: branch.taskId,
    branchId: branch.id,
    status: "OK",
    passed: true,
    failed: false,
  });
  await Comment.create({
    taskId: branch.taskId,
    branchId: branch.id,
    githubRepositoryId: 404,
    githubPrId: 1,
    githubPrNumber: 1,
    githubCommentId: 99,
    body: "stored",
  });

  const ctx = await startTestServer(app);
  try {
    const missing = await request(
      ctx.baseUrl,
      "GET",
      "/nexus/branches/not-there/quality-gate",
    );
    assert.strictEqual(missing.status, 404);

    const qg = await request(
      ctx.baseUrl,
      "GET",
      `/nexus/branches/${branch.id}/quality-gate`,
    );
    assert.strictEqual(qg.status, 200);
    assert.strictEqual(qg.json.passed, true);
    assert.ok(qg.json.history.length >= 1);

    const comments = await request(
      ctx.baseUrl,
      "GET",
      `/nexus/branches/${branch.id}/comments`,
    );
    assert.strictEqual(comments.status, 200);
    assert.strictEqual(comments.json.comments[0].body, "stored");
  } finally {
    await ctx.close();
  }
});

test("startServer and boot listen then close", async () => {
  const sonarUrl = process.env.SONAR_URL;
  delete process.env.SONAR_URL;

  const server = startServer(0);
  await new Promise((resolve) => server.once("listening", resolve));
  await new Promise((resolve) => server.close(resolve));

  const booted = await boot(0);
  await new Promise((resolve) => booted.once("listening", resolve));
  await new Promise((resolve) => booted.close(resolve));

  process.env.SONAR_URL = sonarUrl;
});

test("sonarqube webhook optional fields and no failed conditions", async () => {
  const restore = mockFetchSequence([
    {
      json: {
        projectStatus: {},
      },
    },
    {
      json: {
        projectStatus: {
          status: "OK",
          conditions: [{ status: "OK", metricKey: "coverage" }],
        },
      },
    },
  ]);
  const ctx = await startTestServer(app);
  try {
    const missingStatus = await request(ctx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj-key", name: "Proj" },
      },
    });
    assert.strictEqual(missingStatus.status, 200);
    assert.strictEqual(missingStatus.json.qualityGate.passed, false);

    const res = await request(ctx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj-key", name: "Proj" },
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.qualityGate.failedConditions.length, 0);
  } finally {
    await ctx.close();
    restore();
  }
});

test("POST /webhooks/github without delivery id and handler failure", async () => {
  await Branch.create({
    taskId: "T-FAIL-GH",
    githubRepositoryId: 909,
    owner: "o",
    repo: "r",
    branchName: "feature/fail-gh",
  });

  const ctx = await startTestServer(app);
  try {
    const body = Buffer.from(JSON.stringify(githubPullRequestPayload({
      repository: { id: 909, full_name: "o/r" },
      pull_request: {
        id: 90909,
        number: 90,
        head: { ref: "feature/fail-gh", sha: "fail-sha" },
        html_url: "https://github.com/o/r/pull/90",
      },
    })));
    const headers = {
      "Content-Type": "application/json",
      "X-GitHub-Event": "pull_request",
      "X-Hub-Signature-256": signPayload(body, process.env.GITHUB_WEBHOOK_SECRET),
    };
    const okDelivery = await request(ctx.baseUrl, "POST", "/webhooks/github", {
      headers,
      body,
    });
    assert.strictEqual(okDelivery.status, 200);

    const originalCreate = PullRequest.create;
    PullRequest.create = async () => {
      throw new Error("forced pr create failure");
    };
    const body2 = Buffer.from(JSON.stringify(githubPullRequestPayload({
      repository: { id: 909, full_name: "o/r" },
      pull_request: {
        id: 90910,
        number: 91,
        head: { ref: "feature/fail-gh", sha: "fail-sha-2" },
        html_url: "https://github.com/o/r/pull/91",
      },
    })));
    const fail = await request(ctx.baseUrl, "POST", "/webhooks/github", {
      headers: {
        ...headers,
        "X-Hub-Signature-256": signPayload(body2, process.env.GITHUB_WEBHOOK_SECRET),
      },
      body: body2,
    });
    PullRequest.create = originalCreate;
    assert.strictEqual(fail.status, 500);
    assert.match(fail.json.message, /forced pr create failure/);
  } finally {
    await ctx.close();
  }
});

test("POST /nexus/quality-gate 404 by sha and 500 on persistence error", async () => {
  const ctx = await startTestServer(app);
  try {
    const missingSha = await request(ctx.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 77,
        commitSha: "unknown-sha",
        status: "OK",
      },
    });
    assert.strictEqual(missingSha.status, 404);
    assert.strictEqual(missingSha.json.githubPrId, null);
  } finally {
    await ctx.close();
  }

  const branch = await Branch.create({
    taskId: "T-QG-500",
    githubRepositoryId: 808,
    owner: "o",
    repo: "r",
    branchName: "feature/qg500",
    headSha: "qg500-sha",
  });
  await PullRequest.create({
    githubRepositoryId: 808,
    githubPrId: 80808,
    githubPrNumber: 80,
    taskId: branch.taskId,
    branchId: branch.id,
    branchName: branch.branchName,
    headSha: "qg500-sha",
  });

  await Branch.create({
    taskId: "T-NO-PR",
    githubRepositoryId: 809,
    owner: "o",
    repo: "r",
    branchName: "feature/no-pr",
    headSha: "solo-sha-only",
  });

  const ctx2 = await startTestServer(app);
  try {
    const byShaOnly = await request(ctx2.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 809,
        commitSha: "solo-sha-only",
        status: "OK",
      },
    });
    assert.strictEqual(byShaOnly.status, 201);
    assert.strictEqual(byShaOnly.json.task.githubPrId, null);

    const byShaWithPr = await request(ctx2.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 808,
        commitSha: "qg500-sha",
        status: "OK",
      },
    });
    assert.strictEqual(byShaWithPr.status, 201);
    assert.strictEqual(byShaWithPr.json.task.githubPrId, 80808);

    const originalCreate = QualityGate.create;
    QualityGate.create = async () => {
      throw new Error("forced quality gate failure");
    };
    const fail = await request(ctx2.baseUrl, "POST", "/nexus/quality-gate", {
      body: {
        githubRepositoryId: 808,
        githubPrId: 80808,
        status: "OK",
      },
    });
    QualityGate.create = originalCreate;
    assert.strictEqual(fail.status, 500);
  } finally {
    await ctx2.close();
  }
});

test("GET branch endpoints return 500 when database throws", async () => {
  const branch = await Branch.create({
    taskId: "T-ERR",
    githubRepositoryId: 505,
    owner: "o",
    repo: "r",
    branchName: "feature/err",
  });

  const ctx = await startTestServer(app);
  try {
    const originalFindOne = Branch.findOne;
    Branch.findOne = () => ({
      lean: async () => {
        throw new Error("forced branch lookup failure");
      },
    });
    const qg = await request(
      ctx.baseUrl,
      "GET",
      `/nexus/branches/${branch.id}/quality-gate`,
    );
    Branch.findOne = originalFindOne;
    assert.strictEqual(qg.status, 500);

    Branch.findOne = () => ({
      lean: async () => branch.toObject(),
    });
    const originalQgFind = QualityGate.find;
    QualityGate.find = () => ({
      sort: () => ({
        lean: async () => {
          throw new Error("forced quality gate history failure");
        },
      }),
    });
    const qgHistory = await request(
      ctx.baseUrl,
      "GET",
      `/nexus/branches/${branch.id}/quality-gate`,
    );
    QualityGate.find = originalQgFind;
    Branch.findOne = originalFindOne;
    assert.strictEqual(qgHistory.status, 500);

    const originalCommentFind = Comment.find;
    Comment.find = () => ({
      sort: () => ({
        lean: async () => {
          throw new Error("forced comment lookup failure");
        },
      }),
    });
    const comments = await request(
      ctx.baseUrl,
      "GET",
      `/nexus/branches/${branch.id}/comments`,
    );
    Comment.find = originalCommentFind;
    assert.strictEqual(comments.status, 500);
  } finally {
    await ctx.close();
  }
});
