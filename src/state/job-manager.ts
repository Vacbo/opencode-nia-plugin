import type { NiaClient } from "../api/client.js";
import type { SSEEvent } from "../api/types.js";
import { getOpencodeClient } from "../opencode-client.js";

export type JobType = "oracle" | "tracer";

interface PendingJob {
  jobId: string;
  type: JobType;
  sessionID: string;
  agent?: string;
  createdAt: number;
}

const JOB_TIMEOUT_MS = 120_000;

const jobs = new Map<string, PendingJob>();
const abortControllers = new Map<string, AbortController>();

export class NiaJobManager {
  submitJob(type: JobType, jobId: string, sessionID: string, agent?: string): void {
    const job: PendingJob = {
      jobId,
      type,
      sessionID,
      agent,
      createdAt: Date.now(),
    };
    jobs.set(jobId, job);
  }

  getPendingJobs(sessionID: string): PendingJob[] {
    const now = Date.now();
    const result: PendingJob[] = [];

    for (const job of jobs.values()) {
      if (job.sessionID === sessionID) {
        const age = now - job.createdAt;
        if (age < JOB_TIMEOUT_MS) {
          result.push(job);
        } else {
          jobs.delete(job.jobId);
        }
      }
    }

    return result;
  }

  clearJobs(): void {
    jobs.clear();
    abortControllers.clear();
  }

  async consumeSSE(jobId: string, client: NiaClient): Promise<void> {
    const job = jobs.get(jobId);
    if (!job) {
      return;
    }

    const controller = new AbortController();
    abortControllers.set(jobId, controller);

    const path = job.type === "oracle"
      ? `/oracle/jobs/${jobId}/stream`
      : `/github/tracer/${jobId}/stream`;

    try {
      const reader = client.stream(path, undefined, controller.signal);
      const events: SSEEvent[] = [];

      for await (const event of reader) {
        if (controller.signal.aborted) {
          break;
        }

        events.push(event);

        if (event.type === "error" && event.error) {
          await this.notifyError(job, event.error);
          jobs.delete(jobId);
          abortControllers.delete(jobId);
          return;
        }

        if (event.type === "done") {
          const content = event.content ?? event.data ?? "";
          await this.notifyComplete(job, content);
          jobs.delete(jobId);
          abortControllers.delete(jobId);
          return;
        }
      }

      if (events.length === 0) {
        await this.notifyError(job, "stream_error: no events received");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("abort") || message.includes("cancelled")) {
        jobs.delete(jobId);
        abortControllers.delete(jobId);
        return;
      }
      await this.notifyError(job, `stream_error: ${message}`);
    } finally {
      abortControllers.delete(jobId);
    }
  }

  async cancelJob(jobId: string, client: NiaClient): Promise<void> {
    const controller = abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      abortControllers.delete(jobId);
    }

    const job = jobs.get(jobId);
    if (job) {
      const path = job.type === "oracle"
        ? `/oracle/jobs/${jobId}/stream`
        : `/github/tracer/${jobId}/stream`;

      try {
        await client.delete(path);
      } catch {
        // Ignore delete errors
      }

      jobs.delete(jobId);
    }
  }

  private async notifyComplete(job: PendingJob, content: string): Promise<void> {
    const opencodeClient = getOpencodeClient();
    if (!opencodeClient) {
      return;
    }

    const label = job.type === "oracle" ? "ORACLE" : "TRACER";
    const notification = `<system-reminder>[NIA ${label} COMPLETE]\n${content}\n</system-reminder>`;

    try {
      await opencodeClient.session.promptAsync({
        path: { id: job.sessionID },
        body: {
          noReply: false,
          parts: [{ type: "text", text: notification }],
          agent: job.agent,
        },
      });
    } catch {
      // Ignore notification errors
    }
  }

  private async notifyError(job: PendingJob, error: string): Promise<void> {
    const opencodeClient = getOpencodeClient();
    if (!opencodeClient) {
      return;
    }

    const label = job.type === "oracle" ? "ORACLE" : "TRACER";
    const notification = `<system-reminder>[NIA ${label} ERROR] ${error}\n</system-reminder>`;

    try {
      await opencodeClient.session.promptAsync({
        path: { id: job.sessionID },
        body: {
          noReply: false,
          parts: [{ type: "text", text: notification }],
          agent: job.agent,
        },
      });
    } catch {
      // Ignore notification errors
    }
  }
}

export const jobManager = new NiaJobManager();