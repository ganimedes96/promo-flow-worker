export const SESSION_STATUSES = [
  "DISCONNECTED",
  "CONNECTING",
  "WAITING_QR",
  "AUTHENTICATED",
  "READY",
  "ERROR",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export interface PendingSession {
  userId: string;
  status: SessionStatus;
}
export interface WhatsAppGroup {
  whatsappId: string;
  name: string;
}
export type SessionUpdate =
  | { status: "WAITING_QR"; qrCode: string }
  | { status: "AUTHENTICATED" | "CONNECTING" }
  | { status: "READY"; connectedPhone: string; connectedName?: string }
  | { status: "ERROR"; errorMessage: string };
export interface WorkerApi {
  getPendingSessions(): Promise<PendingSession[]>;
  updateSession(userId: string, update: SessionUpdate): Promise<void>;
  synchronizeGroups(userId: string, groups: WhatsAppGroup[]): Promise<void>;
}
export interface SessionManager {
  connect(userId: string): void;
  refreshGroups(): Promise<void>;
  disconnect(userId: string): Promise<void>;
  stop(): Promise<void>;
}
