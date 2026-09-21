const test = require("node:test");
const assert = require("node:assert");
const { MongoMemoryServer } = require("mongodb-memory-server");
const {
  connectMongo,
  disconnectMongo,
  mongoose,
} = require("../src/db/connect");
const {
  logWebhookEvent,
  markWebhookProcessed,
  applyQualityGateToBranch,
} = require("../src/services/persistence");
const { Branch, WebhookEvent, QualityGate } = require("../src/models");

let memoryServer;

test.before(async () => {
  memoryServer = await MongoMemoryServer.create();
  await connectMongo(memoryServer.getUri());
});

test.after(async () => {
  await disconnectMongo();
  await memoryServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Branch.deleteMany({}),
    WebhookEvent.deleteMany({}),
    QualityGate.deleteMany({}),
  ]);
});

test("connectMongo reuses in-flight connection promise", async () => {
  await disconnectMongo();
  const uri = memoryServer.getUri();
  const first = connectMongo(uri);
  const second = connectMongo(uri);
  const [a, b] = await Promise.all([first, second]);
  assert.ok(a);
  assert.ok(b);
  assert.strictEqual(mongoose.connection.readyState, 1);
});

test("logWebhookEvent defaults optional fields", async () => {
  const event = await logWebhookEvent({
    source: "sonarqube",
    payload: { hello: true },
  });
  assert.strictEqual(event.eventType, null);
  assert.strictEqual(event.deliveryId, null);
});

test("applyQualityGateToBranch uses revision when commitSha missing", async () => {
  const branch = await Branch.create({
    taskId: "T3",
    githubRepositoryId: 5,
    owner: "o",
    repo: "r",
    branchName: "feature/c",
  });

  const report = await QualityGate.create({
    taskId: "T3",
    branchId: branch.id,
    status: "OK",
    passed: true,
    failed: false,
    revision: "only-revision",
  });

  const updated = await applyQualityGateToBranch(branch, report);
  assert.strictEqual(updated.headSha, "only-revision");
});

test("resolveBranchForQualityGate returns null when PR maps to missing branch", async () => {
  const { resolveBranchForQualityGate } = require("../src/services/persistence");
  const { PullRequest } = require("../src/models");

  await PullRequest.create({
    taskId: "TX",
    branchId: "missing-branch",
    githubRepositoryId: 3,
    githubPrId: 33,
    githubPrNumber: 1,
    branchName: "gone",
  });

  const result = await resolveBranchForQualityGate({
    githubRepositoryId: 3,
    githubPrId: 33,
  });
  assert.strictEqual(result.branch, null);
  assert.strictEqual(result.matchedBy, null);
});

test("resolveBranchForQualityGate matches sha without repository id", async () => {
  const { resolveBranchForQualityGate } = require("../src/services/persistence");

  await Branch.create({
    id: "branch-sha-only",
    taskId: "TS",
    githubRepositoryId: 4,
    owner: "o",
    repo: "r",
    branchName: "feature/s",
    headSha: "solo-sha",
  });

  const result = await resolveBranchForQualityGate({
    commitSha: "solo-sha",
  });
  assert.strictEqual(result.matchedBy, "commit_sha");
  assert.strictEqual(result.branch.id, "branch-sha-only");
});

test("connectMongo throws when URI missing", async () => {
  await disconnectMongo();
  const previous = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;

  await assert.rejects(() => connectMongo(), /MONGODB_URI/);

  process.env.MONGODB_URI = previous;
  await connectMongo(memoryServer.getUri());
});

test("logWebhookEvent and markWebhookProcessed round-trip", async () => {
  const event = await logWebhookEvent({
    source: "github",
    eventType: "ping",
    deliveryId: "d-1",
    payload: { ok: true },
  });

  assert.strictEqual(event.processed, false);

  const ok = await markWebhookProcessed(event.id);
  assert.strictEqual(ok.processed, true);

  const failed = await markWebhookProcessed(event.id, "boom");
  assert.strictEqual(failed.processed, false);
  assert.strictEqual(failed.processingError, "boom");
});

test("applyQualityGateToBranch updates latest status fields", async () => {
  const branch = await Branch.create({
    taskId: "T1",
    githubRepositoryId: 1,
    owner: "o",
    repo: "r",
    branchName: "feature/a",
  });

  const report = await QualityGate.create({
    taskId: "T1",
    branchId: branch.id,
    status: "OK",
    passed: true,
    failed: false,
    commitSha: "sha-9",
    revision: "sha-9",
  });

  const updated = await applyQualityGateToBranch(branch, report);
  assert.strictEqual(updated.latestQualityGatePassed, true);
  assert.strictEqual(updated.latestQualityGateStatus, "OK");
  assert.strictEqual(updated.headSha, "sha-9");
});
