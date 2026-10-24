import { randomUUID } from "node:crypto";
import {
  PublicationApi,
  PublicationJob,
  PublicationReceipt,
} from "../publishing/publication.types";
import { parsePublicationJob } from "../publishing/publication.validation";
import { WorkerConfig } from "../config/worker.config";
import {
  PendingSession,
  SessionUpdate,
  WhatsAppGroup,
  WorkerApi,
} from "../types/whatsapp.types";
import { parseApiData, parsePendingSessions } from "./response.validation";
type HttpMethod = "GET" | "PUT" | "POST";
export class WorkerApiClient implements WorkerApi, PublicationApi {
  private readonly instanceId = randomUUID();
  async heartbeat(
    publishingEnabled: boolean,
    state: "RUNNING" | "STOPPED",
  ): Promise<void> {
    await this.request("/internal/whatsapp/heartbeat", "PUT", {
      instanceId: this.instanceId,
      publishingEnabled,
      state,
    });
  }
  constructor(
    private readonly config: Pick<WorkerConfig, "apiUrl" | "apiToken">,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    method: HttpMethod = "GET",
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.fetcher(this.config.apiUrl + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-worker-token": this.config.apiToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("API retornou HTTP " + response.status);
    const payload: unknown = await response.json();
    return parseApiData(payload);
  }
  async claimPublication(userId: string): Promise<PublicationJob | null> {
    return parsePublicationJob(
      await this.request("/internal/offers/claim", "POST", {
        userId,
        workerInstanceId: this.instanceId,
      }),
    );
  }
  async completePublication(receipt: PublicationReceipt): Promise<void> {
    const { attemptId, ...body } = receipt;
    await this.request(
      "/internal/offers/attempts/" + encodeURIComponent(attemptId) + "/result",
      "POST",
      body,
    );
  }
  async getPendingSessions(): Promise<PendingSession[]> {
    return parsePendingSessions(
      await this.request("/internal/whatsapp/actions/pending"),
    );
  }
  async updateSession(userId: string, update: SessionUpdate): Promise<void> {
    await this.request(
      "/internal/whatsapp/users/" + encodeURIComponent(userId) + "/session",
      "PUT",
      update,
    );
  }
  async synchronizeGroups(
    userId: string,
    groups: WhatsAppGroup[],
  ): Promise<void> {
    await this.request(
      "/internal/whatsapp/users/" + encodeURIComponent(userId) + "/groups",
      "PUT",
      { groups },
    );
  }
}
