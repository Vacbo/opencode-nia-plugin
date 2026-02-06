import { mkdirSync, writeFileSync } from "node:fs";
import {
  OPENCODE_CONFIG_DIR,
  NIA_CONFIG_PATH,
  NIA_API_KEY_DIR,
  NIA_API_KEY_PATH,
} from "./constants.js";

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

export function createNiaConfig(apiKey: string): boolean {
  mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });

  const config = {
    apiKey,
    keywords: {
      enabled: true,
    },
  };

  writeFileSync(NIA_CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`  Created ${NIA_CONFIG_PATH}`);
  return true;
}
