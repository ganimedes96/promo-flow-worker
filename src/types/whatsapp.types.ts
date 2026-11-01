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
  connectionId: string;
  authKey: string;
  userId: string;
  status: SessionStatus | "SUSPENDED";
}
export interface WhatsAppGroup {
  whatsappId: string;
  name: string;
  participantCount?: number;
  isCommunity?: boolean;
}
export interface GroupActivity {
  eventId: string;
  whatsappId: string;
  kind: "JOIN" | "LEAVE";
  count: number;
  occurredAt: string;
}
export interface GroupActivityBatch {
  connectedPhone: string;
  events: GroupActivity[];
}
export type SessionUpdate =
  | { status: "WAITING_QR"; qrCode: string }
  | { status: "AUTHENTICATED" | "CONNECTING" }
  | { status: "READY"; connectedPhone: string; connectedName?: string }
  | { status: "ERROR"; errorMessage: string };
export interface WorkerApi {
  getPendingSessions(): Promise<PendingSession[]>;
  updateSession(connectionId: string, update: SessionUpdate): Promise<void>;
  synchronizeGroups(
    connectionId: string,
    groups: WhatsAppGroup[],
    connectedPhone: string,
  ): Promise<void>;
}
export interface SessionManager {
  connect(connectionId: string, status?: SessionStatus, authKey?: string): void;
  refreshGroups(): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  suspend(connectionId: string): Promise<void>;
  stop(): Promise<void>;
}
