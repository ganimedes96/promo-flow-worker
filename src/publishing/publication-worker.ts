import { runtimeLog } from "../utils/runtime-log";
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
  private stopping = false;
  stop(): void {
    this.stopping = true;
  }
  constructor(
    private readonly api: PublicationApi,
    private readonly sessions: PublicationSessions,
    private readonly receipts: ReceiptStore,
    private readonly enabled: boolean,
    private readonly sendTimeoutMs = 90_000,
  ) {}
  private async acknowledge(receipt: PublicationReceipt): Promise<void> {
    await this.api.completePublication(receipt);
    await this.receipts.remove(receipt.attemptId);
  }
  async poll(): Promise<void> {
    // Recibos pendentes só confirmam resultados; nunca repetem o envio ao WhatsApp.
    for (const receipt of await this.receipts.list())
      await this.acknowledge(receipt);
    if (!this.enabled || this.stopping) return;
    for (const connectionId of this.sessions.readyConnectionIds()) {
      if (this.stopping) break;
      const job = await this.api.claimPublication(connectionId);
      if (!job) continue;
      if (job.connectionId !== connectionId)
        throw new Error(
          "A API retornou uma publicação de outra conexão. Nenhum envio foi iniciado.",
        );
      await this.publish(job);
    }
  }
  private async publish(job: PublicationJob): Promise<void> {
    let result: PublicationOutcome;
    try {
      if (this.stopping)
        throw new Error("Worker encerrando antes de iniciar o envio.");
      const caption = buildCaption(job);
      const media =
        job.messageTemplate?.showImage === false
          ? null
          : await downloadImage(job.imageUrl);
      const client = this.sessions.getReadyClient(job.connectionId);
      if (!client)
        throw new Error("Sessão do WhatsApp indisponível antes do envio.");
      // Write intent before touching WhatsApp. A crash can only replay a receipt,
      // never the send operation; an unresolved intent requires manual review.
      await this.receipts.save({
        attemptId: job.attemptId,
        outcome: "UNKNOWN",
        errorMessage:
          "O worker foi interrompido durante o envio. Confira o grupo antes de reenviar.",
      });
      if (this.stopping)
        throw new Error("Worker encerrando antes de iniciar o envio.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const message = await Promise.race([
          client.sendMessage(job.groupId, media ?? caption, {
            ...(media
              ? { caption, sendMediaAsHd: true }
              : { linkPreview: false }),
            sendSeen: false,
            waitUntilMsgSent: true,
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "O WhatsApp não confirmou o envio no prazo. Confira o grupo antes de reenviar.",
                  ),
                ),
              this.sendTimeoutMs,
            );
          }),
        ]);
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
      } finally {
        if (timer) clearTimeout(timer);
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
    runtimeLog("publication.completed", undefined, {
      attemptId: job.attemptId,
      offerId: job.offerId,
      outcome: result.outcome,
    });
  }
}
