export interface MessageTemplate {
  showImage: boolean;
  showLinkPreview: boolean;
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkPosition: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  watermarkOpacity: number;
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
  showLinkPreview: false,
  watermarkEnabled: false,
  watermarkText: "",
  watermarkPosition: "bottom-right",
  watermarkOpacity: 70,
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
  const item = {
    showLinkPreview: false,
    watermarkEnabled: false,
    watermarkText: '',
    watermarkPosition: 'bottom-right',
    watermarkOpacity: 70,
    ...value,
  } as Record<string, unknown>;
  if (
    typeof item.showLinkPreview !== "boolean" ||
    typeof item.watermarkEnabled !== "boolean" ||
    typeof item.watermarkText !== "string" ||
    item.watermarkText.length > 40 ||
    !["bottom-right", "bottom-left", "top-right", "top-left"].includes(
      String(item.watermarkPosition),
    ) ||
    !Number.isInteger(item.watermarkOpacity) ||
    Number(item.watermarkOpacity) < 20 ||
    Number(item.watermarkOpacity) > 100 ||
    (item.watermarkEnabled && !item.watermarkText.trim()) ||
    (item.showLinkPreview && (!item.showLink || item.showImage))
  )
    throw new Error("Configuração de imagem inválida.");
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
    showLinkPreview: item.showLinkPreview as boolean,
    watermarkEnabled: item.watermarkEnabled as boolean,
    watermarkText: item.watermarkText as string,
    watermarkPosition:
      item.watermarkPosition as MessageTemplate["watermarkPosition"],
    watermarkOpacity: item.watermarkOpacity as number,
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
