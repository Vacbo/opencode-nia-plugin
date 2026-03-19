import { describe, expect, it } from "bun:test";

import { getSessionState } from "./session.js";

describe("getSessionState", () => {
  it("returns the same state object for the same session", () => {
    const stateA = getSessionState("session-shared");
    const stateB = getSessionState("session-shared");

    expect(stateA).toBe(stateB);
  });

  it("isolates cache, dedup state, ops, and project context per session", () => {
    const alpha = getSessionState("session-alpha");
    const beta = getSessionState("session-beta");

    alpha.sourceCache.set("source-1", { id: "source-1", type: "repository" });
    alpha.searchDedup.set("query:repo", true);
    alpha.projectContext.set("cwd", "/tmp/alpha");
    alpha.pendingOps.trackOperation({ id: "op-1", type: "oracle", name: "Alpha research" });

    expect(beta.sourceCache.get("source-1")).toBeUndefined();
    expect(beta.searchDedup.get("query:repo")).toBeUndefined();
    expect(beta.projectContext.get("cwd")).toBeUndefined();
    expect(beta.pendingOps.getOperation("op-1")).toBeUndefined();
  });
});
