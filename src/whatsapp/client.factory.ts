import { Client, LocalAuth } from "whatsapp-web.js";
import { WorkerConfig } from "../config/worker.config";
export function createWhatsAppClient(
  userId: string,
  config: Pick<WorkerConfig, "sessionPath" | "chromePath">,
): Client {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId))
    throw new Error("Identificador de sessão inválido");
  return new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: config.sessionPath,
    }),
    puppeteer: {
      headless: true,
      // The worker closes Chrome after finishing in-flight publications.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...(config.chromePath ? { executablePath: config.chromePath } : {}),
    },
  });
}
