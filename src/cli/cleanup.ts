import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import {
  AGENTS_MD_PATH,
  NIA_CONFIG_PATH,
  NIA_API_KEY_PATH,
} from "./constants.js";
import { readConfig, writeConfig } from "./config.js";

export function cleanupAgentsMd(): boolean {
  try {
    if (!existsSync(AGENTS_MD_PATH)) {
      return true;
    }

    const content = readFileSync(AGENTS_MD_PATH, "utf-8");

    if (!content.includes("# How to use Nia")) {
      return true;
    }

    // Remove the Nia section: from the frontmatter block (---\nname: nia...) or
    // from "# How to use Nia" to the end of the Nia content
    let cleaned = content;

    // Try to remove the full frontmatter + content block
    const frontmatterPattern =
      /\n*---\s*\nname:\s*nia\b[\s\S]*?---\s*\n[\s\S]*?(?=\n---\s*\nname:|\n# (?!How to use Nia|#)|\s*$)/;
    if (frontmatterPattern.test(cleaned)) {
      cleaned = cleaned.replace(frontmatterPattern, "");
    } else {
      // Fallback: remove from "# How to use Nia" to the next top-level heading or end
      const niaPattern = /\n*# How to use Nia[\s\S]*?(?=\n# (?!#)|\s*$)/;
      cleaned = cleaned.replace(niaPattern, "");
    }

    cleaned = cleaned.trim();

    if (cleaned === "") {
      unlinkSync(AGENTS_MD_PATH);
      console.log("  Removed empty AGENTS.md");
    } else {
      writeFileSync(AGENTS_MD_PATH, cleaned + "\n");
      console.log("  Removed Nia instructions from AGENTS.md");
    }

    return true;
  } catch (err) {
    console.error("  Failed to clean up AGENTS.md:", err);
    return false;
  }
}

export function removePluginFromConfig(configPath: string): boolean {
  try {
    const config = readConfig(configPath);
    if (!config) return false;

    const plugins = config.plugin as string[] | undefined;
    if (plugins) {
      const filtered = plugins.filter((p) => !p.includes("nia-opencode"));
      if (filtered.length !== plugins.length) {
        if (filtered.length === 0) {
          delete config.plugin;
        } else {
          config.plugin = filtered;
        }
        writeConfig(configPath, config);
        console.log("  Removed nia-opencode plugin from config");
      }
    }

    return true;
  } catch (err) {
    console.error("  Failed to remove plugin from config:", err);
    return false;
  }
}

export function removeInstructionsFromConfig(configPath: string): boolean {
  try {
    const config = readConfig(configPath);
    if (!config) return false;

    const instructions = config.instructions as string[] | undefined;
    if (instructions) {
      const filtered = instructions.filter(
        (i) => !i.includes("nia-opencode"),
      );
      if (filtered.length !== instructions.length) {
        if (filtered.length === 0) {
          delete config.instructions;
        } else {
          config.instructions = filtered;
        }
        writeConfig(configPath, config);
        console.log("  Removed Nia instructions URL from config");
      }
    }

    return true;
  } catch (err) {
    console.error("  Failed to remove instructions from config:", err);
    return false;
  }
}

export function removeNiaConfig(): boolean {
  try {
    if (existsSync(NIA_CONFIG_PATH)) {
      unlinkSync(NIA_CONFIG_PATH);
      console.log(`  Removed ${NIA_CONFIG_PATH}`);
    }
    if (existsSync(NIA_API_KEY_PATH)) {
      unlinkSync(NIA_API_KEY_PATH);
      console.log(`  Removed ${NIA_API_KEY_PATH}`);
    }
    return true;
  } catch (err) {
    console.error("  Failed to remove Nia config:", err);
    return false;
  }
}
