import { setTimeout as delay } from "node:timers/promises";
import type { Message } from "whatsapp-web.js";
const MAX_BASE64_LENGTH = 5592408;
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
export function previewImage(raw: unknown): string | undefined {
  if (!record(raw)) return;
  const preview = record(raw.linkPreview) ? raw.linkPreview : undefined;
  const candidates = [
    raw.jpegThumbnail,
    raw.thumbnail,
    raw.thumbnailJpeg,
    preview?.jpegThumbnail,
    preview?.thumbnail,
    raw.type === "image" ? raw.body : undefined,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate !== "string" ||
      candidate.length > MAX_BASE64_LENGTH + 64
    )
      continue;
    const data = candidate.replace(
      /^data:image\/(?:jpeg|png|webp);base64,/i,
      "",
    );
    if (
      !data.length ||
      data.length > MAX_BASE64_LENGTH ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      continue;
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) continue;
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP";
    if (jpeg || png || webp) return data;
  }
  return undefined;
}
async function bounded<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (signal.aborted) return;
  let cancel = () => {};
  const interrupted = new Promise<undefined>((resolve) => {
    cancel = () => resolve(undefined);
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(task), interrupted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
export async function captureMessageImage(
  message: Message,
  stop: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = async (
    ms,
    signal,
  ) => {
    await delay(ms, undefined, { signal });
  },
): Promise<{ data?: string; origin: "media" | "preview" | "missing" }> {
  const signal = AbortSignal.any([stop, AbortSignal.timeout(15000)]);
  let current = message,
    preview: string | undefined;
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    if (attempt > 0) {
      try {
        await wait(attempt * 1000, signal);
      } catch {
        break;
      }
      if (signal.aborted) break;
      try {
        current = (await bounded(() => message.reload(), signal)) || current;
      } catch {
        /* Preserve the received message if refresh fails. */
      }
    }
    const raw: unknown = current.rawData;
    preview = previewImage(raw) || preview;
    const imageDocument =
      current.type === "document" &&
      record(raw) &&
      typeof raw.mimetype === "string" &&
      mimeTypes.has(raw.mimetype);
    if (current.hasMedia && (current.type === "image" || imageDocument)) {
      try {
        const media = await bounded(() => current.downloadMedia(), signal);
        if (
          media &&
          mimeTypes.has(media.mimetype.split(";")[0].trim().toLowerCase()) &&
          media.data &&
          media.data.length <= MAX_BASE64_LENGTH
        )
          return { data: media.data, origin: "media" };
      } catch {
        /* Retry transient media errors, then use only an embedded image preview. */
      }
    }
    if (preview && current.type !== "image" && !imageDocument)
      return { data: preview, origin: "preview" };
  }
  return preview ? { data: preview, origin: "preview" } : { origin: "missing" };
}
