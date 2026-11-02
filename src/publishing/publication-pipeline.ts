import { PublicationProcessor } from "./publication.types";
import { runtimeLog } from "../utils/runtime-log";
export class PublicationPipeline implements PublicationProcessor {
  constructor(private readonly processors: PublicationProcessor[]) {}
  stop() {
    for (const processor of this.processors) processor.stop?.();
  }
  async poll() {
    for (const processor of this.processors) {
      try {
        await processor.poll();
      } catch (error) {
        runtimeLog("publication.processor.failed", error);
      }
    }
  }
}
