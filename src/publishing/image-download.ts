import { largerProductImage } from "./product-image";
import { lookup } from "node:dns/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { MessageMedia } from "whatsapp-web.js";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
function publicIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
async function download(source: string, redirects = 0): Promise<Buffer> {
  const url = new URL(source);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.includes(":") ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("A imagem precisa ter um endereço HTTP público válido.");
  if (redirects > 3)
    throw new Error("A imagem possui redirecionamentos demais.");
  const { address } = await lookup(url.hostname, { family: 4 });
  if (!publicIPv4(address))
    throw new Error(
      "Endereços locais ou privados não são aceitos para imagens.",
    );
  return new Promise<Buffer>((resolve, reject) => {
    const get = url.protocol === "https:" ? httpsGet : httpGet;
    const request = get(
      url,
      {
        family: 4,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
        signal: AbortSignal.timeout(20000),
        headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          void download(
            new URL(response.headers.location, url).toString(),
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              "Não foi possível baixar a imagem: HTTP " + response.statusCode,
            ),
          );
          return;
        }
        if (Number(response.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES) {
          response.resume();
          request.destroy(new Error("A imagem excede 10 MB."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            response.destroy(new Error("A imagem excede 10 MB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}
export async function downloadImage(source: string): Promise<MessageMedia> {
  const larger = largerProductImage(source);
  let bytes: Buffer;
  if (larger === source) {
    bytes = await download(source);
  } else {
    try {
      bytes = await download(larger);
    } catch {
      bytes = await download(source);
    }
  }
  const mime = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP"
        ? "image/webp"
        : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
          ? "image/gif"
          : null;
  if (!mime)
    throw new Error("Formato de imagem inválido. Use PNG, JPEG, WebP ou GIF.");
  return new MessageMedia(
    mime,
    bytes.toString("base64"),
    "oferta." + mime.split("/")[1],
  );
}
