const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePendingSessions,
  parseApiData,
} = require("../dist/api/response.validation");
const { loadWorkerConfig } = require("../dist/config/worker.config");
const { WorkerApiClient } = require("../dist/api/worker-api.client");
const { Worker } = require("../dist/runtime/worker");

test("validates external session states and identifiers", () => {
  assert.deepEqual(
    parsePendingSessions([{ userId: "user-1", status: "READY" }]),
    [{ userId: "user-1", status: "READY" }],
  );
  for (const value of [
    null,
    {},
    [{ userId: "../session", status: "READY" }],
    [{ userId: "user", status: "INVALID" }],
  ]) {
    assert.throws(() => parsePendingSessions(value));
  }
  assert.throws(() => parseApiData({ status: "error", data: [] }));
  assert.throws(() => parseApiData({ status: "success" }));
});
test("requires HTTPS for remote API while allowing localhost", () => {
  const env = {
    API_URL: "http://localhost:3333/api/",
    WORKER_API_TOKEN: "a".repeat(32),
  };
  assert.equal(loadWorkerConfig(env).apiUrl, "http://localhost:3333/api");
  assert.throws(() =>
    loadWorkerConfig({ ...env, API_URL: "http://example.com/api" }),
  );
  assert.throws(() =>
    loadWorkerConfig({ ...env, POLL_INTERVAL_MS: "invalid" }),
  );
});
test("sends typed session updates with the worker token", async () => {
  let called;
  const client = new WorkerApiClient(
    { apiUrl: "https://example.com/api", apiToken: "secret" },
    async (url, options) => {
      called = { url, options };
      return new Response(
        JSON.stringify({ status: "success", data: { count: 1 } }),
      );
    },
  );
  await client.updateSession("user-1", {
    status: "READY",
    connectedPhone: "5511999999999",
  });
  assert.equal(called.options.headers["x-worker-token"], "secret");
  assert.equal(called.options.method, "PUT");
  assert.equal(called.options.redirect, "error");
  assert.deepEqual(JSON.parse(called.options.body), {
    status: "READY",
    connectedPhone: "5511999999999",
  });
});
test("refuses malformed sessions returned by the API", async () => {
  const client = new WorkerApiClient(
    { apiUrl: "https://example.com", apiToken: "secret" },
    async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: [{ userId: "user", status: "unexpected" }],
        }),
      ),
  );
  await assert.rejects(
    client.getPendingSessions(),
    /Estado de sessão inválido/,
  );
});
test("routes pending actions and waits for session shutdown before releasing lock", async () => {
  const events = [];
  let finished;
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  const api = {
    getPendingSessions: async () => [
      { userId: "a", status: "READY" },
      { userId: "b", status: "DISCONNECTED" },
    ],
  };
  const sessions = {
    refreshGroups: async () => {},
    connect: (id) => events.push("connect:" + id),
    disconnect: async (id) => {
      events.push("disconnect:" + id);
      finished();
    },
    stop: async () => {
      events.push("stop");
    },
  };
  const lock = {
    acquire: async () => {
      events.push("acquire");
    },
    release: async () => {
      events.push("release");
    },
  };
  const worker = new Worker(api, sessions, lock, 1000);
  await worker.start();
  await done;
  await worker.stop();
  assert.deepEqual(events, [
    "acquire",
    "connect:a",
    "disconnect:b",
    "stop",
    "release",
  ]);
});
