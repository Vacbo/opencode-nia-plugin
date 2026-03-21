import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jobManager } from "../state/job-manager.js";
import { getSessionState } from "../state/session.js";
import { createSystemTransform } from "./system-transform.js";

const tempDirectories: string[] = [];

function createWorkspace(packageJson: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), "nia-system-transform-"));
  tempDirectories.push(directory);
  writeFileSync(join(directory, "package.json"), JSON.stringify(packageJson, null, 2));
  return directory;
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("createSystemTransform", () => {
  it("injects routing hints ahead of the base system prompt", async () => {
    const workspace = createWorkspace({
      dependencies: {
        react: "^19.0.0",
      },
    });

    const transform = createSystemTransform();
    const result = await transform(["Base system prompt"], {
      sessionID: "system-transform-routing",
      cwd: workspace,
    });

    expect(result[0]).toContain("Nia tools available");
    expect(result).toContain("Base system prompt");
    expect(result.some((entry) => entry.includes("React project detected"))).toBe(true);
  });

  it("deduplicates previously injected hints for the same session", async () => {
    const workspace = createWorkspace({
      dependencies: {
        react: "^19.0.0",
      },
    });
    const sessionID = "system-transform-dedup";
    const sessionState = getSessionState(sessionID);
    sessionState.sourceCache.set("repo:acme/app", {
      id: "repo:acme/app",
      type: "repository",
      repository: "acme/app",
      branch: "main",
      status: "ready",
    });

    const transform = createSystemTransform();
    const first = await transform(["Base system prompt"], { sessionID, cwd: workspace });
    const second = await transform(["Base system prompt"], { sessionID, cwd: workspace });

    expect(first.some((entry) => entry.includes("Known Nia sources"))).toBe(true);
    expect(second).toEqual(["Base system prompt"]);
  });

  it("injects async completion notifications after draining tracked operations", async () => {
    const workspace = createWorkspace({
      dependencies: {
        typescript: "^5.9.0",
      },
    });
    const sessionID = "system-transform-ops";
    const sessionState = getSessionState(sessionID);

    sessionState.pendingOps.setClient({
      get: async <T>() => ({ status: "completed", progress: 100 }) as T,
    });
    sessionState.pendingOps.trackOperation({
      id: "oracle-job-1",
      type: "oracle",
      name: "Auth audit",
      status: "processing",
    });

    const transform = createSystemTransform();
    const result = await transform(["Base system prompt"], { sessionID, cwd: workspace });

    expect(result.some((entry) => entry.includes("completed in the background"))).toBe(true);
    expect(result.some((entry) => entry.includes("Auth audit"))).toBe(true);
    expect(sessionState.pendingOps.getOperation("oracle-job-1")).toBeUndefined();
  });

  it("injects current pending operation status for unfinished background work", async () => {
    const workspace = createWorkspace({
      dependencies: {
        next: "^15.0.0",
      },
    });
    const sessionID = "system-transform-pending";
    const sessionState = getSessionState(sessionID);

    sessionState.pendingOps.setClient({
      get: async <T>() => ({ status: "processing", progress: 42 }) as T,
    });
    sessionState.pendingOps.trackOperation({
      id: "index-job-1",
      type: "index",
      name: "Docs import",
      sourceType: "data_source",
      status: "pending",
    });

    const transform = createSystemTransform();
    const result = await transform(["Base system prompt"], { sessionID, cwd: workspace });

    expect(result.some((entry) => entry.includes("Pending background work"))).toBe(true);
    expect(result.some((entry) => entry.includes("Docs import"))).toBe(true);
    expect(result.some((entry) => entry.includes("42%"))).toBe(true);
  });

  it("injects pending jobs hint when NiaJobManager has active fire-and-forget jobs", async () => {
    const workspace = createWorkspace({
      dependencies: {
        typescript: "^5.9.0",
      },
    });
    const sessionID = "system-transform-jobs";

    jobManager.clearJobs();
    jobManager.submitJob("oracle", "oracle-abc-123", sessionID, "test");
    jobManager.submitJob("tracer", "tracer-def-456", sessionID, "test");

    const transform = createSystemTransform();
    const result = await transform(["Base system prompt"], { sessionID, cwd: workspace });

    expect(result.some((entry) => entry.includes("⏳ Waiting for Nia operations to complete"))).toBe(true);
    expect(result.some((entry) => entry.includes("Oracle research (Job ID: oracle-abc-123)"))).toBe(true);
    expect(result.some((entry) => entry.includes("Tracer analysis (Job ID: tracer-def-456)"))).toBe(true);
    expect(result.some((entry) => entry.includes("Results will be delivered via promptAsync when ready"))).toBe(true);

    jobManager.clearJobs();
  });

  it("does not inject pending jobs hint when no jobs are active", async () => {
    const workspace = createWorkspace({
      dependencies: {
        typescript: "^5.9.0",
      },
    });
    const sessionID = "system-transform-no-jobs";

    jobManager.clearJobs();

    const transform = createSystemTransform();
    const result = await transform(["Base system prompt"], { sessionID, cwd: workspace });

    expect(result.every((entry) => !entry.includes("⏳ Waiting for Nia operations"))).toBe(true);
  });
});
