import { resolve } from "node:path";
export interface WorkerConfig {
  apiUrl: string;
  apiToken: string;
  pollIntervalMs: number;
  sessionPath: string;
  chromePath?: string;
  publishingEnabled: boolean;
  receiptsPath: string;
}
export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const enabled = env.ENABLE_PUBLISHING ?? "false";
  if (!["true", "false"].includes(enabled))
    throw new Error("ENABLE_PUBLISHING deve ser true ou false");
  const apiUrl = env.API_URL?.replace(/\/$/, "");
  const apiToken = env.WORKER_API_TOKEN;
  const pollIntervalMs = Number(env.POLL_INTERVAL_MS ?? 5000);
  if (!apiUrl || !apiToken || apiToken.length < 32)
    throw new Error(
      "Configure API_URL e WORKER_API_TOKEN (mínimo 32 caracteres) no .env",
    );
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000)
    throw new Error("POLL_INTERVAL_MS deve ser >= 1000");
  const url = new URL(apiUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("API remota exige HTTPS");
  return {
    publishingEnabled: enabled === "true",
    receiptsPath: resolve(
      env.PUBLICATION_RECEIPTS_PATH ??
        resolve(
          env.SESSION_PATH ?? "./data/sessions",
          "..",
          "publication-receipts",
        ),
    ),
    apiUrl,
    apiToken,
    pollIntervalMs,
    sessionPath: resolve(env.SESSION_PATH ?? "./data/sessions"),
    chromePath: env.CHROME_PATH,
  };
}
