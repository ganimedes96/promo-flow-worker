import { Client } from "whatsapp-web.js";
export interface PublicationJob {
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
  claimPublication(userId: string): Promise<PublicationJob | null>;
  completePublication(receipt: PublicationReceipt): Promise<void>;
}
export interface PublicationSessions {
  readyUserIds(): string[];
  getReadyClient(userId: string): Client | undefined;
}
export interface PublicationProcessor {
  poll(): Promise<void>;
}
