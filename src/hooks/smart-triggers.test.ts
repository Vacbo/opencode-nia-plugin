import { describe, it, expect, beforeEach } from "bun:test";
import {
  detectTrigger,
  createTriggerSession,
  type TriggerType,
  type TriggerSession,
  NIA_NUDGE_MESSAGE,
  NIA_SAVE_NUDGE_MESSAGE,
  NIA_URL_NUDGE_MESSAGE,
} from "./smart-triggers";

// ─── Backward Compatibility: All 13 Original Patterns ────────────────────────

describe("RESEARCH_PATTERNS (7 original)", () => {
  const cases: [string, string][] = [
    ["research this library", "research"],
    ["look up the docs for express", "look up"],
    ["find docs on prisma", "find docs"],
    ["search for authentication patterns", "search for"],
    ["search codebase for auth", "search codebase"],
    ["search repo for utils", "search repo"],
    ["search docs for api", "search docs"],
    ["grep for TODO in src", "grep for"],
    ["grep in the utils folder", "grep in"],
    ["index this repo", "index this repo"],
    ["add to nia the project", "add to nia"],
    ["what is express library", "express library"],
    ["how does react framework work", "react framework"],
    ["explain lodash library", "lodash library"],
    ["check the docs for prisma", "check the docs for"],
    ["check documentation about auth", "check documentation about"],
    ["find examples of hooks", "find examples of"],
    ["find usage for useState", "find usage for"],
  ];

  for (const [input, expectedMatch] of cases) {
    it(`detects research: "${input}"`, () => {
      const result = detectTrigger(input);
      expect(result.type).toBe("research");
      expect(result.match).toBeTruthy();
    });
  }
});

describe("SAVE_PATTERNS (6 original)", () => {
  const cases: string[] = [
    "save this context",
    "save this conversation",
    "save this session",
    "continue this later",
    "continue tomorrow",
    "pick this up later",
    "pick up tomorrow",
    "hand off to cursor",
    "switching to claude",
    "handoff to windsurf",
    "switch to another agent",
    "save for later",
    "bookmark this",
    "preserve this context",
    "store this conversation",
    "store this session",
  ];

  for (const input of cases) {
    it(`detects save: "${input}"`, () => {
      const result = detectTrigger(input);
      expect(result.type).toBe("save");
      expect(result.match).toBeTruthy();
    });
  }
});

// ─── Code Block Stripping ────────────────────────────────────────────────────

describe("code block stripping", () => {
  it("does NOT match keywords inside fenced code blocks", () => {
    const text = "Here is some code:\n```\nresearch this library\nsearch for auth\n```\nThat's it.";
    const result = detectTrigger(text);
    expect(result.type).toBeNull();
  });

  it("does NOT match keywords inside inline code", () => {
    const text = "Use the `search for` function to find items";
    const result = detectTrigger(text);
    expect(result.type).toBeNull();
  });

  it("matches keywords outside code blocks", () => {
    const text = "```\nsome code\n```\nNow research this library please";
    const result = detectTrigger(text);
    expect(result.type).toBe("research");
  });

  it("handles mixed code blocks and real text", () => {
    const text = "I have `inline code` but also want to save this context";
    const result = detectTrigger(text);
    expect(result.type).toBe("save");
  });
});

// ─── URL Detection ───────────────────────────────────────────────────────────

describe("URL detection", () => {
  it("detects GitHub repo URLs", () => {
    const result = detectTrigger("Check out github.com/vercel/next.js for details");
    expect(result.type).toBe("url");
    expect(result.match).toContain("github.com/vercel/next.js");
  });

  it("detects GitHub URLs with https", () => {
    const result = detectTrigger("See https://github.com/facebook/react");
    expect(result.type).toBe("url");
    expect(result.match).toContain("github.com/facebook/react");
  });

  it("detects npm package URLs", () => {
    const result = detectTrigger("Install from https://www.npmjs.com/package/express");
    expect(result.type).toBe("url");
    expect(result.match).toContain("npmjs.com/package/express");
  });

  it("detects npm package URLs without www", () => {
    const result = detectTrigger("See npmjs.com/package/lodash");
    expect(result.type).toBe("url");
    expect(result.match).toContain("npmjs.com/package/lodash");
  });

  it("detects PyPI project URLs", () => {
    const result = detectTrigger("Check https://pypi.org/project/requests");
    expect(result.type).toBe("url");
    expect(result.match).toContain("pypi.org/project/requests");
  });

  it("does NOT detect URLs inside code blocks", () => {
    const text = "```\nhttps://github.com/vercel/next.js\n```";
    const result = detectTrigger(text);
    expect(result.type).toBeNull();
  });

  it("does NOT detect URLs inside inline code", () => {
    const text = "Use `https://github.com/vercel/next.js` as reference";
    const result = detectTrigger(text);
    expect(result.type).toBeNull();
  });

  it("detects GitHub URLs with paths beyond owner/repo", () => {
    const result = detectTrigger("Look at github.com/owner/repo/tree/main/src");
    expect(result.type).toBe("url");
    expect(result.match).toContain("github.com/owner/repo");
  });
});

// ─── Library/Framework Mention Detection ─────────────────────────────────────

describe("library/framework mention detection", () => {
  it("detects 'how does X work' for known patterns", () => {
    const result = detectTrigger("how does express work with middleware?");
    expect(result.type).toBe("research");
  });

  it("detects 'how does X library' pattern", () => {
    const result = detectTrigger("how does the prisma library handle migrations?");
    expect(result.type).toBe("research");
  });

  it("detects 'what is X framework'", () => {
    const result = detectTrigger("what is next.js framework");
    expect(result.type).toBe("research");
  });
});

// ─── Session Dedup ───────────────────────────────────────────────────────────

describe("session dedup", () => {
  let session: TriggerSession;

  beforeEach(() => {
    session = createTriggerSession();
  });

  it("triggers on first occurrence", () => {
    const result = detectTrigger("research this library", session);
    expect(result.type).toBe("research");
  });

  it("deduplicates same trigger type in same session", () => {
    const first = detectTrigger("research this library", session);
    expect(first.type).toBe("research");

    const second = detectTrigger("search for more docs", session);
    expect(second.type).toBeNull();
    expect(second.deduplicated).toBe(true);
  });

  it("allows different trigger types in same session", () => {
    const research = detectTrigger("research this library", session);
    expect(research.type).toBe("research");

    const save = detectTrigger("save this context", session);
    expect(save.type).toBe("save");
  });

  it("allows same type after different types", () => {
    detectTrigger("research this library", session);
    detectTrigger("save this context", session);

    // research already triggered — should dedup
    const result = detectTrigger("search for more docs", session);
    expect(result.type).toBeNull();
    expect(result.deduplicated).toBe(true);
  });

  it("works without session (no dedup)", () => {
    const first = detectTrigger("research this library");
    expect(first.type).toBe("research");

    // Without session, no dedup — triggers again
    const second = detectTrigger("search for more docs");
    expect(second.type).toBe("research");
  });

  it("deduplicates URL triggers separately", () => {
    const first = detectTrigger("Check github.com/vercel/next.js", session);
    expect(first.type).toBe("url");

    const second = detectTrigger("Also github.com/facebook/react", session);
    expect(second.type).toBeNull();
    expect(second.deduplicated).toBe(true);
  });

  it("allows URL trigger after research trigger", () => {
    detectTrigger("research this library", session);
    const url = detectTrigger("Check github.com/vercel/next.js", session);
    expect(url.type).toBe("url");
  });
});

// ─── Config disabled ─────────────────────────────────────────────────────────

describe("disabled state", () => {
  it("returns null when keywords disabled", () => {
    const result = detectTrigger("some random text with no keywords");
    expect(result.type).toBeNull();
    expect(result.match).toBeUndefined();
  });
});

// ─── Nudge Messages ──────────────────────────────────────────────────────────

describe("nudge messages", () => {
  it("exports NIA_NUDGE_MESSAGE", () => {
    expect(NIA_NUDGE_MESSAGE).toContain("NIA KNOWLEDGE TRIGGER");
  });

  it("exports NIA_SAVE_NUDGE_MESSAGE", () => {
    expect(NIA_SAVE_NUDGE_MESSAGE).toContain("NIA CONTEXT SAVE TRIGGER");
  });

  it("exports NIA_URL_NUDGE_MESSAGE", () => {
    expect(NIA_URL_NUDGE_MESSAGE).toContain("URL");
  });
});

// ─── Backward Compatibility ──────────────────────────────────────────────────

describe("backward compatibility", () => {
  it("detectTrigger returns type, match shape", () => {
    const result = detectTrigger("research this library");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("match");
  });

  it("returns null type for non-matching text", () => {
    const result = detectTrigger("just a regular message about nothing");
    expect(result.type).toBeNull();
  });
});

// ─── Custom Patterns ─────────────────────────────────────────────────────────

describe("custom patterns from config", () => {
  it("compiles custom patterns without crashing on invalid regex", () => {
    const result = detectTrigger("a normal message");
    expect(result.type).toBeNull();
  });
});
