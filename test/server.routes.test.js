const test = require("node:test");
const assert = require("node:assert");

process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
process.env.GITHUB_TOKEN = "gh-token";
process.env.SONAR_TOKEN = "sonar-token";
process.env.SONAR_URL = "http://sonar.test";

const {
  app,
  resetStores,
  nexusBranches,
  githubPullRequests,
  sonarReports,
  startServer,
} = require("../server");

const {
  signPayload,
  startTestServer,
  request,
  mockFetchSequence,
} = require("./helpers");

let serverCtx;

test.before(async () => {
  serverCtx = await startTestServer(app);
});

test.after(async () => {
  await serverCtx.close();
});

test.beforeEach(() => {
  resetStores();
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  process.env.GITHUB_TOKEN = "gh-token";
  process.env.SONAR_TOKEN = "sonar-token";
  process.env.SONAR_URL = "http://sonar.test";
});

test("GET / health check", async () => {
  const res = await request(serverCtx.baseUrl, "GET", "/");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.status, "ok");
  assert.strictEqual(res.json.service, "Nexus GitHub + SonarQube Gateway");
  assert.strictEqual(res.json.githubWebhookConfigured, true);
  assert.strictEqual(res.json.githubTokenConfigured, true);
  assert.strictEqual(res.json.sonarTokenConfigured, true);
});

test("debug endpoints return empty arrays initially", async () => {
  for (const path of [
    "/debug/branches",
    "/debug/prs",
    "/debug/comments",
    "/debug/reviews",
    "/debug/sonar",
  ]) {
    const res = await request(serverCtx.baseUrl, "GET", path);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json, []);
  }
});

test("POST /webhooks/sonarqube rejects missing project key", async () => {
  const res = await request(serverCtx.baseUrl, "POST", "/webhooks/sonarqube", {
    body: { status: "SUCCESS" },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.message, "Project key missing");
});

test("POST /webhooks/sonarqube success with no failed conditions", async () => {
  const restore = mockFetchSequence([
    {
      ok: true,
      json: {
        projectStatus: {
          status: "OK",
          conditions: [
            {
              metricKey: "coverage",
              status: "OK",
              actualValue: "95",
              errorThreshold: "80",
              comparator: "LT",
            },
          ],
        },
      },
    },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj", name: "Proj" },
        analysisId: "a1",
        status: "SUCCESS",
        qualityGate: { status: "OK" },
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.qualityGate.passed, true);
    assert.strictEqual(res.json.qualityGate.failed, false);
    assert.strictEqual(sonarReports.length, 1);
  } finally {
    restore();
  }
});

test("POST /webhooks/sonarqube success with failed conditions", async () => {
  const restore = mockFetchSequence([
    {
      ok: true,
      json: {
        projectStatus: {
          status: "ERROR",
          conditions: [
            {
              metricKey: "bugs",
              status: "ERROR",
              actualValue: "2",
              errorThreshold: "0",
              operator: "GT",
            },
            {
              metricKey: "coverage",
              status: "OK",
              actualValue: "90",
              errorThreshold: "80",
              comparator: "LT",
            },
          ],
        },
      },
    },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj", name: "Proj" },
        analysisId: "a2",
        status: "SUCCESS",
        qualityGate: { status: "ERROR" },
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.qualityGate.passed, false);
    assert.strictEqual(res.json.qualityGate.failed, true);
    assert.strictEqual(res.json.qualityGate.failedConditions.length, 1);
    assert.strictEqual(res.json.qualityGate.failedConditions[0].metric, "bugs");
  } finally {
    restore();
  }
});

test("POST /webhooks/sonarqube returns 500 when sonar API fails", async () => {
  const restore = mockFetchSequence([
    { ok: false, status: 503, text: "unavailable" },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj", name: "Proj" },
        analysisId: "a3",
      },
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.json.success, false);
    assert.match(res.json.message, /SonarQube API failed/);
  } finally {
    restore();
  }
});

test("POST /webhooks/github rejects invalid signature", async () => {
  const body = Buffer.from(JSON.stringify({ action: "opened" }));
  const res = await request(serverCtx.baseUrl, "POST", "/webhooks/github", {
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "ping",
      "X-GitHub-Delivery": "d1",
      "X-Hub-Signature-256": "sha256=" + "a".repeat(64),
    },
    body,
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.message, "Invalid signature");
});

test("POST /webhooks/github rejects invalid JSON", async () => {
  const body = Buffer.from("{not-json");
  const signature = signPayload(body, "test-secret");
  const res = await request(serverCtx.baseUrl, "POST", "/webhooks/github", {
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "ping",
      "X-GitHub-Delivery": "d2",
      "X-Hub-Signature-256": signature,
    },
    body,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.message, "Invalid JSON");
});

test("POST /webhooks/github routes known events and ignores unknown", async () => {
  nexusBranches.push({
    id: "b1",
    taskId: "TASK-1",
    githubRepositoryId: 42,
    branchName: "feature/t",
  });

  async function postEvent(event, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    const signature = signPayload(body, "test-secret");
    return request(serverCtx.baseUrl, "POST", "/webhooks/github", {
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": event,
        "X-GitHub-Delivery": "d3",
        "X-Hub-Signature-256": signature,
      },
      body,
    });
  }

  const prRes = await postEvent("pull_request", {
    action: "opened",
    repository: { id: 42, full_name: "o/r" },
    pull_request: {
      id: 100,
      number: 7,
      head: { ref: "feature/t", sha: "sha1" },
      html_url: "https://example.com/pr/7",
    },
  });
  assert.strictEqual(prRes.status, 200);
  assert.strictEqual(githubPullRequests.length, 1);

  const commentRes = await postEvent("pull_request_review_comment", {
    action: "created",
    repository: { id: 42, full_name: "o/r" },
    pull_request: { id: 100, number: 7 },
    comment: {
      id: 1,
      path: "f.js",
      line: 2,
      body: "fix",
      user: { login: "claude" },
    },
  });
  assert.strictEqual(commentRes.status, 200);

  const reviewRes = await postEvent("pull_request_review", {
    action: "submitted",
    repository: { id: 42, full_name: "o/r" },
    pull_request: { id: 100, number: 7 },
    review: {
      id: 9,
      state: "COMMENTED",
      body: "done",
      user: { login: "claude" },
      submitted_at: "2026-01-01T00:00:00Z",
    },
  });
  assert.strictEqual(reviewRes.status, 200);

  const issueRes = await postEvent("issue_comment", {
    issue: { number: 7, pull_request: {} },
    repository: { full_name: "o/r" },
    comment: { id: 2, body: "thread", user: { login: "dev" } },
  });
  assert.strictEqual(issueRes.status, 200);

  const ignored = await postEvent("ping", { zen: "keep it simple" });
  assert.strictEqual(ignored.status, 200);
  assert.strictEqual(ignored.json.received, true);
});

test("POST /nexus/branches validates required fields", async () => {
  const res = await request(serverCtx.baseUrl, "POST", "/nexus/branches", {
    body: { taskId: "T1" },
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.json.message, /required/);
});

test("POST /nexus/branches returns 500 when token missing", async () => {
  delete process.env.GITHUB_TOKEN;
  const res = await request(serverCtx.baseUrl, "POST", "/nexus/branches", {
    body: {
      taskId: "T1",
      owner: "o",
      repo: "r",
      branchName: "feature/x",
    },
  });
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.json.message, "GITHUB_TOKEN is not configured");
});

test("POST /nexus/branches creates branch successfully", async () => {
  const restore = mockFetchSequence([
    {
      ok: true,
      json: { id: 55, full_name: "o/r", default_branch: "main" },
    },
    {
      ok: true,
      json: { object: { sha: "base-sha" } },
    },
    {
      ok: true,
      json: { ref: "refs/heads/feature/x", object: { sha: "base-sha" } },
    },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/nexus/branches", {
      body: {
        taskId: "TASK-99",
        owner: "o",
        repo: "r",
        branchName: "feature/x",
      },
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.branch.taskId, "TASK-99");
    assert.strictEqual(res.json.branch.githubRef, "refs/heads/feature/x");
    assert.strictEqual(nexusBranches.length, 1);
  } finally {
    restore();
  }
});

test("POST /nexus/branches returns 500 when GitHub API fails", async () => {
  const restore = mockFetchSequence([
    { ok: false, status: 403, text: "forbidden" },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/nexus/branches", {
      body: {
        taskId: "TASK-99",
        owner: "o",
        repo: "r",
        branchName: "feature/x",
      },
    });

    assert.strictEqual(res.status, 500);
    assert.match(res.json.message, /GitHub API failed/);
  } finally {
    restore();
  }
});

test("POST /nexus/quality-gate validates required ids", async () => {
  const res = await request(serverCtx.baseUrl, "POST", "/nexus/quality-gate", {
    body: { status: "OK" },
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.json.message, /required/);
});

test("POST /nexus/quality-gate returns 404 when PR unmapped", async () => {
  const res = await request(serverCtx.baseUrl, "POST", "/nexus/quality-gate", {
    body: {
      githubRepositoryId: 1,
      githubPrId: 2,
      status: "ERROR",
    },
  });
  assert.strictEqual(res.status, 404);
  assert.match(res.json.message, /not mapped/);
});

test("POST /nexus/quality-gate maps OK and ERROR statuses", async () => {
  githubPullRequests.push({
    taskId: "TASK-1",
    branchId: "branch-1",
    githubRepositoryId: 1,
    githubPrId: 2,
  });

  const okRes = await request(serverCtx.baseUrl, "POST", "/nexus/quality-gate", {
    body: {
      githubRepositoryId: 1,
      githubPrId: 2,
      commitSha: "abc",
      sonarProjectKey: "proj",
      sonarAnalysisId: "an1",
      status: "OK",
    },
  });

  assert.strictEqual(okRes.status, 201);
  assert.strictEqual(okRes.json.task.passed, true);
  assert.strictEqual(okRes.json.task.failed, false);

  const errRes = await request(
    serverCtx.baseUrl,
    "POST",
    "/nexus/quality-gate",
    {
      body: {
        githubRepositoryId: 1,
        githubPrId: 2,
        status: "ERROR",
        failedConditions: [{ metric: "bugs" }],
      },
    },
  );

  assert.strictEqual(errRes.status, 201);
  assert.strictEqual(errRes.json.task.passed, false);
  assert.strictEqual(errRes.json.task.failed, true);
  assert.strictEqual(errRes.json.task.failedConditions.length, 1);
  assert.strictEqual(sonarReports.length, 2);
});

test("POST /nexus/quality-gate catch path when lookup throws", async () => {
  const originalFind = githubPullRequests.find;
  githubPullRequests.find = () => {
    throw new Error("lookup failed");
  };

  try {
    const res = await request(
      serverCtx.baseUrl,
      "POST",
      "/nexus/quality-gate",
      {
        body: {
          githubRepositoryId: 1,
          githubPrId: 2,
          status: "OK",
        },
      },
    );
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.json.message, "lookup failed");
  } finally {
    githubPullRequests.find = originalFind;
  }
});

test("POST /webhooks/sonarqube handles empty projectStatus and sparse conditions", async () => {
  const restore = mockFetchSequence([
    {
      ok: true,
      json: {
        projectStatus: null,
      },
    },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj", name: "Proj" },
        analysisId: "sparse-1",
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.qualityGate.status, undefined);
    assert.strictEqual(res.json.qualityGate.passed, false);
  } finally {
    restore();
  }

  const restore2 = mockFetchSequence([
    {
      ok: true,
      json: {
        projectStatus: {
          status: "OK",
          conditions: [
            { metricKey: "coverage", status: "OK" },
            {
              metricKey: "bugs",
              status: "OK",
              operator: "GT",
            },
          ],
        },
      },
    },
  ]);

  try {
    const res = await request(serverCtx.baseUrl, "POST", "/webhooks/sonarqube", {
      body: {
        project: { key: "proj", name: "Proj" },
        analysisId: "sparse-2",
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(sonarReports.at(-1).conditions[0].actualValue, null);
    assert.strictEqual(sonarReports.at(-1).conditions[0].operator, null);
    assert.strictEqual(sonarReports.at(-1).conditions[1].operator, "GT");
  } finally {
    restore2();
  }
});

test("GET / uses default sonar URL and unset flags", async () => {
  delete process.env.SONAR_URL;
  delete process.env.GITHUB_WEBHOOK_SECRET;
  delete process.env.GITHUB_TOKEN;
  delete process.env.SONAR_TOKEN;

  const res = await request(serverCtx.baseUrl, "GET", "/");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.sonarUrl, "http://localhost:9000");
  assert.strictEqual(res.json.githubWebhookConfigured, false);
  assert.strictEqual(res.json.githubTokenConfigured, false);
  assert.strictEqual(res.json.sonarTokenConfigured, false);
});

test("startServer binds and can be closed", async () => {
  delete process.env.SONAR_URL;
  const listening = startServer(0);
  await new Promise((resolve, reject) => {
    listening.once("error", reject);
    listening.once("listening", () => setImmediate(resolve));
    if (listening.listening) {
      setImmediate(resolve);
    }
  });
  assert.strictEqual(listening.listening, true);
  assert.ok(listening.address().port > 0);
  await new Promise((resolve) => listening.close(resolve));
  assert.strictEqual(listening.listening, false);
});
