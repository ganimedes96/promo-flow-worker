import { Client } from "whatsapp-web.js";
import { WhatsAppGroup } from "../types/whatsapp.types";

declare global {
  interface Window {
    require?: (module: string) => unknown;
  }
}

// getChats serializa mensagens e participantes que não são necessários para listar grupos.
// Mantém uma leitura mínima como fallback para a incompatibilidade do whatsapp-web.js 1.34.7.
export async function readGroups(
  client: Pick<Client, "getChats" | "pupPage">,
): Promise<WhatsAppGroup[]> {
  try {
    const chats = await client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ whatsappId: chat.id._serialized, name: chat.name }));
  } catch (error: unknown) {
    if (!client.pupPage) throw error;
    console.warn(
      "getChats indisponível; consultando apenas IDs e nomes de grupos.",
    );
    const result: unknown = await client.pupPage.evaluate(() => {
      // Avoid named inner functions: tsx injects __name outside the browser context.
      const collections: unknown = window.require?.("WAWebCollections");
      if (
        typeof collections !== "object" || collections === null ||
        !("Chat" in collections) || typeof collections.Chat !== "object" || collections.Chat === null || !("getModelsArray" in collections.Chat) ||
        typeof collections.Chat.getModelsArray !== "function"
      ) {
        throw new Error("Coleção de grupos indisponível");
      }
      const chats: unknown = Reflect.apply(
        collections.Chat.getModelsArray,
        collections.Chat,
        [],
      );
      if (!Array.isArray(chats)) throw new Error("Coleção de grupos inválida");
      const groups: { whatsappId: string; name: string }[] = [];
      for (const value of chats) {
        const chat: unknown = value;
        if (typeof chat !== "object" || chat === null || !("id" in chat) || typeof chat.id !== "object" || chat.id === null) continue;
        const idRecord = chat.id as Record<string, unknown>;
        const chatRecord = chat as Record<string, unknown>;
        const id =
          typeof idRecord._serialized === "string"
            ? idRecord._serialized
            : idRecord.$1;
        if (typeof id !== "string" || !/^\d+(?:-\d+)?@g\.us$/.test(id)) {
          if (chatRecord.groupMetadata)
            throw new Error("Identificador de grupo não reconhecido");
          continue;
        }
        const metadata = typeof chatRecord.groupMetadata === "object" && chatRecord.groupMetadata !== null
          ? chatRecord.groupMetadata as Record<string, unknown> : {};
        const name = [chatRecord.name, chatRecord.formattedTitle, metadata.subject].find(
          (name): name is string => typeof name === "string" && name.length > 0,
        );
        if (!name) throw new Error("Nome de grupo indisponível");
        groups.push({ whatsappId: id, name });
      }
      return groups;
    });
    if (!Array.isArray(result)) throw new Error("Resposta de grupos inválida");
    return result.map((item: unknown): WhatsAppGroup => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("whatsappId" in item) ||
        typeof item.whatsappId !== "string" ||
        !/^\d+(?:-\d+)?@g\.us$/.test(item.whatsappId) ||
        !("name" in item) ||
        typeof item.name !== "string"
      ) {
        throw new Error("Grupo inválido");
      }
      return { whatsappId: item.whatsappId, name: item.name };
    });
  }
}
