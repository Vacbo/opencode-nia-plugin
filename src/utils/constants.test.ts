import { describe, it, expect } from "bun:test";
import { TOOL_NAMES } from "./constants";

describe("TOOL_NAMES", () => {
  it("contains search tool name", () => {
    expect(TOOL_NAMES.search).toBe("nia_search");
  });

  it("contains read tool name", () => {
    expect(TOOL_NAMES.read).toBe("nia_read");
  });

  it("contains grep tool name", () => {
    expect(TOOL_NAMES.grep).toBe("nia_grep");
  });

  it("contains explore tool name", () => {
    expect(TOOL_NAMES.explore).toBe("nia_explore");
  });

  it("contains index tool name", () => {
    expect(TOOL_NAMES.index).toBe("nia_index");
  });

  it("contains manage_resource tool name", () => {
    expect(TOOL_NAMES.manage_resource).toBe("nia_manage_resource");
  });

  it("contains research tool name", () => {
    expect(TOOL_NAMES.research).toBe("nia_research");
  });

  it("contains advisor tool name", () => {
    expect(TOOL_NAMES.advisor).toBe("nia_advisor");
  });

  it("contains context tool name", () => {
    expect(TOOL_NAMES.context).toBe("nia_context");
  });

  it("contains package_search tool name", () => {
    expect(TOOL_NAMES.package_search).toBe("nia_package_search");
  });

  it("contains auto_subscribe tool name", () => {
    expect(TOOL_NAMES.auto_subscribe).toBe("nia_auto_subscribe");
  });

  it("contains tracer tool name", () => {
    expect(TOOL_NAMES.tracer).toBe("nia_tracer");
  });

  it("contains e2e tool name", () => {
    expect(TOOL_NAMES.e2e).toBe("nia_e2e");
  });
});