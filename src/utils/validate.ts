import type { NiaConfig } from "../config.js";

/**
 * Validate plugin configuration at tool execution time.
 *
 * Returns an error string if the config is invalid, or `null` if valid.
 * Designed to be called at the START of every tool's `execute()` —
 * NOT via `tool.execute.before` (whose contract cannot block execution).
 */
export function validateConfig(config: NiaConfig): string | null {
  if (!config.apiKey) {
    return "config_error: NIA_API_KEY is not set. Run `nia-opencode config set-key` to configure.";
  }

  return null;
}
