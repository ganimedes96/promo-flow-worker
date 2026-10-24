import { Client } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import {
  SessionManager,
  SessionUpdate,
  WorkerApi,
} from "../types/whatsapp.types";
import { errorMessage } from "../utils/error-message";
import { GroupSyncService } from "./group-sync.service";
interface SessionRuntime {
  client: Client;
  closing: boolean;
  updates: Promise<void>;
  ready: boolean;
  nextGroupSyncAt: number;
  groupSync: Promise<void> | null;
}
export class WhatsAppSessionManager implements SessionManager {
  private readonly clients = new Map<string, SessionRuntime>();
  private stopping = false;
  constructor(
    private readonly api: WorkerApi,
    private readonly groups: GroupSyncService,
    private readonly createClient: (userId: string) => Client,
  ) {}
  private report(
    userId: string,
    runtime: SessionRuntime,
    body: SessionUpdate,
  ): void {
    runtime.updates = runtime.updates
      .catch(() => undefined)
      .then(() => this.api.updateSession(userId, body));
    void runtime.updates.catch((error: unknown) =>
      console.error("Falha ao sincronizar sessão:", errorMessage(error)),
    );
  }
  private async remove(userId: string, runtime: SessionRuntime): Promise<void> {
    runtime.closing = true;
    try {
      await runtime.client.destroy();
    } catch {
      /* navegador já encerrado */
    }
    if (this.clients.get(userId) === runtime) this.clients.delete(userId);
  }
  readyUserIds(): string[] {
    return [...this.clients]
      .filter(
        ([, runtime]) => runtime.ready && !runtime.closing && !this.stopping,
      )
      .map(([id]) => id);
  }
  getReadyClient(userId: string): Client | undefined {
    const runtime = this.clients.get(userId);
    return runtime?.ready && !runtime.closing && !this.stopping
      ? runtime.client
      : undefined;
  }
  connect(userId: string): void {
    if (this.clients.has(userId) || this.stopping) return;
    const client = this.createClient(userId);
    const runtime: SessionRuntime = {
      client,
      closing: false,
      updates: Promise.resolve(),
      ready: false,
      nextGroupSyncAt: 0,
      groupSync: null,
    };
    this.clients.set(userId, runtime);
    client.on("qr", (qr: string) => {
      if (runtime.closing) return;
      console.log("Leia o QR Code em Aparelhos conectados: " + userId);
      qrcode.generate(qr, { small: true });
      this.report(userId, runtime, { status: "WAITING_QR", qrCode: qr });
    });
    client.on("authenticated", () => {
      if (!runtime.closing)
        this.report(userId, runtime, { status: "AUTHENTICATED" });
    });
    client.on("ready", () => {
      if (runtime.closing) return;
      console.log("WhatsApp pronto: " + userId);
      this.report(userId, runtime, {
        status: "READY",
        connectedPhone: client.info.wid.user,
        connectedName: client.info.pushname?.trim().slice(0, 200) || undefined,
      });
      runtime.ready = true;
      void this.synchronizeGroups(userId, runtime);
    });
    for (const event of ["group_join", "group_leave"] as const) {
      client.on(event, () => {
        if (runtime.closing || this.stopping) return;
        runtime.nextGroupSyncAt = 0;
        void this.synchronizeGroups(userId, runtime);
      });
    }
    client.on("auth_failure", () => {
      if (runtime.closing) return;
      this.report(userId, runtime, {
        status: "ERROR",
        errorMessage: "Falha de autenticação; solicite nova conexão",
      });
      void this.remove(userId, runtime);
    });
    client.on("disconnected", () => {
      if (runtime.closing || this.stopping) return;
      this.report(userId, runtime, { status: "CONNECTING" });
      void this.remove(userId, runtime);
    });
    void client.initialize().then(async () => {
      // Initialization may finish after Ctrl+C while Chrome was still launching.
      if (runtime.closing || this.stopping) await this.remove(userId, runtime);
    }).catch(async () => {
      if (runtime.closing || this.stopping) return;
      this.report(userId, runtime, {
        status: "ERROR",
        errorMessage:
          "Falha ao iniciar navegador; confira instalação e CHROME_PATH",
      });
      await this.remove(userId, runtime);
    });
  }
  private async synchronizeGroups(
    userId: string,
    runtime: SessionRuntime,
  ): Promise<void> {
    if (!runtime.ready || runtime.closing || this.stopping) return;
    if (runtime.groupSync) return runtime.groupSync;
    // Reserva o próximo horário antes de iniciar para evitar chamadas concorrentes.
    runtime.nextGroupSyncAt = Date.now() + 60_000;
    runtime.groupSync = this.groups
      .execute(userId, runtime.client)
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
    await Promise.all(
      [...this.clients]
        .filter(([, runtime]) => runtime.nextGroupSyncAt <= Date.now())
        .map(([id, runtime]) => this.synchronizeGroups(id, runtime)),
    );
  }
  async disconnect(userId: string): Promise<void> {
    const runtime = this.clients.get(userId);
    if (!runtime || runtime.closing) return;
    runtime.closing = true;
    await runtime.updates.catch(() => undefined);
    await runtime.groupSync;
    await runtime.client.logout().catch(() => undefined);
    await this.remove(userId, runtime);
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
