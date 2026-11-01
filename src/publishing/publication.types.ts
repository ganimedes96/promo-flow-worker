import { MessageTemplate } from "./message-template";
import { Client } from "whatsapp-web.js";
export interface PublicationJob {
  messageTemplate?: MessageTemplate;
  messageHeadline?: string | null;
  connectionId: string;
  offerId: string;
  attemptId: string;
  userId: string;
  groupId: string;
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  affiliateUrl: string | null;
  couponCode?: string | null;
  currentPrice: string;
  originalPrice: string | null;
  discountPercentage: string | null;
  currency: string;
}
export type PublicationOutcome =
  | { outcome: "SUCCESS"; whatsappMessageId: string }
  | { outcome: "FAILED" | "UNKNOWN"; errorMessage: string };
export type PublicationReceipt = { attemptId: string } & PublicationOutcome;
export interface PublicationApi {
  claimPublication(connectionId: string): Promise<PublicationJob | null>;
  completePublication(receipt: PublicationReceipt): Promise<void>;
}
export interface PublicationSessions {
  readyConnectionIds(): string[];
  getReadyClient(connectionId: string): Client | undefined;
}
export interface PublicationProcessor {
  stop?(): void;
  poll(): Promise<void>;
}
