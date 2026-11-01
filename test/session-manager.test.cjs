const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { WhatsAppSessionManager } = require("../dist/whatsapp/session-manager");
function setup(execute) {
  const client = new EventEmitter();
  client.info = { wid: { user: "test" } };
  client.initialize = async () => {};
  client.destroy = async () => {};
  const manager = new WhatsAppSessionManager(
    { updateSession: async () => {} },
    { execute },
    () => client,
  );
  manager.connect("user-1");
  return { manager, client };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("refreshes groups periodically after the initial ready event", async (t) => {
  let now = 0,
    calls = 0;
  t.mock.method(Date, "now", () => now);
  const { manager, client } = setup(async () => {
    calls++;
  });
  client.emit("ready");
  await settle();
  assert.equal(calls, 1);
  await manager.refreshGroups();
  assert.equal(calls, 1);
  now = 60001;
  await manager.refreshGroups();
  assert.equal(calls, 2);
  client.emit("group_join");
  await settle();
  assert.equal(calls, 3);
  await manager.stop();
});
test("does not run group synchronizations concurrently", async () => {
  let finish;
  let calls = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { manager, client } = setup(async () => {
    calls++;
    await pending;
  });
  client.emit("ready");
  client.emit("group_join");
  client.emit("group_leave");
  const periodic = manager.refreshGroups();
  await settle();
  assert.equal(calls, 1);
  finish();
  await periodic;
  await manager.stop();
});
test("retries failed group synchronization and ignores events after shutdown", async (t) => {
  let now = 0,
    calls = 0;
  t.mock.method(Date, "now", () => now);
  const { manager, client } = setup(async () => {
    calls++;
    if (calls === 1) throw new Error("temporary");
  });
  client.emit("ready");
  await settle();
  now = 14000;
  await manager.refreshGroups();
  assert.equal(calls, 1);
  now = 16000;
  await manager.refreshGroups();
  assert.equal(calls, 2);
  await manager.stop();
  client.emit("group_join");
  await manager.refreshGroups();
  assert.equal(calls, 2);
});
