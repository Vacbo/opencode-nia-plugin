import { readConfig, writeConfig } from "./config.js";

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
