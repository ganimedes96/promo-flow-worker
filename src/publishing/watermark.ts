import sharp from "sharp";
import { MessageMedia } from "whatsapp-web.js";
import { MessageTemplate } from "./message-template";
const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
export async function applyWatermark(
  media: MessageMedia,
  template: MessageTemplate,
): Promise<MessageMedia> {
  if (!template.watermarkEnabled) return media;
  const text = template.watermarkText.trim();
  if (!text || text.length > 40)
    throw new Error("Texto da marca d’água inválido.");
  try {
    const image = sharp(Buffer.from(media.data, "base64"), {
      limitInputPixels: 40000000,
    })
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      });
    const base = await image.toBuffer({ resolveWithObject: true });
    const { width, height } = base.info;
    const font = Math.max(8, Math.round(Math.min(width, height) * 0.045));
    const padding = Math.max(2, Math.round(font * 0.45));
    const badgeWidth = Math.min(
      width,
      Math.ceil(text.length * font * 0.72 + padding * 2),
    );
    const badgeHeight = Math.min(height, font + padding * 2);
    const overlay = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}"><g opacity="${template.watermarkOpacity / 100}"><rect width="100%" height="100%" rx="${padding}" fill="#132d24"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${font}" textLength="${Math.max(1, badgeWidth - padding * 2)}" lengthAdjust="spacingAndGlyphs" fill="white">${escapeXml(text)}</text></g></svg>`,
    );
    const margin = Math.round(Math.min(width, height) * 0.025);
    const left = template.watermarkPosition.endsWith("right")
      ? Math.max(0, width - badgeWidth - margin)
      : Math.min(margin, width - badgeWidth);
    const top = template.watermarkPosition.startsWith("bottom")
      ? Math.max(0, height - badgeHeight - margin)
      : Math.min(margin, height - badgeHeight);
    const output = await sharp(base.data)
      .composite([{ input: overlay, left, top }])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    return new MessageMedia(
      "image/jpeg",
      output.toString("base64"),
      "oferta.jpg",
    );
  } catch {
    throw new Error(
      "Não foi possível aplicar a marca d’água. Revise a imagem antes de tentar novamente.",
    );
  }
}
