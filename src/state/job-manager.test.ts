import { beforeEach, describe, expect, it } from "bun:test";

import type { SdkAdapter } from "../api/nia-sdk";
import { NiaJobManager } from "./job-manager";

describe("NiaJobManager", () => {
  let manager: NiaJobManager;

  beforeEach(() => {
    manager = new NiaJobManager();
    manager.clearJobs();
  });

  describe("submitJob", () => {
    it("registers a pending oracle job", () => {
      manager.submitJob("oracle", "job_123", "session_abc");

      const pending = manager.getPendingJobs("session_abc");
      expect(pending).toHaveLength(1);
      expect(pending[0].jobId).toBe("job_123");
      expect(pending[0].type).toBe("oracle");
      expect(pending[0].sessionID).toBe("session_abc");
    });

    it("registers a pending tracer job with agent", () => {
      manager.submitJob("tracer", "job_456", "session_xyz", "claude");

      const pending = manager.getPendingJobs("session_xyz");
      expect(pending).toHaveLength(1);
      expect(pending[0].jobId).toBe("job_456");
      expect(pending[0].type).toBe("tracer");
      expect(pending[0].agent).toBe("claude");
    });

    it("allows multiple jobs for same session", () => {
      manager.submitJob("oracle", "job_1", "session_test");
      manager.submitJob("tracer", "job_2", "session_test");

      const pending = manager.getPendingJobs("session_test");
      expect(pending).toHaveLength(2);
    });
  });

  describe("getPendingJobs", () => {
    it("returns empty array for unknown session", () => {
      const pending = manager.getPendingJobs("unknown");
      expect(pending).toEqual([]);
    });

    it("filters jobs by sessionID", () => {
      manager.submitJob("oracle", "job_1", "session_a");
      manager.submitJob("oracle", "job_2", "session_b");

      const sessionAPending = manager.getPendingJobs("session_a");
      const sessionBPending = manager.getPendingJobs("session_b");

      expect(sessionAPending).toHaveLength(1);
      expect(sessionAPending[0].jobId).toBe("job_1");
      expect(sessionBPending).toHaveLength(1);
      expect(sessionBPending[0].jobId).toBe("job_2");
    });

    it("returns empty when no jobs exist", () => {
      const pending = manager.getPendingJobs("session_empty");
      expect(pending).toEqual([]);
    });
  });

  describe("consumeSSE", () => {
    it("does nothing if job not found", async () => {
      const mockClient = {
        stream: async function* () {},
      };

		await manager.consumeSSE("nonexistent", mockClient as unknown as SdkAdapter);
    });

    it("uses correct path for oracle jobs", async () => {
      let capturedPath = "";
      let capturedSignal: AbortSignal | undefined;

      const mockClient = {
        async *stream(path: string, _params: unknown, signal: AbortSignal) {
          capturedPath = path;
          capturedSignal = signal;
          yield { done: true };
        },
      };

      manager.submitJob("oracle", "job_oracle", "session_abc");
		await manager.consumeSSE("job_oracle", mockClient as unknown as SdkAdapter);

      expect(capturedPath).toBe("/oracle/jobs/job_oracle/stream");
      expect(capturedSignal).toBeDefined();
    });

    it("uses correct path for tracer jobs", async () => {
      let capturedPath = "";

      const mockClient = {
        async *stream(path: string) {
          capturedPath = path;
          yield { done: true };
        },
      };

      manager.submitJob("tracer", "job_tracer", "session_abc");
		await manager.consumeSSE("job_tracer", mockClient as unknown as SdkAdapter);

      expect(capturedPath).toBe("/github/tracer/job_tracer/stream");
    });
  });

  describe("cancelJob", () => {
    it("calls delete on the Nia API for oracle", async () => {
      let capturedPath = "";

      const mockClient = {
        async delete(path: string) {
          capturedPath = path;
        },
      };

      manager.submitJob("oracle", "job_123", "session_abc");
		await manager.cancelJob("job_123", mockClient as unknown as Pick<SdkAdapter, "delete">);

      expect(capturedPath).toBe("/oracle/jobs/job_123/stream");
    });

    it("calls delete on the Nia API for tracer", async () => {
      let capturedPath = "";

      const mockClient = {
        async delete(path: string) {
          capturedPath = path;
        },
      };

      manager.submitJob("tracer", "job_456", "session_abc");
		await manager.cancelJob("job_456", mockClient as unknown as Pick<SdkAdapter, "delete">);

      expect(capturedPath).toBe("/github/tracer/job_456/stream");
    });

    it("handles missing job gracefully", async () => {
      let deleteCalled = false;

      const mockClient = {
        async delete(_path: string) {
          deleteCalled = true;
        },
      };

		await manager.cancelJob("nonexistent", mockClient as unknown as Pick<SdkAdapter, "delete">);

      expect(deleteCalled).toBe(false);
    });

    it("removes job after cancellation", async () => {
      const mockClient = {
        async delete(_path: string) {},
      };

      manager.submitJob("oracle", "job_123", "session_abc");
		await manager.cancelJob("job_123", mockClient as unknown as Pick<SdkAdapter, "delete">);

      const pending = manager.getPendingJobs("session_abc");
      expect(pending).toHaveLength(0);
    });
  });
});
