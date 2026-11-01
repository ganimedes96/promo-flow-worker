import { Client, LocalAuth } from "whatsapp-web.js";
import { WorkerConfig } from "../config/worker.config";
export function createWhatsAppClient(
  authKey: string,
  config: Pick<WorkerConfig, "sessionPath" | "chromePath"> &
    Partial<Pick<WorkerConfig, "chromeNoSandbox">>,
): Client {
  if (!/^[a-zA-Z0-9_-]+$/.test(authKey))
    throw new Error("Identificador de sessão inválido");
  return new Client({
    authStrategy: new LocalAuth({
      clientId: authKey,
      dataPath: config.sessionPath,
    }),
    puppeteer: {
      headless: true,
      ...(config.chromeNoSandbox
        ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] }
        : {}),
      // The worker closes Chrome after finishing in-flight publications.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...(config.chromePath ? { executablePath: config.chromePath } : {}),
    },
  });
}
