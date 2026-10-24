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
  if (!Array.isArray(value)) throw new Error("Lista de sessões inválida");
  return value.map((item: unknown): PendingSession => {
    if (
      !isRecord(item) ||
      typeof item.userId !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(item.userId)
    )
      throw new Error("Identificador de sessão inválido");
    const status = SESSION_STATUSES.find((status) => status === item.status);
    if (!status) throw new Error("Estado de sessão inválido");
    return { userId: item.userId, status };
  });
}
