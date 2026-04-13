import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import NiaPlugin from "./index";
import { NIA_NUDGE_MESSAGE } from "./hooks/smart-triggers";
import { getSessionState, resetSessionStates } from "./state/session";

const ALL_TOOL_NAMES = [
  "nia_search",
  "nia_read",
  "nia_write",
  "nia_rm",
  "nia_mv",
  "nia_mkdir",
  "nia_grep",
  "nia_explore",
  "nia_index",
  "nia_manage_resource",
  "nia_research",
  "nia_advisor",
  "nia_context",
  "nia_package_search",
  "nia_auto_subscribe",
  "nia_sandbox",
  "nia_tracer",
  "nia_e2e",
] as const;

const ALWAYS_ON_TOOL_NAMES = [
  "nia_search",
  "nia_read",
  "nia_write",
  "nia_rm",
  "nia_mv",
  "nia_mkdir",
  "nia_grep",
  "nia_explore",
  "nia_index",
  "nia_manage_resource",
  "nia_package_search",
  "nia_auto_subscribe",
] as const;

describe("Nia plugin entrypoint", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionStates();
  });

  it("registers all tools and hooks when configured", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    expect(typeof hooks.event).toBe("function");
    expect(typeof hooks["chat.message"]).toBe("function");
    expect(typeof hooks["tool.execute.after"]).toBe("function");
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");
  });

  it("cleans up session state when the plugin is disposed", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);
    const sessionState = getSessionState("session-disposed");
    sessionState.toolExecuteAfterCount = 1;

    await hooks.event?.({
      event: {
        type: "server.instance.disposed",
        properties: { directory: "/tmp/project" },
      },
    } as never);

    const refreshedState = getSessionState("session-disposed");
    expect(refreshedState).not.toBe(sessionState);
    expect(refreshedState.toolExecuteAfterCount).toBe(0);
  });

  it("returns empty hooks when the API key is missing", async () => {
    delete process.env.NIA_API_KEY;

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(hooks).toEqual({});
  });

  it("respects feature flags for optional tool registration", async () => {
    process.env.NIA_API_KEY = "test-key";
    process.env.NIA_RESEARCH = "false";
    process.env.NIA_ADVISOR = "false";
    process.env.NIA_CONTEXT = "false";
    process.env.NIA_SANDBOX_ENABLED = "false";
    process.env.NIA_TRACER = "false";
    process.env.NIA_E2E = "false";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...ALWAYS_ON_TOOL_NAMES].sort());
  });

  it("keeps keyword detection in the chat.message hook", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);
    const chatMessageHook = hooks["chat.message"];
    const output = {
      message: { id: "message-1" },
      parts: [{ type: "text", text: "please research the bun test docs" }],
    };

    await chatMessageHook?.({ sessionID: "session-1" } as never, output as never);

    expect(output.parts).toHaveLength(2);
    expect(output.parts[1]).toMatchObject({
      type: "text",
      text: NIA_NUDGE_MESSAGE,
      synthetic: true,
      sessionID: "session-1",
      messageID: "message-1",
    });
  });
});
