import { errorMessage } from "../utils/error-message";
interface HeartbeatApi {
  heartbeat(
    publishingEnabled: boolean,
    state: "RUNNING" | "STOPPED",
  ): Promise<void>;
}
export interface WorkerHeartbeatLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}
export class WorkerHeartbeat implements WorkerHeartbeatLifecycle {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  constructor(
    private readonly api: HeartbeatApi,
    private readonly publishingEnabled: boolean,
  ) {}
  private async send(state: "RUNNING" | "STOPPED"): Promise<void> {
    try {
      await this.api.heartbeat(this.publishingEnabled, state);
    } catch (error: unknown) {
      console.error(
        "Falha ao atualizar atividade do worker:",
        errorMessage(error),
      );
    }
  }
  async start(): Promise<void> {
    await this.send("RUNNING");
    this.timer = setInterval(() => {
      if (this.pending) return;
      this.pending = this.send("RUNNING").finally(() => {
        this.pending = undefined;
      });
    }, 10000);
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.send("STOPPED");
  }
}
