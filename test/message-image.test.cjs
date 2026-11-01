const test = require("node:test");
const assert = require("node:assert/strict");
const {
  captureMessageImage,
  previewImage,
} = require("../dist/collection/message-image.js");
const jpeg = Buffer.from([
  255,
  216,
  255,
  224,
  ...Array(24).fill(0),
  255,
  217,
]).toString("base64");
const image = {
  type: "image",
  hasMedia: true,
  rawData: {},
  downloadMedia: async () => ({ mimetype: "image/jpeg", data: jpeg }),
  reload: async () => null,
};
test("retries attachment that has not finished loading at message arrival", async () => {
  let downloads = 0,
    reloads = 0;
  const message = {
    ...image,
    hasMedia: false,
    reload: async () => {
      reloads++;
      return {
        ...image,
        downloadMedia: async () => {
          downloads++;
          return { mimetype: "image/jpeg", data: jpeg };
        },
      };
    },
  };
  const result = await captureMessageImage(
    message,
    new AbortController().signal,
    async () => {},
  );
  assert.equal(result.data, jpeg);
  assert.equal(result.origin, "media");
  assert.equal(reloads, 1);
  assert.equal(downloads, 1);
});
test("retries transient image download errors", async () => {
  let calls = 0;
  const message = {
    ...image,
    downloadMedia: async () => {
      if (++calls < 2) throw new Error("temporary");
      return { mimetype: "image/jpeg", data: jpeg };
    },
  };
  const result = await captureMessageImage(
    message,
    new AbortController().signal,
    async () => {},
  );
  assert.equal(result.data, jpeg);
  assert.equal(calls, 2);
});
test("captures embedded link preview without visiting remote URLs or downloading a document", async () => {
  const result = await captureMessageImage(
    {
      ...image,
      type: "chat",
      hasMedia: false,
      rawData: { jpegThumbnail: jpeg },
      downloadMedia: async () => {
        throw new Error("must not download");
      },
    },
    new AbortController().signal,
    async () => {},
  );
  assert.equal(result.data, jpeg);
  assert.equal(result.origin, "preview");
  assert.equal(
    previewImage({ thumbnail: "https://private.invalid/photo" }),
    undefined,
  );
  assert.equal(
    previewImage({ thumbnail: Buffer.from("private text").toString("base64") }),
    undefined,
  );
});
test("supports photos sent as image documents but skips other documents", async () => {
  const result = await captureMessageImage(
    { ...image, type: "document", rawData: { mimetype: "image/jpeg" } },
    new AbortController().signal,
    async () => {},
  );
  assert.equal(result.data, jpeg);
  const other = await captureMessageImage(
    {
      ...image,
      type: "document",
      rawData: { mimetype: "application/pdf" },
      downloadMedia: async () => {
        throw new Error("must not download");
      },
    },
    new AbortController().signal,
    async () => {},
  );
  assert.equal(other.origin, "missing");
});
