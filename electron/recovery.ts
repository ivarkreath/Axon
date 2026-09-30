import { rm } from "node:fs/promises";
import type { BackupStatus } from "../src/shared/contracts";
import { atomicWrite } from "./storage";

type Snapshot = () => unknown;

/** Serializes autosave, explicit discard and removal of the recovery file. */
export class RecoveryWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private persisting = 0;
  private deferred: Snapshot | undefined;

  constructor(
    private file: string,
    private notify: (status: BackupStatus) => void,
  ) {}

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    ++this.generation;
    this.deferred = undefined;
  }

  schedule(snapshot: Snapshot) {
    clearTimeout(this.timer);
    if (this.persisting) {
      this.deferred = snapshot;
      return;
    }
    const generation = ++this.generation;
    this.notify({ state: "pending" });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.queue = this.queue
        .catch(() => {})
        .then(async () => {
          // Coalesce queued autosaves without retaining serialized documents.
          if (generation !== this.generation) return;
          await atomicWrite(this.file, JSON.stringify(snapshot()));
          if (generation === this.generation)
            this.notify({ state: "saved", time: new Date().toISOString() });
        });
      void this.queue.catch(() => {
        if (generation === this.generation)
          this.notify({
            state: "error",
            message: "Не удалось записать рабочую копию",
          });
      });
    }, 800);
  }

  persist(snapshot: Snapshot | null): Promise<void> {
    this.cancel();
    ++this.persisting;
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (snapshot) await atomicWrite(this.file, JSON.stringify(snapshot()));
        else await rm(this.file, { force: true });
      })
      .finally(() => {
        --this.persisting;
        if (!this.persisting && this.deferred) {
          const deferred = this.deferred;
          this.deferred = undefined;
          // The caller can commit a tab removal before this debounce expires.
          this.schedule(deferred);
        }
      });
    return this.queue;
  }
}
