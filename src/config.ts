export interface NiaConfig {
  apiKey: string | undefined;
  searchEnabled: boolean;
  researchEnabled: boolean;
  tracerEnabled: boolean;
  advisorEnabled: boolean;
  contextEnabled: boolean;
  e2eEnabled: boolean;
  cacheTTL: number;
  maxPendingOps: number;
  checkInterval: number;
  tracerTimeout: number;
  debug: boolean;
  triggersEnabled: boolean;
  apiUrl: string;
  keywords: {
    enabled: boolean;
    customPatterns: string[];
  };
}

const DEFAULTS: NiaConfig = {
  apiKey: undefined,
  searchEnabled: true,
  researchEnabled: true,
  tracerEnabled: true,
  advisorEnabled: true,
  contextEnabled: true,
  e2eEnabled: true,
  cacheTTL: 300,
  maxPendingOps: 5,
  checkInterval: 15,
  tracerTimeout: 120,
  debug: false,
  triggersEnabled: true,
  apiUrl: "https://apigcp.trynia.ai/v2",
  keywords: {
    enabled: true,
    customPatterns: [],
  },
};

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): NiaConfig {
  return {
    apiKey: process.env.NIA_API_KEY,
    searchEnabled: parseBoolean(process.env.NIA_SEARCH, DEFAULTS.searchEnabled),
    researchEnabled: parseBoolean(process.env.NIA_RESEARCH, DEFAULTS.researchEnabled),
    tracerEnabled: parseBoolean(process.env.NIA_TRACER, DEFAULTS.tracerEnabled),
    advisorEnabled: parseBoolean(process.env.NIA_ADVISOR, DEFAULTS.advisorEnabled),
    contextEnabled: parseBoolean(process.env.NIA_CONTEXT, DEFAULTS.contextEnabled),
    e2eEnabled: parseBoolean(process.env.NIA_E2E, DEFAULTS.e2eEnabled),
    cacheTTL: parseNumber(process.env.NIA_CACHE_TTL, DEFAULTS.cacheTTL),
    maxPendingOps: parseNumber(process.env.NIA_MAX_PENDING_OPS, DEFAULTS.maxPendingOps),
    checkInterval: parseNumber(process.env.NIA_CHECK_INTERVAL, DEFAULTS.checkInterval),
    tracerTimeout: parseNumber(process.env.NIA_TRACER_TIMEOUT, DEFAULTS.tracerTimeout),
    debug: parseBoolean(process.env.NIA_DEBUG, DEFAULTS.debug),
    triggersEnabled: parseBoolean(process.env.NIA_TRIGGERS, DEFAULTS.triggersEnabled),
    apiUrl: process.env.NIA_API_URL ?? DEFAULTS.apiUrl,
    keywords: {
      enabled: parseBoolean(process.env.NIA_KEYWORDS_ENABLED, DEFAULTS.keywords.enabled),
      customPatterns: process.env.NIA_KEYWORDS_PATTERNS
        ? process.env.NIA_KEYWORDS_PATTERNS.split(",").map((p) => p.trim()).filter(Boolean)
        : DEFAULTS.keywords.customPatterns,
    },
  };
}

export const CONFIG = loadConfig();

export function isConfigured(): boolean {
  return !!loadConfig().apiKey;
}

export const NIA_API_KEY = process.env.NIA_API_KEY;
export const NIA_MCP_URL = process.env.NIA_API_URL ?? DEFAULTS.apiUrl;