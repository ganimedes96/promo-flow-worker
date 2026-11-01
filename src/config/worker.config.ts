import { resolve } from "node:path";
export interface WorkerConfig {
  collectorUrl?: string;
  collectorToken?: string;
  maxSessions: number;
  sessionStartTimeoutMs: number;
  showQrInTerminal: boolean;
  chromeNoSandbox: boolean;
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
  const collectorUrl = env.COLLECTOR_URL?.replace(/\/+$/, "");
  const collectorToken = env.COLLECTOR_LOCAL_TOKEN;
  if (collectorUrl) {
    const target = new URL(collectorUrl);
    if (
      target.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(target.hostname) ||
      target.username ||
      target.password ||
      target.pathname !== "/" ||
      target.search ||
      target.hash ||
      !collectorToken ||
      collectorToken.length < 32
    )
      throw new Error(
        "Configure COLLECTOR_URL local e COLLECTOR_LOCAL_TOKEN com ao menos 32 caracteres.",
      );
  }
  const maxSessions = Number(env.MAX_CONCURRENT_SESSIONS ?? 5);
  const sessionStartTimeoutMs = Number(env.SESSION_START_TIMEOUT_MS ?? 180000);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100)
    throw new Error(
      "MAX_CONCURRENT_SESSIONS deve ser um inteiro entre 1 e 100.",
    );
  if (!Number.isInteger(sessionStartTimeoutMs) || sessionStartTimeoutMs < 60000)
    throw new Error("SESSION_START_TIMEOUT_MS deve ser >= 60000.");
  const showQr = env.QR_IN_TERMINAL ?? "true",
    noSandbox = env.CHROME_NO_SANDBOX ?? "false";
  if (
    !["true", "false"].includes(showQr) ||
    !["true", "false"].includes(noSandbox)
  )
    throw new Error(
      "QR_IN_TERMINAL e CHROME_NO_SANDBOX devem ser true ou false.",
    );
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
    collectorUrl,
    collectorToken,
    maxSessions,
    sessionStartTimeoutMs,
    showQrInTerminal: showQr === "true",
    chromeNoSandbox: noSandbox === "true",
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
