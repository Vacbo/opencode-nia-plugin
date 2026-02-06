import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPENCODE_CONFIG_DIR,
  PLUGIN_NAME,
  NIA_INSTRUCTIONS_URL,
} from "./constants.js";
import { stripJsoncComments, readConfig, writeConfig } from "./config.js";

export function addPluginToConfig(configPath: string): boolean {
  try {
    const content = readFileSync(configPath, "utf-8");

    if (content.includes("nia-opencode")) {
      console.log("  Plugin already registered in config");
      return true;
    }

    const jsonContent = stripJsoncComments(content);
    let config: Record<string, unknown>;

    try {
      config = JSON.parse(jsonContent);
    } catch {
      console.error("  Failed to parse config file");
      return false;
    }

    const plugins = (config.plugin as string[]) || [];
    plugins.push(PLUGIN_NAME);
    config.plugin = plugins;

    if (configPath.endsWith(".jsonc")) {
      if (content.includes('"plugin"')) {
        const newContent = content.replace(
          /("plugin"\s*:\s*\[)([^\]]*?)(\])/,
          (_match, start, middle, end) => {
            const trimmed = middle.trim();
            if (trimmed === "") {
              return `${start}\n    "${PLUGIN_NAME}"\n  ${end}`;
            }
            return `${start}${middle.trimEnd()},\n    "${PLUGIN_NAME}"\n  ${end}`;
          },
        );
        writeFileSync(configPath, newContent);
      } else {
        const newContent = content.replace(
          /^(\s*\{)/,
          `$1\n  "plugin": ["${PLUGIN_NAME}"],`,
        );
        writeFileSync(configPath, newContent);
      }
    } else {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    console.log(`  Added plugin to ${configPath}`);
    return true;
  } catch (err) {
    console.error("  Failed to update config:", err);
    return false;
  }
}

export function addMcpServerToConfig(
  configPath: string,
  apiKey: string,
): boolean {
  try {
    const config = readConfig(configPath);
    if (!config) {
      console.error("  Failed to parse config file");
      return false;
    }

    const mcp = (config.mcp as Record<string, unknown>) || {};

    if (mcp.nia) {
      console.log("  MCP server 'nia' already configured");
      return true;
    }

    mcp.nia = {
      type: "remote",
      url: "https://apigcp.trynia.ai/mcp",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      oauth: false,
    };

    config.mcp = mcp;

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("  Added MCP server 'nia' to config");
    return true;
  } catch (err) {
    console.error("  Failed to add MCP server:", err);
    return false;
  }
}

export function addInstructionsUrl(configPath: string): boolean {
  try {
    const config = readConfig(configPath);
    if (!config) {
      console.error("  Failed to parse config file");
      return false;
    }

    const instructions = (config.instructions as string[]) || [];

    if (
      instructions.some(
        (i) => i.includes("nia-mcp-instructions") || i.includes("nia-opencode"),
      )
    ) {
      console.log("  Nia instructions URL already in config");
      return true;
    }

    instructions.push(NIA_INSTRUCTIONS_URL);
    config.instructions = instructions;

    writeConfig(configPath, config);
    console.log("  Added Nia instructions URL to config");
    return true;
  } catch (err) {
    console.error("  Failed to add instructions URL:", err);
    return false;
  }
}

export function createNewMCPConfig(apiKey: string): boolean {
  mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });

  const configPath = join(OPENCODE_CONFIG_DIR, "opencode.json");
  const config: Record<string, unknown> = {
    plugin: [PLUGIN_NAME],
    instructions: [NIA_INSTRUCTIONS_URL],
    mcp: {
      nia: {
        type: "remote",
        url: "https://apigcp.trynia.ai/mcp",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        oauth: false,
      },
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`  Created ${configPath}`);
  return true;
}
