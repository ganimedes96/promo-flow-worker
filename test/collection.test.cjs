const test = require("node:test");
const assert = require("node:assert/strict");
const { CollectionClient } = require("../dist/collection/collector.client.js");
const connectionId = "11111111-1111-4111-8111-111111111111";
const phone = "5585999999999";
function message(extra = {}) {
  return {
    from: "120363123456789@g.us",
    fromMe: false,
    isStatus: false,
    body: "Monitor https://amazon.com.br/dp/B012345678",
    id: { _serialized: "false_group_MESSAGE" },
    timestamp: 1793448000,
    hasMedia: true,
    type: "image",
    downloadMedia: async () => ({ mimetype: "image/png", data: "aGVsbG8=" }),
    ...extra,
  };
}
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}
test("only selected groups from the exact connection and phone reach collector; own messages and private chats never leave worker", async () => {
  const calls = [];
  const bridge = new CollectionClient(
    { collectorUrl: "http://127.0.0.1:3344", collectorToken: "x".repeat(32) },
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: url.endsWith("/sources")
            ? [
                {
                  connectionId,
                  accountPhone: phone,
                  whatsappId: "120363123456789@g.us",
                },
              ]
            : { result: "created" },
        }),
      };
    },
  );
  bridge.receive(connectionId, phone, message({ fromMe: true }));
  bridge.receive(connectionId, phone, message({ from: "5585999999999@c.us" }));
  bridge.receive(
    connectionId,
    phone,
    message({ body: "Comunicado sem produto" }),
  );
  await flush();
  assert.equal(calls.length, 0);
  bridge.receive(connectionId, phone, message());
  await flush();
  await flush();
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.fromMe, false);
  assert.equal(payload.connectionId, connectionId);
  assert.equal(payload.imageBase64, "aGVsbG8=");
  bridge.receive("22222222-2222-4222-8222-222222222222", phone, message());
  await flush();
  assert.equal(calls.length, 2);
  bridge.receive(connectionId, "5585888888888", message());
  await flush();
  assert.equal(calls.length, 2);
  await bridge.stop();
});
test("collector API failure prevents media download and capture", async () => {
  let downloads = 0;
  const bridge = new CollectionClient(
    { collectorUrl: "http://127.0.0.1:3344", collectorToken: "x".repeat(32) },
    async () => ({ ok: false }),
  );
  bridge.receive(
    connectionId,
    phone,
    message({
      downloadMedia: async () => {
        downloads++;
      },
    }),
  );
  await flush();
  assert.equal(downloads, 0);
  await bridge.stop();
});

test('shutdown cancels a media wait without needing the browser to finish download',async()=>{
 let downloading=false;
 const bridge=new CollectionClient({collectorUrl:'http://127.0.0.1:3344',collectorToken:'x'.repeat(32)},async()=>({ok:true,json:async()=>({data:[{connectionId,accountPhone:phone,whatsappId:'120363123456789@g.us'}]})}));
 bridge.receive(connectionId,phone,message({downloadMedia:()=>{downloading=true;return new Promise(()=>{});}}));
 await flush();assert.equal(downloading,true);await bridge.stop();
});
