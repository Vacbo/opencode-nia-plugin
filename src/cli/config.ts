import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OPENCODE_CONFIG_DIR } from "./constants.js";

export function stripJsoncComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

export function findOpencodeConfig(): string | null {
  const candidates = [
    join(OPENCODE_CONFIG_DIR, "opencode.jsonc"),
    join(OPENCODE_CONFIG_DIR, "opencode.json"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

export function readConfig(
  configPath: string,
): Record<string, unknown> | null {
  try {
    const content = readFileSync(configPath, "utf-8");
    const jsonContent = stripJsoncComments(content);
    return JSON.parse(jsonContent);
  } catch {
    return null;
  }
}

export function writeConfig(
  configPath: string,
  config: Record<string, unknown>,
): boolean {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch {
    return false;
  }
}
