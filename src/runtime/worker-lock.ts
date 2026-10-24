import { mkdir, open, readFile, unlink, FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer, Server } from "node:net";

export class WorkerLock {
  private handle?: FileHandle;
  private guard?: Server;
  private readonly path: string;
  constructor(private readonly sessionPath: string) {
    this.path = resolve(sessionPath, "worker.lock");
  }
  async acquire(): Promise<void> {
    const identity = createHash("sha256")
      .update(process.platform === "win32" ? this.path.toLowerCase() : this.path)
      .digest("hex");
    const guard = createServer((socket) => socket.destroy());
    await new Promise<void>((resolveReady, reject) => {
      guard.once("error", reject);
      const ready = () => {
        guard.removeListener("error", reject);
        resolveReady();
      };
      if (process.platform === "win32")
        guard.listen(`\\\\.\\pipe\\promoflow-worker-${identity}`, ready);
      else
        guard.listen({ host: "127.0.0.1", port: 30000 + (parseInt(identity.slice(0, 8), 16) % 30000), exclusive: true }, ready);
    }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
        throw new Error(`Já existe um worker usando ${this.sessionPath}. Aguarde o encerramento anterior.`);
      throw error;
    });
    this.guard = guard;
    try {
      await mkdir(this.sessionPath, { recursive: true });
      const owner = await readFile(this.path, "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (owner !== null) {
        const pid = Number(owner.trim());
        let active = true;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (error: unknown) {
            active = (error as NodeJS.ErrnoException).code !== "ESRCH";
          }
        }
        if (active)
          throw new Error(`Lock de processo ativo ou desconhecido (${owner.trim()}): ${this.path}`);
        await unlink(this.path);
        console.log(`Lock antigo recuperado automaticamente (PID ${pid}).`);
      }
      this.handle = await open(this.path, "wx");
      await this.handle.writeFile(String(process.pid));
    } catch (error: unknown) {
      await this.release();
      throw error;
    }
  }
  async release(): Promise<void> {
    try {
      if (this.handle) {
        await this.handle.close();
        this.handle = undefined;
        await unlink(this.path).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    } finally {
      const guard = this.guard;
      this.guard = undefined;
      if (guard) await new Promise<void>((done, reject) => guard.close((error) => error ? reject(error) : done()));
    }
  }
}
