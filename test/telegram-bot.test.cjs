const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  TelegramBotClient,
  TelegramApiError,
} = require("../dist/telegram/bot.client");
const {
  TelegramBotPublisher,
  telegramCaption,
} = require("../dist/telegram/bot-publisher");
const {
  DEFAULT_MESSAGE_TEMPLATE,
} = require("../dist/publishing/message-template");
const {
  parsePublicationJob,
} = require("../dist/publishing/publication.validation");
const id = "11111111-1111-4111-8111-111111111111";
const job = {
  provider: "TELEGRAM_BOT",
  offerId: id,
  attemptId: id,
  userId: id,
  connectionId: id,
  groupId: "-100123",
  title: "Produto <script> & teste",
  description: "Descrição",
  currentPrice: "10",
  originalPrice: "20",
  discountPercentage: "50",
  currency: "BRL",
  imageUrl: "https://example.invalid/image.jpg",
  sourceUrl: "https://example.invalid/product",
  affiliateUrl: null,
  messageTemplate: { ...DEFAULT_MESSAGE_TEMPLATE, showImage: false },
};
test("validação separa destinos e mensagem usa HTML escapado", () => {
  assert.equal(parsePublicationJob(job).provider, "TELEGRAM_BOT");
  assert.throws(() =>
    parsePublicationJob({ ...job, provider: "WHATSAPP_WEB_JS" }),
  );
  const caption = telegramCaption(job);
  assert.ok(caption.includes("&lt;script&gt; &amp;"));
  assert.ok(!caption.includes("<script>"));
  assert.ok(caption.includes("<b>"));
});
test("cliente oficial envia uma mensagem e trata recusa sem expor token", async () => {
  const calls = [];
  const client = new TelegramBotClient(
    "123456:abcdefghijklmnopqrstuv",
    async (url, options) => {
      calls.push({
        method: url.split("/").pop(),
        body: JSON.parse(options.body),
      });
      return Response.json({
        ok: true,
        result: { message_id: 12, chat: { id: -100123 } },
      });
    },
  );
  assert.equal(
    await client.send("-100123", "Texto", false),
    "telegram:-100123:12",
  );
  assert.equal(calls[0].method, "sendMessage");
  assert.equal(calls[0].body.link_preview_options.is_disabled, true);
  const denied = new TelegramBotClient(
    "123456:abcdefghijklmnopqrstuv",
    async () =>
      Response.json(
        { ok: false, error_code: 403, description: "private" },
        { status: 403 },
      ),
  );
  await assert.rejects(
    () => denied.send("-100123", "Texto", false),
    (error) =>
      error instanceof TelegramApiError &&
      error.statusCode === 403 &&
      !error.message.includes("private"),
  );
});
test("vínculo rejeita membro sem permissão e confirma administrador", async () => {
  const client = new TelegramBotClient(
    "123456:abcdefghijklmnopqrstuv",
    async () => Response.json({ ok: true, result: { status: "member" } }),
  );
  assert.equal(
    await client.canAuthorize({
      chat: { id: -100, type: "supergroup" },
      fromId: 22,
    }),
    false,
  );
  assert.equal(await client.canPost("-100", "123456"), false);
  const admin = new TelegramBotClient(
    "123456:abcdefghijklmnopqrstuv",
    async () =>
      Response.json({
        ok: true,
        result: { status: "administrator", can_post_messages: true },
      }),
  );
  assert.equal(await admin.canPost("-100", "123456"), true);
});
for (const [name, error, outcome] of [
  ["sucesso", null, "SUCCESS"],
  ["recusa", new TelegramApiError(403), "FAILED"],
  ["timeout", new Error("timeout"), "UNKNOWN"],
]) {
  test(
    "publicador Telegram: " + name + " preserva recibo e não reenvia",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "promoflow-bot-"));
      try {
        let sends = 0,
          claims = 0;
        const results = [],
          stored = [];
        const bot = {
          identity: async () => ({ botId: "123456", username: "test_bot" }),
          assertPolling: async () => {},
          updates: async () => [],
          canPost: async () => true,
          send: async () => {
            sends++;
            if (error) throw error;
            return "telegram:-100123:1";
          },
        };
        const api = {
          registerTelegramBot: async () => {},
          telegramDestinations: async () => [
            {
              connectionId: id,
              groupId: id,
              chatId: job.groupId,
              botId: "123456",
            },
          ],
          telegramAvailability: async () => {},
          claimPublication: async () => (claims++ === 0 ? job : null),
          completePublication: async (receipt) => results.push(receipt),
        };
        const receipts = {
          list: async () => [],
          save: async (receipt) => stored.push(receipt),
          remove: async () => {},
        };
        const publisher = new TelegramBotPublisher(
          bot,
          api,
          receipts,
          join(directory, "cursor.json"),
          true,
        );
        await publisher.poll();
        await publisher.poll();
        assert.equal(sends, 1);
        assert.equal(results.length, 1);
        assert.equal(results[0].outcome, outcome);
        assert.equal(stored[0].outcome, "UNKNOWN");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
