import { PendingSession, SESSION_STATUSES } from "../types/whatsapp.types";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function parseApiData(value: unknown): unknown {
  if (!isRecord(value) || value.status !== "success" || !("data" in value))
    throw new Error("Resposta inválida da API");
  return value.data;
}
export function parsePendingSessions(value: unknown): PendingSession[] {
  if (!Array.isArray(value)) throw new Error("Lista de conexões inválida");
  return value.map((item: unknown): PendingSession => {
    if (
      !isRecord(item) ||
      typeof item.userId !== "string" ||
      typeof item.connectionId !== "string" ||
      typeof item.authKey !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(item.connectionId) ||
      !/^[a-zA-Z0-9_-]+$/.test(item.authKey)
    )
      throw new Error(
        "Identificador de conexão inválido. Confira a versão da API.",
      );
    const identity = {
      userId: item.userId,
      connectionId: item.connectionId,
      authKey: item.authKey,
    };
    if (item.status === "SUSPENDED")
      return { ...identity, status: "SUSPENDED" };
    const status = SESSION_STATUSES.find((status) => status === item.status);
    if (!status) throw new Error("Estado de conexão inválido");
    return { ...identity, status };
  });
}
