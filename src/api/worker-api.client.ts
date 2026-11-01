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
  GroupActivityBatch,
  SessionUpdate,
  WhatsAppGroup,
  WorkerApi,
} from "../types/whatsapp.types";
import { parseApiData, parsePendingSessions } from "./response.validation";
export class WorkerApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly requestId?: string,
  ) {
    super(
      "API retornou HTTP " +
        statusCode +
        (requestId ? " (referência " + requestId + ")" : ""),
    );
    this.name = "WorkerApiError";
  }
}
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
        "x-worker-protocol": "connections-v1",
        "x-worker-features": "message-template-v1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const requestId =
        typeof payload === "object" &&
        payload !== null &&
        "requestId" in payload &&
        typeof payload.requestId === "string" &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(payload.requestId)
          ? payload.requestId
          : undefined;
      throw new WorkerApiError(response.status, requestId);
    }
    const payload: unknown = await response.json();
    return parseApiData(payload);
  }
  async claimPublication(connectionId: string): Promise<PublicationJob | null> {
    return parsePublicationJob(
      await this.request("/internal/offers/claim", "POST", {
        connectionId,
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
  async updateSession(
    connectionId: string,
    update: SessionUpdate,
  ): Promise<void> {
    const result = await this.request(
      "/internal/whatsapp/connections/" +
        encodeURIComponent(connectionId) +
        "/session",
      "PUT",
      update,
    );
    if (
      update.status === "READY" &&
      (!result ||
        typeof result !== "object" ||
        !("count" in result) ||
        result.count !== 1)
    )
      throw new Error(
        "A API recusou esta conexão. Atualize o estado no painel.",
      );
  }
  async recordGroupActivity(
    connectionId: string,
    body: GroupActivityBatch,
  ): Promise<{ accepted: string[] }> {
    const result = await this.request(
      "/internal/whatsapp/connections/" +
        encodeURIComponent(connectionId) +
        "/group-activity",
      "PUT",
      body,
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("accepted" in result) ||
      !Array.isArray(result.accepted) ||
      !result.accepted.every(
        (id: unknown) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id),
      )
    )
      throw new Error("Resposta de atividade inválida.");
    return { accepted: result.accepted as string[] };
  }
  async synchronizeGroups(
    connectionId: string,
    groups: WhatsAppGroup[],
    connectedPhone: string,
  ): Promise<void> {
    await this.request(
      "/internal/whatsapp/connections/" +
        encodeURIComponent(connectionId) +
        "/groups",
      "PUT",
      { groups, connectedPhone, tracksMembership: true },
    );
  }
}
