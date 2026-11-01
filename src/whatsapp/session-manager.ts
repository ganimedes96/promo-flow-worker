import { Client, Message, GroupNotification } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import {
  SessionManager,
  SessionStatus,
  SessionUpdate,
  WorkerApi,
} from "../types/whatsapp.types";
import { errorMessage } from "../utils/error-message";
import { GroupSyncService } from "./group-sync.service";
interface SessionRuntime {
  client: Client;
  startedAt: number;
  closing: boolean;
  updates: Promise<void>;
  ready: boolean;
  reportedReady: boolean;
  nextGroupSyncAt: number;
  groupSync: Promise<void> | null;
}
export class WhatsAppSessionManager implements SessionManager {
  private readonly clients = new Map<string, SessionRuntime>();
  private stopping = false;
  constructor(
    private readonly api: WorkerApi,
    private readonly groups: GroupSyncService,
    private readonly createClient: (authKey: string) => Client,
    private readonly options: {
      onGroupActivity?: (
        id: string,
        phone: string,
        kind: "JOIN" | "LEAVE",
        notification: GroupNotification,
      ) => void;
      onMessage?: (
        connectionId: string,
        phone: string,
        message: Message,
      ) => void;
      maxSessions: number;
      sessionStartTimeoutMs: number;
      showQrInTerminal: boolean;
    } = {
      maxSessions: 5,
      sessionStartTimeoutMs: 180000,
      showQrInTerminal: true,
    },
  ) {}
  private report(
    connectionId: string,
    runtime: SessionRuntime,
    body: SessionUpdate,
  ): Promise<void> {
    runtime.updates = runtime.updates
      .catch(() => undefined)
      .then(() => this.api.updateSession(connectionId, body));
    void runtime.updates.catch((error: unknown) =>
      console.error("Falha ao sincronizar sessão:", errorMessage(error)),
    );
    return runtime.updates;
  }
  private async remove(
    connectionId: string,
    runtime: SessionRuntime,
  ): Promise<void> {
    runtime.closing = true;
    try {
      await runtime.client.destroy();
    } catch {
      /* navegador já encerrado */
    }
    if (this.clients.get(connectionId) === runtime)
      this.clients.delete(connectionId);
  }
  readyConnectionIds(): string[] {
    return [...this.clients]
      .filter(
        ([, runtime]) =>
          runtime.ready &&
          runtime.reportedReady &&
          !runtime.closing &&
          !this.stopping,
      )
      .map(([id]) => id);
  }
  getReadyClient(connectionId: string): Client | undefined {
    const runtime = this.clients.get(connectionId);
    return runtime?.ready &&
      runtime.reportedReady &&
      !runtime.closing &&
      !this.stopping
      ? runtime.client
      : undefined;
  }
  connect(
    connectionId: string,
    status?: SessionStatus,
    authKey?: string,
  ): void {
    if (this.stopping) return;
    const existing = this.clients.get(connectionId);
    if (existing) {
      if (
        status === "CONNECTING" &&
        existing.reportedReady &&
        !existing.closing
      ) {
        void this.disconnect(connectionId)
          .then(() => this.connect(connectionId, undefined, authKey))
          .catch((error: unknown) =>
            console.error("Falha ao trocar a conexão:", errorMessage(error)),
          );
      }
      return;
    }
    if (this.clients.size >= this.options.maxSessions) {
      void this.api
        .updateSession(connectionId, {
          status: "ERROR",
          errorMessage:
            "A capacidade de conexão está momentaneamente ocupada. Tente novamente em instantes.",
        })
        .catch((error) =>
          console.error("Falha ao informar capacidade:", errorMessage(error)),
        );
      return;
    }
    const client = this.createClient(authKey ?? connectionId);
    const runtime: SessionRuntime = {
      client,
      startedAt: Date.now(),
      closing: false,
      updates: Promise.resolve(),
      ready: false,
      reportedReady: false,
      nextGroupSyncAt: 0,
      groupSync: null,
    };
    this.clients.set(connectionId, runtime);
    client.on("message", (message: Message) => {
      if (
        runtime.ready &&
        runtime.reportedReady &&
        !runtime.closing &&
        !this.stopping &&
        client.info?.wid.user
      )
        this.options.onMessage?.(connectionId, client.info.wid.user, message);
    });
    client.on("qr", (qr: string) => {
      if (runtime.closing) return;
      runtime.ready = false;
      runtime.reportedReady = false;
      console.log("Leia o QR Code em Aparelhos conectados: " + connectionId);
      if (this.options.showQrInTerminal) qrcode.generate(qr, { small: true });
      this.report(connectionId, runtime, { status: "WAITING_QR", qrCode: qr });
    });
    client.on("authenticated", () => {
      if (!runtime.closing)
        this.report(connectionId, runtime, { status: "AUTHENTICATED" });
    });
    client.on("ready", () => {
      if (runtime.closing) return;
      console.log("WhatsApp pronto: " + connectionId);
      runtime.ready = true;
      runtime.reportedReady = false;
      void this.synchronizeGroups(connectionId, runtime);
    });
    for (const event of ["group_join", "group_leave"] as const) {
      client.on(event, (notification: GroupNotification) => {
        if (runtime.closing || this.stopping) return;
        if (runtime.ready && runtime.reportedReady && client.info?.wid.user)
          this.options.onGroupActivity?.(
            connectionId,
            client.info.wid.user,
            event === "group_join" ? "JOIN" : "LEAVE",
            notification,
          );
        runtime.nextGroupSyncAt = 0;
        void this.synchronizeGroups(connectionId, runtime);
      });
    }
    client.on("auth_failure", () => {
      if (runtime.closing) return;
      this.report(connectionId, runtime, {
        status: "ERROR",
        errorMessage: "Falha de autenticação; solicite nova conexão",
      });
      void this.remove(connectionId, runtime);
    });
    client.on("disconnected", () => {
      if (runtime.closing || this.stopping) return;
      this.report(connectionId, runtime, { status: "CONNECTING" });
      void this.remove(connectionId, runtime);
    });
    void client
      .initialize()
      .then(async () => {
        // Initialization may finish after Ctrl+C while Chrome was still launching.
        if (runtime.closing || this.stopping)
          await this.remove(connectionId, runtime);
      })
      .catch(async () => {
        if (runtime.closing || this.stopping) return;
        this.report(connectionId, runtime, {
          status: "ERROR",
          errorMessage:
            "Falha ao iniciar navegador; confira instalação e CHROME_PATH",
        });
        await this.remove(connectionId, runtime);
      });
  }
  private async synchronizeGroups(
    connectionId: string,
    runtime: SessionRuntime,
  ): Promise<void> {
    if (!runtime.ready || runtime.closing || this.stopping) return;
    if (runtime.groupSync) return runtime.groupSync;
    // Reserva o próximo horário antes de iniciar para evitar chamadas concorrentes.
    runtime.nextGroupSyncAt = Date.now() + 60_000;
    runtime.groupSync = (async () => {
      if (!runtime.reportedReady) {
        await this.report(connectionId, runtime, {
          status: "READY",
          connectedPhone: runtime.client.info.wid.user,
          connectedName:
            runtime.client.info.pushname?.trim().slice(0, 200) || undefined,
        });
        if (runtime.closing || this.stopping) return;
        runtime.reportedReady = true;
      }
      await this.groups.execute(connectionId, runtime.client);
    })()
      .catch((error: unknown) => {
        runtime.nextGroupSyncAt = Date.now() + 15_000;
        console.error("Falha ao sincronizar grupos:", errorMessage(error));
      })
      .finally(() => {
        runtime.groupSync = null;
      });
    await runtime.groupSync;
  }
  async refreshGroups(): Promise<void> {
    for (const [id, runtime] of this.clients) {
      if (
        !runtime.ready &&
        !runtime.closing &&
        Date.now() - runtime.startedAt > this.options.sessionStartTimeoutMs
      ) {
        await this.report(id, runtime, {
          status: "ERROR",
          errorMessage:
            "O tempo para conectar expirou. Solicite uma nova conexão.",
        }).catch(() => undefined);
        await this.remove(id, runtime);
      }
    }
    await Promise.all(
      [...this.clients]
        .filter(([, runtime]) => runtime.nextGroupSyncAt <= Date.now())
        .map(([id, runtime]) => this.synchronizeGroups(id, runtime)),
    );
  }
  async suspend(connectionId: string): Promise<void> {
    const runtime = this.clients.get(connectionId);
    if (!runtime || runtime.closing) return;
    runtime.closing = true;
    await runtime.updates.catch(() => undefined);
    await runtime.groupSync;
    // Close the browser without logging out or deleting LocalAuth data.
    await this.remove(connectionId, runtime);
  }
  async disconnect(connectionId: string): Promise<void> {
    const runtime = this.clients.get(connectionId);
    if (!runtime || runtime.closing) return;
    runtime.closing = true;
    await runtime.updates.catch(() => undefined);
    await runtime.groupSync;
    await runtime.client.logout().catch(() => undefined);
    await this.remove(connectionId, runtime);
  }
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.clients].map(async ([id, runtime]) => {
        runtime.closing = true;
        await runtime.updates.catch(() => undefined);
        await runtime.groupSync;
        await this.remove(id, runtime);
      }),
    );
  }
}
