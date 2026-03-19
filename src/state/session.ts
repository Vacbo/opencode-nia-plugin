import { loadConfig } from "../config.js";

import { TTLCache } from "./cache.js";
import { OpsTracker } from "./ops-tracker.js";

const SESSION_STATES = new Map<string, NiaSessionState>();

export class NiaSessionState {
  readonly sourceCache: TTLCache<string, unknown>;
  readonly searchDedup: TTLCache<string, boolean>;
  readonly pendingOps: OpsTracker;
  readonly projectContext = new Map<string, unknown>();

  constructor(public readonly sessionID: string) {
    const config = loadConfig();
    const ttlMs = config.cacheTTL * 1000;

    this.sourceCache = new TTLCache<string, unknown>({ ttl: ttlMs });
    this.searchDedup = new TTLCache<string, boolean>({ ttl: ttlMs });
    this.pendingOps = new OpsTracker({ checkInterval: config.checkInterval });
  }
}

export function getSessionState(sessionID: string): NiaSessionState {
  const existing = SESSION_STATES.get(sessionID);
  if (existing) {
    return existing;
  }

  const state = new NiaSessionState(sessionID);
  SESSION_STATES.set(sessionID, state);
  return state;
}
