import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { TelegramBotClient, TelegramApiError, BotIdentity } from "./bot.client";
import { TelegramPublisherApi } from "./bot.types";
import {
  PublicationApi,
  PublicationJob,
  PublicationOutcome,
  PublicationReceipt,
  PublicationProcessor,
} from "../publishing/publication.types";
import { ReceiptStore } from "../publishing/receipt-store";
import { buildCaption } from "../publishing/caption";
import { applyWatermark } from "../publishing/watermark";
import { downloadImage } from "../publishing/image-download";
import { runtimeLog } from "../utils/runtime-log";
export function telegramCaption(job: PublicationJob) {
  return buildCaption(job)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/~([^~\n]+)~/g, "<s>$1</s>");
}
export class TelegramBotPublisher implements PublicationProcessor {
  private stopping = false;
  private identity?: BotIdentity;
  private offset = 0;
  private nextCheck = 0;
  constructor(
    private readonly bot: TelegramBotClient,
    private readonly api: PublicationApi & TelegramPublisherApi,
    private readonly receipts: ReceiptStore,
    private readonly cursorPath: string,
    private readonly enabled: boolean,
  ) {}
  stop() {
    this.stopping = true;
  }
  private async initialize() {
    if (this.identity) return this.identity;
    const identity = await this.bot.identity();
    await this.bot.assertPolling();
    try {
      const value: unknown = JSON.parse(
        await readFile(this.cursorPath, "utf8"),
      );
      if (
        value &&
        typeof value === "object" &&
        "botId" in value &&
        value.botId === identity.botId &&
        "offset" in value &&
        typeof value.offset === "number" &&
        Number.isSafeInteger(value.offset) &&
        value.offset >= 0
      )
        this.offset = value.offset;
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw new Error(
          "Não foi possível ler o cursor do bot. Confira os arquivos locais.",
        );
    }
    this.identity = identity;
    return identity;
  }
  private async cursor(updateId: number) {
    const offset = updateId + 1;
    await mkdir(dirname(this.cursorPath), { recursive: true });
    await writeFile(
      this.cursorPath + ".tmp",
      JSON.stringify({ botId: this.identity!.botId, offset }),
      { mode: 0o600, flush: true },
    );
    await rename(this.cursorPath + ".tmp", this.cursorPath);
    this.offset = offset;
  }
  async poll() {
    if (this.stopping) return;
    // Both publishers share the journal: an unacknowledged receipt blocks new claims.
    for (const receipt of await this.receipts.list()) {
      await this.api.completePublication(receipt);
      await this.receipts.remove(receipt.attemptId);
    }
    const identity = await this.initialize();
    await this.api.registerTelegramBot(identity);
    for (const update of await this.bot.updates(this.offset)) {
      if (this.stopping) return;
      const match = update.text.match(
        /^\/promoflow(?:@([a-zA-Z0-9_]+))?\s+([a-f0-9]{48})\s*$/,
      );
      if (
        match &&
        (!match[1] ||
          match[1].toLowerCase() === identity.username.toLowerCase()) &&
        update.chat.id < 0
      ) {
        try {
          if (
            (await this.bot.canPost(String(update.chat.id), identity.botId)) &&
            (await this.bot.canAuthorize(update))
          ) {
            const accepted = await this.api.bindTelegramDestination({
              ...identity,
              code: match[2],
              chatId: String(update.chat.id),
              name: update.chat.title.slice(0, 200) || "Telegram",
              chatType: update.chat.type,
              participantCount: await this.bot.participantCount(
                String(update.chat.id),
              ),
            });
            runtimeLog("telegram.destination.bound", undefined, { accepted });
          }
        } catch (error) {
          // Invalid/expired codes and permission failures are terminal; API outages keep the update unacknowledged.
          if (!(
            error &&
            typeof error === "object" &&
            "statusCode" in error &&
            typeof error.statusCode === "number" &&
            [400, 403, 404, 409].includes(error.statusCode)
          ))
            throw error;
          runtimeLog("telegram.destination.rejected", error);
        }
      }
      await this.cursor(update.updateId);
    }
    const destinations = (await this.api.telegramDestinations()).filter(
      (d) => d.botId === identity.botId,
    );
    if (this.nextCheck <= Date.now()) {
      for (const destination of destinations) {
        let available: boolean;
        try {
          available = await this.bot.canPost(
            destination.chatId,
            identity.botId,
          );
        } catch (error) {
          if (
            error instanceof TelegramApiError &&
            [400, 403].includes(error.statusCode)
          )
            available = false;
          else throw error;
        }
        await this.api.telegramAvailability(destination.groupId, available);
      }
      this.nextCheck = Date.now() + 60000;
    }
    if (!this.enabled || this.stopping) return;
    for (const connectionId of new Set(
      destinations.map((d) => d.connectionId),
    )) {
      if (this.stopping) break;
      const job = await this.api.claimPublication(connectionId);
      if (!job) continue;
      if (
        job.provider !== "TELEGRAM_BOT" ||
        job.connectionId !== connectionId ||
        !destinations.some(
          (d) => d.connectionId === connectionId && d.chatId === job.groupId,
        )
      )
        throw new Error("A API retornou destino inválido para o Telegram.");
      await this.publish(job, identity);
    }
  }
  private async publish(job: PublicationJob, identity: BotIdentity) {
    let result: PublicationOutcome;
    let started = false;
    try {
      if (this.stopping) throw new Error("Worker encerrando antes do envio.");
      if (!(await this.bot.canPost(job.groupId, identity.botId)))
        throw new Error("O bot perdeu a permissão de publicar neste destino.");
      const caption = telegramCaption(job);
      let media =
        job.messageTemplate?.showImage === false
          ? null
          : await downloadImage(job.imageUrl);
      if (media && job.messageTemplate?.watermarkEnabled)
        media = await applyWatermark(media, job.messageTemplate);
      // Telegram sendPhoto accepts still images; normalize WebP/GIF to JPEG without a second message.
      const image = media
        ? {
            mimetype: "image/jpeg",
            data: (
              await sharp(Buffer.from(media.data, "base64"))
                .rotate()
                .resize({
                  width: 2560,
                  height: 2560,
                  fit: "inside",
                  withoutEnlargement: true,
                })
                .jpeg({ quality: 92 })
                .toBuffer()
            ).toString("base64"),
          }
        : undefined;
      await this.receipts.save({
        attemptId: job.attemptId,
        outcome: "UNKNOWN",
        errorMessage:
          "Envio Telegram interrompido. Confira o destino antes de reenviar.",
      });
      if (this.stopping) throw new Error("Worker encerrando antes do envio.");
      started = true;
      const whatsappMessageId = await this.bot.send(
        job.groupId,
        caption,
        job.messageTemplate?.showLinkPreview === true,
        image,
      );
      result = { outcome: "SUCCESS", whatsappMessageId };
    } catch (error) {
      const definitive =
        !started ||
        (error instanceof TelegramApiError &&
          error.statusCode >= 400 &&
          error.statusCode < 500);
      result = {
        outcome: definitive ? "FAILED" : "UNKNOWN",
        errorMessage:
          error instanceof TelegramApiError
            ? error.message
            : definitive
              ? "Não foi possível preparar a publicação no Telegram. Confira a imagem e as permissões."
              : "O Telegram não confirmou o envio. Confira o destino antes de qualquer reenvio.",
      };
    }
    const receipt: PublicationReceipt = { attemptId: job.attemptId, ...result };
    try {
      await this.receipts.save(receipt);
    } catch {
      await this.api.completePublication(receipt);
      return;
    }
    await this.api.completePublication(receipt);
    await this.receipts.remove(receipt.attemptId);
    runtimeLog("telegram.publication.completed", undefined, {
      offerId: job.offerId,
      outcome: result.outcome,
    });
  }
}
