import { loadConfig } from "../config.js";
import { createTriggerSession, type TriggerSession } from "../hooks/smart-triggers.js";

import { TTLCache } from "./cache.js";
import { OpsTracker } from "./ops-tracker.js";

const MAX_SESSION_STATES = 100;

type SessionRecord = {
  state: NiaSessionState;
  lastAccessedAt: number;
};

const SESSION_STATES = new Map<string, SessionRecord>();

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

export class NiaSessionState {
  readonly sourceCache: TTLCache<string, unknown>;
  readonly searchDedup: TTLCache<string, boolean>;
  readonly pendingOps: OpsTracker;
  readonly projectContext = new Map<string, unknown>();
  readonly triggerSession: TriggerSession;
  readonly cache = new Map<string, CachedToolResult>();
  readonly usage: UsageStats = {
    totalCalls: 0,
    byTool: {},
    lastCallAt: 0,
  };
  toolExecuteAfterCount = 0;
  systemTransformCount = 0;

  constructor(public readonly sessionID: string) {
    const config = loadConfig();
    const ttlMs = config.cacheTTL * 1000;

    this.sourceCache = new TTLCache<string, unknown>({ ttl: ttlMs });
    this.searchDedup = new TTLCache<string, boolean>({ ttl: ttlMs });
    this.pendingOps = new OpsTracker({ checkInterval: config.checkInterval });
    this.triggerSession = createTriggerSession();
  }
}

export function getSessionState(sessionID: string): NiaSessionState {
  cleanupStaleSessionStates();

  const existing = SESSION_STATES.get(sessionID);
  if (existing) {
    touchSession(sessionID, existing);
    return existing.state;
  }

  const state = new NiaSessionState(sessionID);
  SESSION_STATES.set(sessionID, {
    state,
    lastAccessedAt: Date.now(),
  });
  evictLeastRecentlyUsedSessions();
  return state;
}

export function removeSessionState(sessionID: string): void {
  SESSION_STATES.delete(sessionID);
}

export function resetSessionStates(): void {
  SESSION_STATES.clear();
}

function cleanupStaleSessionStates(now = Date.now()): void {
  const ttlMs = loadConfig().cacheTTL * 1000;

  for (const [sessionID, record] of SESSION_STATES.entries()) {
    if (now - record.lastAccessedAt >= ttlMs) {
      SESSION_STATES.delete(sessionID);
    }
  }
}

function touchSession(sessionID: string, record: SessionRecord): void {
  record.lastAccessedAt = Date.now();
  SESSION_STATES.delete(sessionID);
  SESSION_STATES.set(sessionID, record);
}

function evictLeastRecentlyUsedSessions(): void {
  while (SESSION_STATES.size > MAX_SESSION_STATES) {
    const oldestSessionID = SESSION_STATES.keys().next().value;
    if (!oldestSessionID) {
      return;
    }

    SESSION_STATES.delete(oldestSessionID);
  }
}
