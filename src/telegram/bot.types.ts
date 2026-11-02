import { BotIdentity } from "./bot.client";
export interface TelegramDestination {
  connectionId: string;
  groupId: string;
  chatId: string;
  botId: string;
}
export interface BindTelegramDestination extends BotIdentity {
  code: string;
  chatId: string;
  name: string;
  chatType: string;
  participantCount?: number;
}
export interface TelegramPublisherApi {
  registerTelegramBot(identity: BotIdentity): Promise<void>;
  bindTelegramDestination(input: BindTelegramDestination): Promise<boolean>;
  telegramDestinations(): Promise<TelegramDestination[]>;
  telegramAvailability(groupId: string, available: boolean): Promise<void>;
}
