export class TelegramApiError extends Error {
  constructor(public readonly statusCode: number) {
    super(
      statusCode === 403
        ? "O bot não tem permissão para publicar neste destino."
        : statusCode === 429
          ? "Limite do Telegram atingido. Aguarde antes de tentar novamente."
          : "O Telegram recusou a operação. Confira o bot e as permissões do destino.",
    );
  }
}
export interface BotIdentity {
  botId: string;
  username: string;
}
export interface TelegramChat {
  id: number;
  type: "group" | "supergroup" | "channel";
  title: string;
}
export interface TelegramUpdate {
  updateId: number;
  text: string;
  chat: TelegramChat;
  fromId?: number;
  senderChatId?: number;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Resposta inválida do Telegram.");
  return value as Record<string, unknown>;
}
export function isAdmin(member: Record<string, unknown>) {
  return member.status === "creator" || member.status === "administrator";
}
export class TelegramBotClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!/^\d+:[a-zA-Z0-9_-]{20,}$/.test(token))
      throw new Error(
        "TELEGRAM_BOT_TOKEN inválido. Confira a configuração local.",
      );
  }
  async request(
    method: string,
    body: Record<string, unknown> | FormData,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.telegram.org/bot" + this.token + "/" + method,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          ...(body instanceof FormData
            ? { body }
            : {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
        },
      );
    } catch {
      throw new Error("Não foi possível confirmar a resposta do Telegram.");
    }
    const value: unknown = await response.json().catch(() => null);
    const payload = record(value);
    if (payload.ok !== true)
      throw new TelegramApiError(
        typeof payload.error_code === "number"
          ? payload.error_code
          : response.status,
      );
    return payload.result;
  }
  async identity(): Promise<BotIdentity> {
    const value = record(await this.request("getMe", {}));
    if (
      value.is_bot !== true ||
      typeof value.id !== "number" ||
      !Number.isSafeInteger(value.id) ||
      typeof value.username !== "string"
    )
      throw new Error("Identidade do bot inválida.");
    return { botId: String(value.id), username: value.username };
  }
  async assertPolling() {
    const info = record(await this.request("getWebhookInfo", {}));
    if (info.url)
      throw new Error(
        "Este bot já usa webhook. Configure um bot exclusivo para o worker ou remova o webhook antes de iniciar.",
      );
  }
  async updates(offset: number): Promise<TelegramUpdate[]> {
    const updates = await this.request("getUpdates", {
      offset,
      limit: 100,
      timeout: 0,
      allowed_updates: ["message", "channel_post", "my_chat_member"],
    });
    if (!Array.isArray(updates))
      throw new Error("Atualizações do bot inválidas.");
    const result: TelegramUpdate[] = [];
    for (const raw of updates) {
      const update = record(raw);
      if (
        typeof update.update_id !== "number" ||
        !Number.isSafeInteger(update.update_id)
      )
        throw new Error("Atualização inválida.");
      const message = record(update.message ?? update.channel_post ?? {});
      const chat = record(message.chat ?? {});
      const from = record(message.from ?? {}),
        sender = record(message.sender_chat ?? {});
      const type = chat.type;
      result.push({
        updateId: update.update_id,
        text: typeof message.text === "string" ? message.text : "",
        chat: {
          id:
            typeof chat.id === "number" && Number.isSafeInteger(chat.id)
              ? chat.id
              : 0,
          type: type === "channel" || type === "supergroup" ? type : "group",
          title: typeof chat.title === "string" ? chat.title : "",
        },
        fromId: typeof from.id === "number" ? from.id : undefined,
        senderChatId: typeof sender.id === "number" ? sender.id : undefined,
      });
    }
    return result;
  }
  async canPost(chatId: string, botId: string) {
    const member = record(
      await this.request("getChatMember", {
        chat_id: chatId,
        user_id: Number(botId),
      }),
    );
    return (
      isAdmin(member) &&
      member.can_send_messages !== false &&
      member.can_post_messages !== false
    );
  }
  async canAuthorize(update: TelegramUpdate) {
    if (
      update.chat.type === "channel" ||
      update.senderChatId === update.chat.id
    )
      return true;
    if (!update.fromId) return false;
    return isAdmin(
      record(
        await this.request("getChatMember", {
          chat_id: update.chat.id,
          user_id: update.fromId,
        }),
      ),
    );
  }
  async participantCount(chatId: string): Promise<number | undefined> {
    try {
      const count = await this.request("getChatMemberCount", {
        chat_id: chatId,
      });
      return typeof count === "number" &&
        Number.isSafeInteger(count) &&
        count >= 0
        ? count
        : undefined;
    } catch {
      return undefined;
    }
  }
  async send(
    chatId: string,
    caption: string,
    preview: boolean,
    media?: { data: string; mimetype: string },
  ) {
    let result: unknown;
    if (media) {
      const body = new FormData();
      body.set("chat_id", chatId);
      body.set("caption", caption);
      body.set("parse_mode", "HTML");
      const bytes = Buffer.from(media.data, "base64");
      if (bytes.length > 10 * 1024 * 1024) throw new TelegramApiError(400);
      body.set(
        "photo",
        new Blob([new Uint8Array(bytes)], { type: media.mimetype }),
        "oferta." + (media.mimetype === "image/png" ? "png" : "jpg"),
      );
      result = await this.request("sendPhoto", body);
    } else
      result = await this.request("sendMessage", {
        chat_id: chatId,
        text: caption,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: !preview },
      });
    const message = record(result),
      chat = record(message.chat);
    if (
      typeof message.message_id !== "number" ||
      !Number.isSafeInteger(message.message_id) ||
      String(chat.id) !== chatId
    )
      throw new Error("Telegram não confirmou a mensagem no destino esperado.");
    return "telegram:" + chatId + ":" + message.message_id;
  }
}
