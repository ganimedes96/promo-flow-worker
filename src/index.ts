import { WorkerHeartbeat } from "./runtime/worker-heartbeat";
import { PublicationWorker } from "./publishing/publication-worker";
import { ReceiptStore } from "./publishing/receipt-store";
import "dotenv/config";
import { WorkerApiClient } from "./api/worker-api.client";
import { loadWorkerConfig } from "./config/worker.config";
import { Worker } from "./runtime/worker";
import { WorkerLock } from "./runtime/worker-lock";
import { errorMessage } from "./utils/error-message";
import { createWhatsAppClient } from "./whatsapp/client.factory";
import { GroupSyncService } from "./whatsapp/group-sync.service";
import { WhatsAppSessionManager } from "./whatsapp/session-manager";
async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const api = new WorkerApiClient(config);
  const sessions = new WhatsAppSessionManager(
    api,
    new GroupSyncService(api),
    (userId) => createWhatsAppClient(userId, config),
  );
  const worker = new Worker(
    api,
    sessions,
    new WorkerLock(config.sessionPath),
    config.pollIntervalMs,
    new PublicationWorker(
      api,
      sessions,
      new ReceiptStore(config.receiptsPath),
      config.publishingEnabled,
    ),
    new WorkerHeartbeat(api, config.publishingEnabled),
  );
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Encerrando worker; aguarde a confirmação...");
    void worker
      .stop()
      .then(() => {
        console.log("Worker encerrado. Sessão preservada e lock liberado.");
        if (process.connected) process.disconnect();
      })
      .catch((error: unknown) => {
        console.error("Falha ao encerrar:", errorMessage(error));
        process.exitCode = 1;
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGBREAK", shutdown);
  process.on("message", (message: unknown) => {
    if (message === "shutdown") shutdown();
  });
  await worker.start();
  if (process.send) process.send("ready");
  console.log("Worker consultando " + config.apiUrl);
  console.log(
    "Publicação de ofertas: " +
      (config.publishingEnabled ? "ATIVA" : "DESATIVADA"),
  );
}
main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
