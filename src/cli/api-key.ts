import { mkdirSync, writeFileSync } from "node:fs";
import { NIA_API_KEY_DIR, NIA_API_KEY_PATH } from "./constants.js";

export function storeApiKeyNiaSkill(apiKey: string): boolean {
  try {
    mkdirSync(NIA_API_KEY_DIR, { recursive: true });
    writeFileSync(NIA_API_KEY_PATH, apiKey);
    console.log(`  Stored API key at ${NIA_API_KEY_PATH}`);
    return true;
  } catch (err) {
    console.error("  Failed to store API key:", err);
    return false;
  }
}
