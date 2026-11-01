import { WorkerHeartbeatLifecycle } from "./worker-heartbeat";
import { PublicationProcessor } from "../publishing/publication.types";
import { WorkerApi, SessionManager } from "../types/whatsapp.types";
import { runtimeLog } from "../utils/runtime-log";
import { WorkerLock } from "./worker-lock";
export class Worker {
  private stopping = false;
  private starting: Promise<void> = Promise.resolve();
  private shutdown?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private polling: Promise<void> = Promise.resolve();
  constructor(
    private readonly api: WorkerApi,
    private readonly sessions: SessionManager,
    private readonly lock: WorkerLock,
    private readonly interval: number,
    private readonly publications?: PublicationProcessor,
    private readonly heartbeat?: WorkerHeartbeatLifecycle,
    private readonly activity?: {
      poll(): Promise<void>;
      stop(): Promise<void>;
    },
  ) {}
  async start(): Promise<void> {
    this.starting = (async () => {
      await this.lock.acquire();
      if (!this.stopping) await this.heartbeat?.start();
    })();
    await this.starting;
    if (!this.stopping) this.polling = this.poll();
  }
  private async poll(): Promise<void> {
    try {
      const sessions = await this.api.getPendingSessions();
      for (const session of sessions) {
        if (this.stopping) break;
        if (session.status === "SUSPENDED" || session.status === "ERROR")
          await this.sessions.suspend(session.connectionId);
        else if (session.status === "DISCONNECTED")
          await this.sessions.disconnect(session.connectionId);
        else
          this.sessions.connect(
            session.connectionId,
            session.status,
            session.authKey,
          );
      }
      if (!this.stopping) await this.sessions.refreshGroups();
      if (!this.stopping)
        await this.activity
          ?.poll()
          .catch((error) => runtimeLog("group.activity.unavailable", error));
      if (!this.stopping) await this.publications?.poll();
    } catch (error: unknown) {
      runtimeLog("worker.poll.failed", error);
    }
    if (!this.stopping)
      this.timer = setTimeout(() => {
        this.polling = this.poll();
      }, this.interval);
  }
  stop(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    this.publications?.stop?.();
    if (this.timer) clearTimeout(this.timer);
    this.shutdown = this.finishShutdown();
    return this.shutdown;
  }
  private async finishShutdown(): Promise<void> {
    await this.starting.catch(() => undefined);
    try {
      await this.polling;
      await this.activity?.stop();
    } finally {
      try {
        await this.sessions.stop();
      } finally {
        try {
          await this.heartbeat?.stop();
        } finally {
          await this.lock.release();
        }
      }
    }
  }
}
