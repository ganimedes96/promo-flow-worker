import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import type { GroupNotification } from "whatsapp-web.js";
import { GroupActivity, GroupActivityBatch } from "../types/whatsapp.types";
import { runtimeLog } from "../utils/runtime-log";
interface ActivityApi {
  recordGroupActivity(
    id: string,
    body: GroupActivityBatch,
  ): Promise<{ accepted: string[] }>;
}
interface Pending {
  connectionId: string;
  phone: string;
  event: GroupActivity;
}
export function activityFromNotification(
  kind: "JOIN" | "LEAVE",
  notification: GroupNotification,
): GroupActivity | null {
  if (!notification || typeof notification !== "object") return null;
  const raw =
    typeof notification.id === "object" && notification.id !== null
      ? (notification.id as Record<string, unknown>)
      : {};
  const id =
    typeof raw._serialized === "string"
      ? raw._serialized
      : typeof raw.id === "string"
        ? raw.id
        : null;
  if (
    !id ||
    !/^\d+(?:-\d+)?@g\.us$/.test(notification.chatId) ||
    !Array.isArray(notification.recipientIds)
  )
    return null;
  const count = new Set(
    notification.recipientIds.filter(
      (value) => typeof value === "string" && value.length > 0,
    ),
  ).size;
  if (!count || count > 10000 || !Number.isFinite(notification.timestamp))
    return null;
  const date = new Date(notification.timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    eventId: createHash("sha256")
      .update(notification.chatId + ":" + kind + ":" + id)
      .digest("hex"),
    whatsappId: notification.chatId,
    kind,
    count,
    occurredAt: date.toISOString(),
  };
}
function valid(value: unknown): value is Pending {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Pending>,
    event = row.event;
  return (
    typeof row.connectionId === "string" &&
    /^[a-f0-9-]{36}$/i.test(row.connectionId) &&
    typeof row.phone === "string" &&
    /^\d{7,20}$/.test(row.phone) &&
    !!event &&
    typeof event.eventId === "string" &&
    /^[a-f0-9]{64}$/.test(event.eventId) &&
    typeof event.whatsappId === "string" &&
    /^\d+(?:-\d+)?@g\.us$/.test(event.whatsappId) &&
    ["JOIN", "LEAVE"].includes(event.kind) &&
    Number.isInteger(event.count) &&
    event.count > 0 &&
    event.count <= 10000 &&
    typeof event.occurredAt === "string" &&
    Number.isFinite(Date.parse(event.occurredAt))
  );
}
export class GroupActivityTracker {
  private writes = Promise.resolve();
  private stopping = false;
  constructor(
    private readonly api: ActivityApi,
    private readonly directory: string,
  ) {}
  private file(row: Pending): string {
    const id = createHash("sha256")
      .update(row.connectionId + ":" + row.phone + ":" + row.event.eventId)
      .digest("hex");
    return join(this.directory, id + ".json");
  }
  receive(
    connectionId: string,
    phone: string,
    kind: "JOIN" | "LEAVE",
    notification: GroupNotification,
  ) {
    if (this.stopping) return;
    const event = activityFromNotification(kind, notification);
    const row = { connectionId, phone, event };
    if (!valid(row)) return;
    this.writes = this.writes
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const file = this.file(row);
        await writeFile(file + ".tmp", JSON.stringify(row), {
          mode: 0o600,
          flush: true,
        });
        await rename(file + ".tmp", file);
      })
      .catch((error) => runtimeLog("group.activity.persist.failed", error));
  }
  async poll() {
    await this.writes;
    await mkdir(this.directory, { recursive: true });
    const batches = new Map<string, Pending[]>();
    for (const file of (await readdir(this.directory))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .slice(0, 500)) {
      let row: unknown;
      try {
        row = JSON.parse(await readFile(join(this.directory, file), "utf8"));
      } catch (error) {
        runtimeLog("group.activity.invalid", error);
        await rename(
          join(this.directory, file),
          join(this.directory, file + ".invalid"),
        ).catch(() => undefined);
        continue;
      }
      if (!valid(row)) {
        runtimeLog("group.activity.invalid");
        await rename(
          join(this.directory, file),
          join(this.directory, file + ".invalid"),
        ).catch(() => undefined);
        continue;
      }
      if (Date.parse(row.event.occurredAt) < Date.now() - 72 * 60 * 60 * 1000) {
        await unlink(join(this.directory, file));
        continue;
      }
      const key = row.connectionId + ":" + row.phone;
      const batch = batches.get(key) ?? [];
      if (batch.length < 100) batch.push(row);
      batches.set(key, batch);
    }
    for (const rows of Array.from(batches.values()).slice(0, 2)) {
      try {
        const result = await this.api.recordGroupActivity(
          rows[0].connectionId,
          {
            connectedPhone: rows[0].phone,
            events: rows.map((row) => row.event),
          },
        );
        for (const id of result.accepted)
          if (rows.some((row) => row.event.eventId === id))
            await unlink(
              this.file(rows.find((row) => row.event.eventId === id)!),
            ).catch(() => undefined);
      } catch (error) {
        runtimeLog("group.activity.sync.failed", error);
      }
    }
  }
  async stop() {
    this.stopping = true;
    await this.writes;
  }
}
