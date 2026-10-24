import { PublicationJob } from "./publication.types";

export function buildCaption(job: PublicationJob): string {
  const price = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: job.currency,
  }).format(Number(job.currentPrice));
  const title = job.title.replace(/[\r\n*]+/g, " ").trim().slice(0, 180);
  const caption = [
    `*${title}*`,
    "",
    `💵 Por: ${price}`,
    ...(job.couponCode?.trim() ? [`🎟️ Cupom: ${job.couponCode.trim().replace(/[\r\n]+/g, " ")}`] : []),
    `🛒 Link: ${job.affiliateUrl || job.sourceUrl}`,
    "",
    "❤️ Convide seus amigos",
    "👉 Link do grupo na descrição",
  ].join("\n");

  if (caption.length > 1000)
    throw new Error("O link de compra é longo demais para a legenda.");
  return caption;
}
