export interface MessageTemplate {
  showImage: boolean;
  showHeadline: boolean;
  showTitle: boolean;
  showDescription: boolean;
  showCurrentPrice: boolean;
  showOriginalPrice: boolean;
  showDiscount: boolean;
  showCoupon: boolean;
  showLink: boolean;
  showFooter: boolean;
  headline: string;
  footer: string;
}
export const DEFAULT_MESSAGE_TEMPLATE: MessageTemplate = {
  showImage: true,
  showHeadline: false,
  showTitle: true,
  showDescription: false,
  showCurrentPrice: true,
  showOriginalPrice: true,
  showDiscount: true,
  showCoupon: true,
  showLink: true,
  showFooter: true,
  headline: "",
  footer: "❤️ Convide seus amigos\n👉 Link do grupo na descrição",
};
export function parseMessageTemplate(value: unknown): MessageTemplate {
  if (value == null) return { ...DEFAULT_MESSAGE_TEMPLATE };
  if (typeof value !== "object")
    throw new Error("Padrão de mensagem inválido.");
  const item = value as Record<string, unknown>;
  for (const key of [
    "showImage",
    "showHeadline",
    "showTitle",
    "showDescription",
    "showCurrentPrice",
    "showOriginalPrice",
    "showDiscount",
    "showCoupon",
    "showLink",
    "showFooter",
  ])
    if (typeof item[key] !== "boolean")
      throw new Error("Opção de mensagem inválida.");
  if (
    typeof item.headline !== "string" ||
    item.headline.length > 80 ||
    typeof item.footer !== "string" ||
    item.footer.length > 200
  )
    throw new Error("Texto do padrão de mensagem inválido.");
  return {
    showImage: item.showImage as boolean,
    showHeadline: item.showHeadline as boolean,
    showTitle: item.showTitle as boolean,
    showDescription: item.showDescription as boolean,
    showCurrentPrice: item.showCurrentPrice as boolean,
    showOriginalPrice: item.showOriginalPrice as boolean,
    showDiscount: item.showDiscount as boolean,
    showCoupon: item.showCoupon as boolean,
    showLink: item.showLink as boolean,
    showFooter: item.showFooter as boolean,
    headline: item.headline,
    footer: item.footer,
  };
}
