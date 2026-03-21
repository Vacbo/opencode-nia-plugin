import { loadConfig, type NiaConfig } from "../config.js";
import { TOOL_NAMES, NIA_TOOLS_LIST } from "../utils/constants.js";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

const RESEARCH_PATTERNS = [
  /\b(research|look\s*up|find\s*docs?)\b/i,
  /\b(search\s+for|search\s+codebase|search\s+repo|search\s+docs?)\b/i,
  /\b(grep\s+for|grep\s+in)\b/i,
  /\b(index\s+(this\s+)?repo|add\s+to\s+nia)\b/i,
  /\b(what\s+is|how\s+does|explain)\s+(?:the\s+)?[\w.-]+\s+(library|package|framework|module)/i,
  /\bcheck\s+(the\s+)?(docs?|documentation)\s+(for|about|on)\b/i,
  /\bfind\s+(examples?|usage)\s+(of|for)\b/i,
  /\bhow\s+does\s+[\w.-]+\s+work\b/i,
];

const SAVE_PATTERNS = [
  /\b(save\s+(this\s+)?(context|conversation|session|chat))\b/i,
  /\b(continue\s+(this\s+)?(later|tomorrow|in\s+\w+))\b/i,
  /\b(pick\s+(this\s+)?up\s+(later|tomorrow|in\s+\w+))\b/i,
  /\b(hand\s*off(\s+to)?|switch(ing)?\s+to)\s+(cursor|claude|windsurf|copilot|another\s+agent)\b/i,
  /\b(save\s+for\s+later|bookmark\s+this)\b/i,
  /\b(preserve|store)\s+(this\s+)?(context|conversation|session)\b/i,
];

// github.com/owner/repo, npmjs.com/package/name, pypi.org/project/name
const URL_PATTERNS = [
  /(?:https?:\/\/)?github\.com\/[\w.-]+\/[\w.-]+/i,
  /(?:https?:\/\/)?(?:www\.)?npmjs\.com\/package\/[\w@/.-]+/i,
  /(?:https?:\/\/)?pypi\.org\/project\/[\w.-]+/i,
];

export type TriggerType = "research" | "save" | "url" | null;

export interface TriggerResult {
  type: TriggerType;
  match?: string;
  deduplicated?: boolean;
}

export interface TriggerSession {
  triggeredTypes: Set<TriggerType>;
}

type TriggerConfig = Pick<NiaConfig, "keywords">;

export function createTriggerSession(): TriggerSession {
  return { triggeredTypes: new Set() };
}

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function compileCustomPatterns(config: TriggerConfig): RegExp[] {
  return config.keywords.customPatterns
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter((p): p is RegExp => p !== null);
}

function checkDedup(type: TriggerType, session?: TriggerSession): boolean {
  if (!session || !type) return false;
  return session.triggeredTypes.has(type);
}

function recordTrigger(type: TriggerType, session?: TriggerSession): void {
  if (session && type) {
    session.triggeredTypes.add(type);
  }
}

export function detectTrigger(text: string, session?: TriggerSession, config: TriggerConfig = loadConfig()): TriggerResult {
  if (!config.keywords.enabled) {
    return { type: null };
  }

  const textWithoutCode = removeCodeBlocks(text);

  for (const pattern of SAVE_PATTERNS) {
    const match = textWithoutCode.match(pattern);
    if (match) {
      if (checkDedup("save", session)) {
        return { type: null, deduplicated: true };
      }
      recordTrigger("save", session);
      return { type: "save", match: match[0] };
    }
  }

  const researchPatterns = [...RESEARCH_PATTERNS, ...compileCustomPatterns(config)];
  for (const pattern of researchPatterns) {
    const match = textWithoutCode.match(pattern);
    if (match) {
      if (checkDedup("research", session)) {
        return { type: null, deduplicated: true };
      }
      recordTrigger("research", session);
      return { type: "research", match: match[0] };
    }
  }

  for (const pattern of URL_PATTERNS) {
    const match = textWithoutCode.match(pattern);
    if (match) {
      if (checkDedup("url", session)) {
        return { type: null, deduplicated: true };
      }
      recordTrigger("url", session);
      return { type: "url", match: match[0] };
    }
  }

  return { type: null };
}

export function detectKeyword(text: string, config: TriggerConfig = loadConfig()): { type: "research" | "save" | null; match?: string } {
  const result = detectTrigger(text, undefined, config);
  if (result.type === "url") {
    return { type: "research", match: result.match };
  }
  return { type: result.type, match: result.match };
}

export function detectResearchKeyword(text: string, config: TriggerConfig = loadConfig()): { detected: boolean; match?: string } {
  const result = detectKeyword(text, config);
  return { detected: result.type === "research", match: result.match };
}

export const NIA_NUDGE_MESSAGE = `[NIA KNOWLEDGE TRIGGER]
The user is asking for research, documentation, or codebase exploration.
You have access to Nia MCP tools (${NIA_TOOLS_LIST}).
Refer to your Nia instructions for the detailed workflow. Use these tools to provide accurate, up-to-date information.`;

export const NIA_SAVE_NUDGE_MESSAGE = `[NIA CONTEXT SAVE TRIGGER]
The user wants to save this conversation to continue later or hand off to another agent.

**Use \`${TOOL_NAMES.context}\` to save:**
\`\`\`
${TOOL_NAMES.context}({
  action: "save",
  title: "Brief title describing this session",
  summary: "What was accomplished and what's pending",
  content: "Key decisions, code snippets, and important context",
  tags: ["relevant", "tags"],
  edited_files: [{ path: "file/path.ts", action: "modified" }]
})
\`\`\`

**What to include:**
- Summary of what was discussed/accomplished
- Key decisions made
- Code snippets or plans created
- Files that were edited
- Next steps or pending tasks
- Any Nia sources that were referenced

This context can be loaded in Cursor, Claude Code, Windsurf, or any agent with Nia access.`;

export const NIA_URL_NUDGE_MESSAGE = `[NIA URL INDEXING TRIGGER]
The user referenced a package/repository URL. Consider indexing it for better context.

**Use Nia tools to index:**
- \`${TOOL_NAMES.index}\` — Index a GitHub repo, npm package, or PyPI project
- \`${TOOL_NAMES.research}\` — Research the referenced library/package

This enables future searches to include this resource's documentation and code.`;
