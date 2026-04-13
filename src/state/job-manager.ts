import type { SdkAdapter } from "../api/nia-sdk.js";
import { getOpencodeClient } from "../opencode-client.js";

export type JobType = "oracle" | "tracer" | "sandbox" | "document_agent";

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

	async consumeSSE(jobId: string, client: SdkAdapter): Promise<void> {
		const job = jobs.get(jobId);
		if (!job) {
			return;
    }

    const controller = new AbortController();
    abortControllers.set(jobId, controller);

		try {
			const stream =
				job.type === "oracle"
					? client.oracle.streamJob(jobId)
					: job.type === "tracer"
						? client.tracer.streamJob(jobId)
						: job.type === "document_agent"
							? client.documentAgent.streamJob(jobId)
							: client.sandbox.streamJob(jobId);
			const events: Record<string, unknown>[] = [];

			for await (const event of stream) {
				if (controller.signal.aborted) {
					break;
				}

				events.push(event);
				const eventType = event.type as string | undefined;
				const error = event.error as string | undefined;
				const content = (event.content ?? event.data ?? "") as string;

				if (eventType === "error" && error) {
					await this.notifyError(job, error);
					jobs.delete(jobId);
					abortControllers.delete(jobId);
					return;
				}

				if (eventType === "done") {
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

	async cancelJob(
		jobId: string,
		client: SdkAdapter,
		typeHint?: JobType,
	): Promise<unknown> {
		const controller = abortControllers.get(jobId);
		if (controller) {
			controller.abort();
      abortControllers.delete(jobId);
    }

		const job = jobs.get(jobId);
		const jobType = job?.type ?? typeHint;
		let response: unknown;

		if (jobType) {
			try {
				response = await deleteJob(jobType, jobId, client);
			} catch {
				// Ignore delete errors
			}
		}

		jobs.delete(jobId);
		return response;
	}

  private async notifyComplete(job: PendingJob, content: string): Promise<void> {
    const opencodeClient = getOpencodeClient();
    if (!opencodeClient) {
      return;
    }

		const label = getJobLabel(job.type);
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

		const label = getJobLabel(job.type);
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

function getJobLabel(type: JobType): string {
	if (type === "oracle") {
		return "ORACLE";
	}

	if (type === "tracer") {
		return "TRACER";
	}

	if (type === "document_agent") {
		return "DOCUMENT AGENT";
	}

	return "SANDBOX";
}

function deleteJob(type: JobType, jobId: string, client: SdkAdapter): Promise<unknown> {
	if (type === "oracle") {
		return client.delete(`/oracle/jobs/${jobId}/stream`);
	}

	if (type === "tracer") {
		return client.delete(`/github/tracer/${jobId}/stream`);
	}

	if (type === "document_agent") {
		return client.documentAgent.deleteJob(jobId);
	}

	return client.delete(`/sandbox/jobs/${jobId}/stream`);
}

export const jobManager = new NiaJobManager();
