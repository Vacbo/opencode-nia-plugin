import { log } from "../services/logger.js";

const NIA_PREFIX = "nia_";
const CACHEABLE_TOOLS = new Set(["nia_search", "nia_read", "nia_grep"]);

export interface ToolObserverInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: unknown;
}

export interface ToolObserverOutput {
  title: string;
  output: string;
  metadata: unknown;
}

export interface CachedToolResult {
  toolName: string;
  sessionID: string;
  callID: string;
  args: unknown;
  output: string;
  title: string;
  cachedAt: number;
}

export interface UsageStats {
  totalCalls: number;
  byTool: Record<string, number>;
  lastCallAt: number;
}

export interface SessionState {
  cache: Map<string, CachedToolResult>;
  usage: UsageStats;
}

let sessionState: SessionState = createEmptyState();

function createEmptyState(): SessionState {
  return {
    cache: new Map(),
    usage: {
      totalCalls: 0,
      byTool: {},
      lastCallAt: 0,
    },
  };
}

export function getSessionState(): SessionState {
  return sessionState;
}

export function resetSessionState(): void {
  sessionState = createEmptyState();
}

function isNiaTool(toolName: string): boolean {
  return toolName.startsWith(NIA_PREFIX);
}

function isCacheable(toolName: string): boolean {
  return CACHEABLE_TOOLS.has(toolName);
}

function updateUsageStats(toolName: string): void {
  sessionState.usage.totalCalls += 1;
  sessionState.usage.byTool[toolName] = (sessionState.usage.byTool[toolName] ?? 0) + 1;
  sessionState.usage.lastCallAt = Date.now();
}

function cacheResult(input: ToolObserverInput, output: ToolObserverOutput): void {
  sessionState.cache.set(input.callID, {
    toolName: input.tool,
    sessionID: input.sessionID,
    callID: input.callID,
    args: input.args,
    output: output.output,
    title: output.title,
    cachedAt: Date.now(),
  });
}

export function createToolObserver(): (
  input: ToolObserverInput,
  output: ToolObserverOutput,
) => Promise<void> {
  return async (input, output) => {
    if (!isNiaTool(input.tool)) {
      return;
    }

    updateUsageStats(input.tool);

    if (isCacheable(input.tool)) {
      cacheResult(input, output);
    }

    log("tool-observer: recorded", {
      tool: input.tool,
      callID: input.callID,
      cached: isCacheable(input.tool),
      totalCalls: sessionState.usage.totalCalls,
    });
  };
}
