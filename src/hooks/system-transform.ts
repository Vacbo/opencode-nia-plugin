import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PendingOperation } from "../api/types.js";
import { jobManager } from "../state/job-manager.js";
import { getSessionState } from "../state/session.js";

const DEFAULT_SESSION_ID = "__system__";
const INJECTED_HINTS_KEY = "system-transform.injected-hints";
const PROJECT_HINT_CACHE_PREFIX = "system-transform.project-hint:";

const ROUTING_HINT =
  "Nia tools available: use nia_search for semantic search, nia_read for source inspection, nia_grep for exact matches, nia_explore for broad repo discovery, nia_index to add repos or docs, nia_research for deep documentation work, and nia_manage_resource to inspect or manage indexed sources.";

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

type CacheWithEntries<V> = {
  entries?: Map<string, CacheEntry<V>>;
  get(key: string): V | undefined;
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export interface SystemTransformContext {
  sessionID?: string;
  cwd?: string;
  worktree?: string;
  directory?: string;
}

export interface SystemTransformOptions {
  readTextFile?: (path: string) => Promise<string>;
}

export type SystemTransform = (systemPrompt: string[], context: SystemTransformContext) => Promise<string[]>;

export function createSystemTransform(options: SystemTransformOptions = {}): SystemTransform {
  return async (systemPrompt, context) => transformSystemPrompt(systemPrompt, context, options);
}

export async function transformSystemPrompt(
  systemPrompt: string[],
  context: SystemTransformContext,
  options: SystemTransformOptions = {},
): Promise<string[]> {
  const sessionState = getSessionState(context.sessionID ?? DEFAULT_SESSION_ID);
  const injectedHints = getInjectedHints(sessionState.projectContext);
  const prompt = [...systemPrompt];
  const additions: string[] = [];

  appendHint(additions, prompt, injectedHints, "routing", ROUTING_HINT);

  const knownSourceHint = buildKnownSourcesHint(
    sessionState.sourceCache as unknown as CacheWithEntries<unknown>,
    injectedHints,
  );
  if (knownSourceHint) {
    additions.push(knownSourceHint);
  }

  const completedOperations = await sessionState.pendingOps.checkAndDrain();
  if (completedOperations.length > 0) {
    additions.push(formatCompletedOperationsHint(completedOperations));
  }

  const pendingOperationsHint = buildPendingOperationsHint(sessionState.pendingOps.getAllOperations(), injectedHints);
  if (pendingOperationsHint) {
    additions.push(pendingOperationsHint);
  }

  const pendingJobs = jobManager.getPendingJobs(context.sessionID ?? DEFAULT_SESSION_ID);
  if (pendingJobs.length > 0) {
    additions.push(formatPendingJobsHint(pendingJobs));
  }

  const projectHint = await getProjectHint(context, sessionState.projectContext, options.readTextFile ?? readFileUtf8);
  if (projectHint) {
    appendHint(additions, prompt, injectedHints, `project:${projectHint}`, projectHint);
  }

  if (additions.length === 0) {
    return prompt;
  }

  return [...additions, ...prompt];
}

function getInjectedHints(projectContext: Map<string, unknown>): Set<string> {
  const existing = projectContext.get(INJECTED_HINTS_KEY);
  if (existing instanceof Set) {
    return existing as Set<string>;
  }

  const next = new Set<string>();
  projectContext.set(INJECTED_HINTS_KEY, next);
  return next;
}

function appendHint(
  additions: string[],
  prompt: string[],
  injectedHints: Set<string>,
  key: string,
  hint: string,
): void {
  if (injectedHints.has(key) || additions.includes(hint) || prompt.includes(hint)) {
    return;
  }

  injectedHints.add(key);
  additions.push(hint);
}

function buildKnownSourcesHint(cache: CacheWithEntries<unknown>, injectedHints: Set<string>): string | undefined {
  const sourceLabels = collectKnownSourceLabels(cache)
    .filter((label) => !injectedHints.has(`source:${label}`))
    .sort();

  if (sourceLabels.length === 0) {
    return undefined;
  }

  for (const label of sourceLabels) {
    injectedHints.add(`source:${label}`);
  }

  return `Known Nia sources in this session: ${sourceLabels.join(", ")}. Reuse these before adding duplicate sources.`;
}

function collectKnownSourceLabels(cache: CacheWithEntries<unknown>): string[] {
  const store = cache.entries;
  if (!(store instanceof Map)) {
    return [];
  }

  const labels = new Set<string>();

  for (const key of store.keys()) {
    const value = cache.get(key);
    const label = formatSourceLabel(value);
    if (label) {
      labels.add(label);
    }
  }

  return [...labels];
}

function formatSourceLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;

  if (typeof source.repository === "string") {
    return typeof source.branch === "string" ? `${source.repository}#${source.branch}` : source.repository;
  }

  if (typeof source.display_name === "string") {
    return source.display_name;
  }

  if (typeof source.title === "string") {
    return source.title;
  }

  if (typeof source.url === "string") {
    return source.url;
  }

  if (typeof source.name === "string") {
    return source.name;
  }

  if (typeof source.id === "string") {
    return source.id;
  }

  return undefined;
}

function formatCompletedOperationsHint(operations: PendingOperation[]): string {
  const summaries = operations.map((operation) => `${operation.name} completed in the background`).join("; ");
  return `Background completions: ${summaries}.`;
}

function buildPendingOperationsHint(operations: PendingOperation[], injectedHints: Set<string>): string | undefined {
  const pendingSummaries = operations
    .map((operation) => {
      const summary = formatPendingOperation(operation);
      if (!summary) {
        return undefined;
      }

      const key = `pending:${operation.id}:${operation.status ?? "pending"}:${operation.progress ?? -1}`;
      if (injectedHints.has(key)) {
        return undefined;
      }

      injectedHints.add(key);
      return summary;
    })
    .filter((summary): summary is string => Boolean(summary));

  if (pendingSummaries.length === 0) {
    return undefined;
  }

  return `Pending background work: ${pendingSummaries.join("; ")}.`;
}

function formatPendingOperation(operation: PendingOperation): string | undefined {
  if (operation.status === "completed" || operation.status === "error") {
    return undefined;
  }

  const progressSuffix = typeof operation.progress === "number" ? ` (${Math.round(operation.progress)}%)` : "";
  return `${operation.name} is ${operation.status ?? "pending"}${progressSuffix}`;
}

function formatPendingJobsHint(jobs: { jobId: string; type: string }[]): string {
  const lines = ["⏳ Waiting for Nia operations to complete:"];
  for (const job of jobs) {
    const label = job.type === "oracle" ? "Oracle research" : "Tracer analysis";
    lines.push(`- ${label} (Job ID: ${job.jobId})`);
  }
  lines.push("", "Results will be delivered via promptAsync when ready.");
  return lines.join("\n");
}

async function getProjectHint(
  context: SystemTransformContext,
  projectContext: Map<string, unknown>,
  readTextFile: (path: string) => Promise<string>,
): Promise<string | undefined> {
  const root = context.cwd ?? context.worktree ?? context.directory;
  if (!root) {
    return undefined;
  }

  const cacheKey = `${PROJECT_HINT_CACHE_PREFIX}${root}`;
  const cached = projectContext.get(cacheKey);
  if (typeof cached === "string") {
    return cached;
  }

  if (cached === null) {
    return undefined;
  }

  let packageJson: PackageJson | undefined;

  try {
    packageJson = JSON.parse(await readTextFile(join(root, "package.json"))) as PackageJson;
  } catch {
    projectContext.set(cacheKey, null);
    return undefined;
  }

  const projectHint = detectProjectHint(packageJson);
  projectContext.set(cacheKey, projectHint ?? null);
  return projectHint;
}

function detectProjectHint(packageJson: PackageJson): string | undefined {
  const packages = new Set<string>([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);

  if (packages.has("next")) {
    return "Project context: Next.js project detected from package.json. Bias Nia guidance toward app routing, server actions, and React UI patterns.";
  }

  if (packages.has("react")) {
    return "Project context: React project detected from package.json. Bias Nia guidance toward components, hooks, routing, and frontend docs.";
  }

  if (packages.has("vue")) {
    return "Project context: Vue project detected from package.json. Bias Nia guidance toward components, composables, and build tooling.";
  }

  if (packages.has("typescript") || packages.has("ts-node") || packages.has("tsx")) {
    return "Project context: TypeScript project detected from package.json. Bias Nia guidance toward types, module boundaries, and build configuration.";
  }

  if (packages.size > 0) {
    return "Project context: Node project detected from package.json. Bias Nia guidance toward package scripts, runtime behavior, and dependency-aware lookups.";
  }

  return undefined;
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export default createSystemTransform;
