import { PublicationJob, PublicationReceipt } from "./publication.types";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Dados de publicação inválidos");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.length)
    throw new Error("Campo de publicação inválido");
  return value;
}
function optional(value: unknown): string | null {
  return value === null ? null : string(value);
}
function uuid(value: unknown): string {
  const id = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error("Identificador de publicação inválido");
  return id;
}
export function parsePublicationJob(value: unknown): PublicationJob | null {
  if (value === null) return null;
  const item = record(value);
  const groupId = string(item.groupId);
  if (!/^\d+(?:-\d+)?@g\.us$/.test(groupId))
    throw new Error("Grupo de publicação inválido");
  const currentPrice = string(item.currentPrice);
  if (!Number.isFinite(Number(currentPrice)) || Number(currentPrice) <= 0)
    throw new Error("Preço de publicação inválido");
  return {
    offerId: uuid(item.offerId),
    attemptId: uuid(item.attemptId),
    userId: uuid(item.userId),
    groupId,
    title: string(item.title),
    description: string(item.description),
    imageUrl: string(item.imageUrl),
    sourceUrl: string(item.sourceUrl),
    affiliateUrl: optional(item.affiliateUrl),
    couponCode: item.couponCode == null ? null : optional(item.couponCode),
    currentPrice,
    originalPrice: optional(item.originalPrice),
    discountPercentage: optional(item.discountPercentage),
    currency: string(item.currency),
  };
}
export function parsePublicationReceipt(value: unknown): PublicationReceipt {
  const item = record(value);
  const attemptId = uuid(item.attemptId);
  if (item.outcome === "SUCCESS")
    return {
      attemptId,
      outcome: "SUCCESS",
      whatsappMessageId: string(item.whatsappMessageId),
    };
  if (item.outcome === "FAILED" || item.outcome === "UNKNOWN")
    return {
      attemptId,
      outcome: item.outcome,
      errorMessage: string(item.errorMessage),
    };
  throw new Error("Resultado de publicação inválido");
}
