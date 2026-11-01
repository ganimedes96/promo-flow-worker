import { runtimeLog } from "../utils/runtime-log";
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
  private failed = false;
  private lastFailureAt = 0;
  private pending?: Promise<void>;
  constructor(
    private readonly api: HeartbeatApi,
    private readonly publishingEnabled: boolean,
  ) {}
  private async send(state: "RUNNING" | "STOPPED"): Promise<void> {
    try {
      await this.api.heartbeat(this.publishingEnabled, state);
      if (this.failed) runtimeLog("worker.heartbeat.recovered");
      this.failed = false;
    } catch (error: unknown) {
      if (!this.failed || Date.now() - this.lastFailureAt >= 30000) {
        runtimeLog("worker.heartbeat.failed", error);
        this.lastFailureAt = Date.now();
      }
      this.failed = true;
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
