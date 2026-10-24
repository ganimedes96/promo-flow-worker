import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { PublicationReceipt } from "./publication.types";
import { parsePublicationReceipt } from "./publication.validation";
export class ReceiptStore {
  constructor(private readonly directory: string) {}
  private file(attemptId: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(attemptId))
      throw new Error("Identificador de recibo inválido");
    return join(this.directory, attemptId + ".json");
  }
  async save(receipt: PublicationReceipt): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = this.file(receipt.attemptId);
    await writeFile(file + ".tmp", JSON.stringify(receipt), { mode: 0o600 });
    await rename(file + ".tmp", file);
  }
  async list(): Promise<PublicationReceipt[]> {
    await mkdir(this.directory, { recursive: true });
    const names = await readdir(this.directory);
    const receipts: PublicationReceipt[] = [];
    for (const name of names.filter((name) =>
      /^[a-f0-9-]{36}\.json$/i.test(name),
    ))
      receipts.push(
        parsePublicationReceipt(
          JSON.parse(await readFile(join(this.directory, name), "utf8")),
        ),
      );
    return receipts;
  }
  async remove(attemptId: string): Promise<void> {
    await unlink(this.file(attemptId)).catch((error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    });
  }
}
