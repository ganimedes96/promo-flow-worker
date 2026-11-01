import { captureMessageImage } from "./message-image";
import { setTimeout as delay } from "node:timers/promises";
import type { Message } from "whatsapp-web.js";
export interface CollectionConfig {
  collectorUrl?: string;
  collectorToken?: string;
}
interface Source {
  connectionId: string;
  accountPhone: string;
  whatsappId: string;
}
function productUrls(text: string) {
  return (text.match(/https:\/\/[^\s<>]+/gi) ?? [])
    .filter((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          (["mercadolivre.com.br", "amazon.com.br", "shopee.com.br"].some(
            (host) =>
              url.hostname === host || url.hostname.endsWith("." + host),
          ) ||
            ["meli.la", "amzn.to", "a.co", "shope.ee", "shp.ee"].includes(
              url.hostname,
            ))
        );
      } catch {
        return false;
      }
    })
    .filter((value) => value.length <= 2048)
    .slice(0, 30);
}
export class CollectionClient {
  private sources: Source[] = [];
  private checkedAt = 0;
  private active = 0;
  private stopping = false;
  private readonly abort = new AbortController();
  private tasks = new Set<Promise<void>>();
  private queue: Array<() => void> = [];
  constructor(
    private readonly config: CollectionConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string, body?: unknown) {
    const response = await this.fetcher(this.config.collectorUrl + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "x-collector-local-token": this.config.collectorToken ?? "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]),
    });
    if (!response.ok)
      throw new Error("Coletor local retornou HTTP " + response.status);
    return (await response.json()) as unknown;
  }
  private async enabled(connectionId: string, phone: string, chatId: string) {
    if (Date.now() - this.checkedAt > 10000) {
      this.sources = [];
      const value = await this.request("/internal/whatsapp/sources");
      if (
        !value ||
        typeof value !== "object" ||
        !("data" in value) ||
        !Array.isArray(value.data)
      )
        throw new Error("Fontes de coleta inválidas.");
      this.sources = value.data
        .filter(
          (item: unknown): item is Source =>
            !!item &&
            typeof item === "object" &&
            "connectionId" in item &&
            typeof item.connectionId === "string" &&
            "accountPhone" in item &&
            typeof item.accountPhone === "string" &&
            "whatsappId" in item &&
            typeof item.whatsappId === "string",
        )
        .slice(0, 500);
      this.checkedAt = Date.now();
    }
    return this.sources.some(
      (source) =>
        source.connectionId === connectionId &&
        source.accountPhone === phone &&
        source.whatsappId === chatId,
    );
  }
  receive(connectionId: string, phone: string, message: Message): void {
    if (
      !this.config.collectorUrl ||
      this.stopping ||
      message.fromMe ||
      !message.from.endsWith("@g.us") ||
      message.isStatus
    )
      return;
    const urls = productUrls(message.body || "");
    if (!urls.length) return;
    if (this.queue.length >= 100) {
      console.error("Fila de coleta WhatsApp cheia; mensagem não capturada.");
      return;
    }
    this.queue.push(() => {
      this.active++;
      const task = this.capture(connectionId, phone, message, urls)
        .catch(() => {
          if (!this.stopping)
            console.error(
              "Falha na coleta WhatsApp. Confira o coletor local e a API.",
            );
        })
        .finally(() => {
          this.active--;
          this.tasks.delete(task);
          this.drain();
        });
      this.tasks.add(task);
    });
    this.drain();
  }
  private drain() {
    while (!this.stopping && this.active < 3 && this.queue.length)
      this.queue.shift()?.();
  }

  private async capture(
    connectionId: string,
    phone: string,
    message: Message,
    urls: string[],
  ) {
    if (
      !(await this.enabled(connectionId, phone, message.from)) ||
      this.stopping
    )
      return;
    const image = await captureMessageImage(message, this.abort.signal);
    const imageBase64 = image.data;
    if (!imageBase64 && !this.stopping)
      console.warn(
        `Coleta WhatsApp sem foto após novas tentativas (tipo: ${message.type}). O rascunho será salvo para revisão.`,
      );
    else if (image.origin === "preview")
      console.log("Coleta WhatsApp: usando a prévia de imagem da mensagem.");
    if (this.stopping) return;
    const body = {
      connectionId,
      accountPhone: phone,
      chatId: message.from,
      messageId: message.id._serialized,
      messageDate: new Date(message.timestamp * 1000).toISOString(),
      fromMe: false,
      text: (message.body || "").slice(0, 12000),
      urls,
      ...(imageBase64 ? { imageBase64 } : {}),
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.request(
          "/internal/whatsapp/captures",
          body,
        );
        if (
          response &&
          typeof response === "object" &&
          "data" in response &&
          response.data &&
          typeof response.data === "object" &&
          "imageStatus" in response.data &&
          response.data.imageStatus === "invalid"
        )
          console.warn(
            "A imagem do WhatsApp não passou na normalização. O texto foi preservado.",
          );
        return;
      } catch (error) {
        if (this.stopping || attempt === 2) throw error;
        await delay(1000 * (attempt + 1), undefined, {
          signal: this.abort.signal,
        }).catch(() => undefined);
      }
    }
  }
  async stop() {
    this.stopping = true;
    this.queue = [];
    this.abort.abort();
    await Promise.allSettled(this.tasks);
  }
}
