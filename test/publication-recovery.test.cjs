const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
// No browser, external HTTP or WhatsApp session is used by these tests.
require("../dist/publishing/image-download").downloadImage = async () => ({
  mimetype: "image/jpeg",
  data: "mock",
});
const { PublicationWorker } = require("../dist/publishing/publication-worker");
const { ReceiptStore } = require("../dist/publishing/receipt-store");
const attemptId = "11111111-1111-4111-8111-111111111111";
const job = {
  attemptId,
  connectionId: "connection",
  offerId: "offer",
  userId: "user",
  groupId: "test@g.us",
  title: "Produto",
  description: "Descricao",
  imageUrl: "https://image.invalid/test.jpg",
  sourceUrl: "https://product.invalid",
  affiliateUrl: null,
  currentPrice: "10.00",
  originalPrice: null,
  discountPercentage: null,
  currency: "BRL",
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "promoflow-receipts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new ReceiptStore(directory) };
}
test("restart acknowledges a saved success without sending or claiming again first", async (t) => {
  const { directory, store } = await fixture(t);
  let sent = 0,
    failAck = true,
    claimed = false;
  const api = {
    claimPublication: async () => {
      if (claimed) return null;
      claimed = true;
      return job;
    },
    completePublication: async () => {
      if (failAck) throw Error("offline");
    },
  };
  const sessions = {
    readyConnectionIds: () => ["connection"],
    getReadyClient: () => ({
      sendMessage: async () => {
        sent++;
        assert.equal((await store.list())[0].outcome, "UNKNOWN");
        return { id: { _serialized: "message-1" } };
      },
    }),
  };
  await assert.rejects(
    new PublicationWorker(api, sessions, store, true).poll(),
    /offline/,
  );
  assert.equal((await store.list())[0].outcome, "SUCCESS");
  failAck = false;
  await new PublicationWorker(
    api,
    sessions,
    new ReceiptStore(directory),
    true,
  ).poll();
  assert.equal(sent, 1);
  assert.equal((await store.list()).length, 0);
});
test("a crash intent is only acknowledged as unknown, never resent", async (t) => {
  const { store } = await fixture(t);
  let result;
  await store.save({
    attemptId,
    outcome: "UNKNOWN",
    errorMessage: "Interrupted",
  });
  const api = {
    claimPublication: async () => {
      throw Error("must not claim");
    },
    completePublication: async (receipt) => {
      result = receipt;
    },
  };
  await new PublicationWorker(
    api,
    { readyConnectionIds: () => [] },
    store,
    false,
  ).poll();
  assert.equal(result.outcome, "UNKNOWN");
  assert.equal((await store.list()).length, 0);
});
test("ambiguous send is unknown and is not automatically retried", async (t) => {
  const { store } = await fixture(t);
  let sends = 0,
    result;
  const api = {
    claimPublication: async () => job,
    completePublication: async (receipt) => {
      result = receipt;
    },
  };
  await new PublicationWorker(
    api,
    {
      readyConnectionIds: () => ["connection"],
      getReadyClient: () => ({
        sendMessage: async () => {
          sends++;
          throw Error("browser disconnected");
        },
      }),
    },
    store,
    true,
  ).poll();
  assert.equal(sends, 1);
  assert.equal(result.outcome, "UNKNOWN");
});
test("failure to persist intent prevents the WhatsApp send", async () => {
  let sends = 0,
    result;
  const receipts = {
    list: async () => [],
    save: async () => {
      throw Error("disk unavailable");
    },
    remove: async () => {},
  };
  const api = {
    claimPublication: async () => job,
    completePublication: async (receipt) => {
      result = receipt;
    },
  };
  await new PublicationWorker(
    api,
    {
      readyConnectionIds: () => ["connection"],
      getReadyClient: () => ({
        sendMessage: async () => {
          sends++;
        },
      }),
    },
    receipts,
    true,
  ).poll();
  assert.equal(sends, 0);
  assert.equal(result.outcome, "FAILED");
});
test("unacknowledged receipts block claiming new jobs", async (t) => {
  const { store } = await fixture(t);
  let claims = 0;
  await store.save({
    attemptId,
    outcome: "SUCCESS",
    whatsappMessageId: "message",
  });
  const api = {
    completePublication: async () => {
      throw Error("offline");
    },
    claimPublication: async () => {
      claims++;
      return job;
    },
  };
  await assert.rejects(
    new PublicationWorker(
      api,
      { readyConnectionIds: () => ["connection"] },
      store,
      true,
    ).poll(),
  );
  assert.equal(claims, 0);
  assert.equal((await store.list()).length, 1);
});

test("a send that never resolves becomes unknown without retrying", async (t) => {
  const { store } = await fixture(t);
  let sends = 0,
    result;
  const api = {
    claimPublication: async () => job,
    completePublication: async (receipt) => {
      result = receipt;
    },
  };
  await new PublicationWorker(
    api,
    {
      readyConnectionIds: () => ["connection"],
      getReadyClient: () => ({
        sendMessage: () => {
          sends++;
          return new Promise(() => {});
        },
      }),
    },
    store,
    true,
    10,
  ).poll();
  assert.equal(sends, 1);
  assert.equal(result.outcome, "UNKNOWN");
});
test("shutdown finishes the current receipt without starting another connection", async (t) => {
  const { store } = await fixture(t);
  let sends = 0,
    claims = 0,
    worker;
  const api = {
    claimPublication: async () => {
      claims++;
      return job;
    },
    completePublication: async () => {},
  };
  worker = new PublicationWorker(
    api,
    {
      readyConnectionIds: () => ["connection", "other"],
      getReadyClient: () => ({
        sendMessage: async () => {
          sends++;
          worker.stop();
          return { id: { _serialized: "message" } };
        },
      }),
    },
    store,
    true,
  );
  await worker.poll();
  assert.equal(sends, 1);
  assert.equal(claims, 1);
});
