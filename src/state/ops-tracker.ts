import type { IOpsTracker, PendingOperation } from "../api/types.js";
import { loadConfig } from "../config.js";

type TrackerResponse = {
  status?: string;
  progress?: number;
  error?: string;
};

type ToastClient = {
  showToast?: (message: string) => void | Promise<void>;
};

type OpsTrackerClient = {
  get<T>(path: string, params?: unknown, signal?: AbortSignal): Promise<T | string>;
  tui?: ToastClient;
};

type OpsTrackerOptions = {
  checkInterval?: number;
  client?: OpsTrackerClient;
  now?: () => number;
  ui?: ToastClient;
};

export class OpsTracker implements IOpsTracker {
  private readonly operations = new Map<string, PendingOperation>();
  private readonly lastCheckedAt = new Map<string, number>();
  private readonly checkIntervalMs: number;
  private readonly now: () => number;
  private client?: OpsTrackerClient;
  private readonly ui?: ToastClient;

  constructor(options: OpsTrackerOptions = {}) {
    const config = loadConfig();

    this.checkIntervalMs = (options.checkInterval ?? config.checkInterval) * 1000;
    this.client = options.client;
    this.now = options.now ?? (() => Date.now());
    this.ui = options.ui ?? options.client?.tui;
  }

  setClient(client: OpsTrackerClient): void {
    this.client = client;
  }

  trackOperation(op: PendingOperation): void {
    this.operations.set(op.id, {
      ...op,
      status: op.status ?? "pending",
    });
  }

  getOperation(id: string): PendingOperation | undefined {
    return this.operations.get(id);
  }

  getAllOperations(): PendingOperation[] {
    return [...this.operations.values()];
  }

  removeOperation(id: string): void {
    this.operations.delete(id);
    this.lastCheckedAt.delete(id);
  }

  async checkAndDrain(): Promise<PendingOperation[]> {
    if (!this.client) {
      return [];
    }

    const completed: PendingOperation[] = [];
    const currentTime = this.now();

    for (const operation of this.operations.values()) {
      if (!this.shouldCheck(operation.id, currentTime)) {
        continue;
      }

      this.lastCheckedAt.set(operation.id, currentTime);

      const route = this.resolveRoute(operation);
      if (typeof route === "string") {
        const response = await this.client.get<TrackerResponse>(route);
        await this.syncOperation(operation, response, completed);
        continue;
      }

      this.removeOperation(operation.id);
      await this.showToast(`${operation.name} failed: ${route.message}`);
    }

    return completed;
  }

  private shouldCheck(id: string, currentTime: number): boolean {
    const lastChecked = this.lastCheckedAt.get(id);
    if (lastChecked === undefined) {
      return true;
    }

    return currentTime - lastChecked >= this.checkIntervalMs;
  }

  private resolveRoute(operation: PendingOperation): string | { message: string } {
    if (operation.type === "oracle") {
      return `/v2/oracle/jobs/${operation.id}`;
    }

    if (operation.type === "tracer") {
      return `/v2/github/tracer/${operation.id}`;
    }

    if (operation.sourceType === "repository") {
      return `/v2/repositories/${operation.id}`;
    }

    if (operation.sourceType === "data_source") {
      return `/v2/data-sources/${operation.id}`;
    }

    return { message: "missing or unsupported index source type" };
  }

  private async syncOperation(
    operation: PendingOperation,
    response: TrackerResponse | string,
    completed: PendingOperation[]
  ): Promise<void> {
    if (typeof response === "string") {
      this.operations.set(operation.id, {
        ...operation,
        error: response,
      });
      return;
    }

    const status = this.normalizeStatus(operation, response.status);
    const nextOperation: PendingOperation = {
      ...operation,
      status,
      progress: response.progress,
      error: response.error,
    };

    if (status === "completed") {
      this.removeOperation(operation.id);
      completed.push(nextOperation);
      await this.showToast(`${operation.name} completed`);
      return;
    }

    if (status === "error") {
      this.removeOperation(operation.id);
      await this.showToast(`${operation.name} failed: ${response.error ?? "unknown error"}`);
      return;
    }

    this.operations.set(operation.id, nextOperation);
  }

  private normalizeStatus(operation: PendingOperation, status?: string): PendingOperation["status"] {
    if (operation.type === "index") {
      if (status === "ready") {
        return "completed";
      }

      if (status === "error") {
        return "error";
      }

      return status === "processing" ? "processing" : "pending";
    }

    if (status === "completed" || status === "processing" || status === "error") {
      return status;
    }

    return "pending";
  }

  private async showToast(message: string): Promise<void> {
    await this.ui?.showToast?.(message);
  }
}
