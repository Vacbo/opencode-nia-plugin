import { describe, it, expect, vi } from "bun:test";
import { requestPermission } from "./permission";

describe("requestPermission", () => {
  it("returns true when permission is granted", async () => {
    const mockAsk = vi.fn().mockResolvedValue({});
    const context = { ask: mockAsk } as unknown as { ask: (input: unknown) => Promise<{ allowed?: boolean }> };

    const result = await requestPermission(context, {
      permission: "delete",
      patterns: ["nia:resource:delete:123"],
      metadata: { action: "delete" },
    });

    expect(result).toBe(true);
    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "delete",
        patterns: ["nia:resource:delete:123"],
      })
    );
  });

  it("returns false when permission is denied (returns false)", async () => {
    const mockAsk = vi.fn().mockResolvedValue(false);
    const context = { ask: mockAsk } as unknown as { ask: (input: unknown) => Promise<{ allowed?: boolean }> };

    const result = await requestPermission(context, {
      permission: "delete",
      patterns: ["nia:resource:delete:123"],
      metadata: { action: "delete" },
    });

    expect(result).toBe(false);
  });

  it("returns false when ask throws an error", async () => {
    const mockAsk = vi.fn().mockRejectedValue(new Error("Network error"));
    const context = { ask: mockAsk } as unknown as { ask: (input: unknown) => Promise<{ allowed?: boolean }> };

    const result = await requestPermission(context, {
      permission: "delete",
      patterns: ["nia:resource:delete:123"],
      metadata: { action: "delete" },
    });

    expect(result).toBe(false);
  });

  it("includes always and metadata in the ask call", async () => {
    const mockAsk = vi.fn().mockResolvedValue({});
    const context = { ask: mockAsk } as unknown as { ask: (input: unknown) => Promise<{ allowed?: boolean }> };

    await requestPermission(context, {
      permission: "delete",
      patterns: ["pattern1"],
      always: ["always-pattern"],
      metadata: { key: "value" },
    });

    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        always: ["always-pattern"],
        metadata: { key: "value" },
      })
    );
  });
});