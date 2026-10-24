const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readGroups } = require("../dist/whatsapp/group-reader");

test("uses the native group listing when available", async () => {
  const groups = await readGroups({
    getChats: async () => [
      { isGroup: false, name: "Contact", id: { _serialized: "123@c.us" } },
      { isGroup: true, name: "Group", id: { _serialized: "123@g.us" } },
    ],
  });
  assert.deepEqual(groups, [{ whatsappId: "123@g.us", name: "Group" }]);
});

test("falls back to group IDs and names without serializing messages or participants", async () => {
  const previousWindow = global.window;
  global.window = {
    require: () => ({
      Chat: {
        getModelsArray: () => [
          {
            id: { _serialized: "123@g.us" },
            name: "Group A",
            groupMetadata: {},
          },
          { id: { $1: "456@g.us" }, groupMetadata: { subject: "Group B" } },
          { id: { _serialized: "789@c.us" }, name: "Contact" },
        ],
      },
    }),
  };
  try {
    const groups = await readGroups({
      getChats: async () => {
        throw new Error("r");
      },
      pupPage: { evaluate: async (fn) => fn() },
    });
    assert.deepEqual(groups, [
      { whatsappId: "123@g.us", name: "Group A" },
      { whatsappId: "456@g.us", name: "Group B" },
    ]);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test("refuses malformed fallback results instead of synchronizing invalid groups", async () => {
  await assert.rejects(
    readGroups({
      getChats: async () => {
        throw new Error("r");
      },
      pupPage: { evaluate: async () => [{ whatsappId: "bad", name: "Group" }] },
    }),
    /Grupo inválido/,
  );
});
