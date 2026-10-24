import { Client } from "whatsapp-web.js";
import { WorkerApi } from "../types/whatsapp.types";
import { readGroups } from "./group-reader";
export class GroupSyncService {
  constructor(private readonly api: WorkerApi) {}
  async execute(userId: string, client: Client): Promise<void> {
    const groups = await readGroups(client);
    await this.api.synchronizeGroups(userId, groups);
    console.log("Grupos sincronizados: " + groups.length);
  }
}
