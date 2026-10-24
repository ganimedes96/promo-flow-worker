import {
  PublicationApi,
  PublicationJob,
  PublicationOutcome,
  PublicationProcessor,
  PublicationReceipt,
  PublicationSessions,
} from "./publication.types";
import { ReceiptStore } from "./receipt-store";
import { buildCaption } from "./caption";
import { downloadImage } from "./image-download";
import { errorMessage } from "../utils/error-message";
export class PublicationWorker implements PublicationProcessor {
  constructor(
    private readonly api: PublicationApi,
    private readonly sessions: PublicationSessions,
    private readonly receipts: ReceiptStore,
    private readonly enabled: boolean,
  ) {}
  private async acknowledge(receipt: PublicationReceipt): Promise<void> {
    await this.api.completePublication(receipt);
    await this.receipts.remove(receipt.attemptId);
  }
  async poll(): Promise<void> {
    // Recibos pendentes só confirmam resultados; nunca repetem o envio ao WhatsApp.
    for (const receipt of await this.receipts.list())
      await this.acknowledge(receipt);
    if (!this.enabled) return;
    for (const userId of this.sessions.readyUserIds()) {
      const job = await this.api.claimPublication(userId);
      if (!job) continue;
      await this.publish(job);
    }
  }
  private async publish(job: PublicationJob): Promise<void> {
    let result: PublicationOutcome;
    try {
      const caption = buildCaption(job);
      const media = await downloadImage(job.imageUrl);
      const client = this.sessions.getReadyClient(job.userId);
      if (!client)
        throw new Error("Sessão do WhatsApp indisponível antes do envio.");
      try {
        const message = await client.sendMessage(job.groupId, media, {
          caption,
          sendSeen: false,
          waitUntilMsgSent: true,
        });
        if (!message?.id?._serialized)
          throw new Error("WhatsApp não retornou o identificador da mensagem.");
        result = {
          outcome: "SUCCESS",
          whatsappMessageId: message.id._serialized,
        };
      } catch (error: unknown) {
        result = {
          outcome: "UNKNOWN",
          errorMessage: errorMessage(error).slice(0, 800),
        };
      }
    } catch (error: unknown) {
      result = {
        outcome: "FAILED",
        errorMessage: errorMessage(error).slice(0, 800),
      };
    }
    const receipt: PublicationReceipt = { attemptId: job.attemptId, ...result };
    try {
      await this.receipts.save(receipt);
    } catch (error: unknown) {
      console.error("Falha ao salvar recibo local:", errorMessage(error));
      await this.api.completePublication(receipt);
      return;
    }
    await this.acknowledge(receipt);
    console.log("Publicação " + job.offerId + ": " + result.outcome);
  }
}
