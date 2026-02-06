#!/usr/bin/env node
import { SKILLS_MIN_VERSION } from "./cli/constants.js";
import { createReadline, confirm, prompt } from "./cli/prompt.js";
import { getOpencodeVersion, supportsSkills } from "./cli/version.js";
import { findOpencodeConfig } from "./cli/config.js";
import { storeApiKeyNiaSkill, createNiaConfig } from "./cli/api-key.js";
import { installSkill, removeSkill } from "./cli/skill.js";
import {
  addPluginToConfig,
  addMcpServerToConfig,
  addInstructionsUrl,
  createNewMCPConfig,
} from "./cli/mcp.js";
import {
  cleanupAgentsMd,
  removeMcpFromConfig,
  removePluginFromConfig,
  removeInstructionsFromConfig,
  removeNiaConfig,
} from "./cli/cleanup.js";

interface InstallOptions {
  tui: boolean;
  apiKey?: string;
}

async function install(options: InstallOptions): Promise<number> {
  console.log("\n Nia OpenCode Plugin Installer\n");

  const rl = options.tui ? createReadline() : null;

  // Detect OpenCode version
  const version = getOpencodeVersion();

  if (!version) {
    console.error("Error: Could not detect OpenCode. Is it installed?\n");
    if (rl) rl.close();
    return 1;
  }

  console.log(`Detected OpenCode v${version}`);
  const useSkills = supportsSkills(version);

  if (useSkills) {
    console.log(
      `Using Agent Skills path (v${version} >= v${SKILLS_MIN_VERSION})\n`,
    );
  } else {
    console.log(`Using MCP path (v${version} < v${SKILLS_MIN_VERSION})\n`);
  }

  // ── Step 1: Get API key ──────────────────────────────────────────────────
  console.log("Step 1: Configure API Key");
  let apiKey = options.apiKey || process.env.NIA_API_KEY || "";

  if (!apiKey && options.tui && rl) {
    console.log("Get your API key from: https://app.trynia.ai");
    console.log("New user? Run: curl -fsSL https://app.trynia.ai/cli | sh\n");
    apiKey = await prompt(rl, "Enter your Nia API key (nk_...): ");
  }

  if (!apiKey) {
    console.log(
      "  No API key provided. You can set NIA_API_KEY environment variable later.",
    );
    console.log("  Get your API key at: https://app.trynia.ai\n");
  } else if (!apiKey.startsWith("nk_")) {
    console.log("  Warning: API key should start with 'nk_'");
  } else {
    console.log("  API key configured");
  }

  // ── Step 2: Store API key ────────────────────────────────────────────────
  console.log("\nStep 2: Store API Key");
  if (apiKey) {
    if (useSkills) {
      storeApiKeyNiaSkill(apiKey);
    } else {
      createNiaConfig(apiKey);
      storeApiKeyNiaSkill(apiKey);
    }
  } else {
    console.log("  Skipped (no API key)");
  }

  if (useSkills) {
    // Step 3: Install nia-skill
    console.log("\nStep 3: Install Nia Skill");
    installSkill();

    // Step 4: Cleanup legacy artifacts
    console.log("\nStep 4: Clean Up Legacy Config");
    cleanupAgentsMd();

    const configPath = findOpencodeConfig();
    if (configPath) {
      removeMcpFromConfig(configPath);
      removePluginFromConfig(configPath);
      removeInstructionsFromConfig(configPath);
    }
  } else {
    // Step 3: Register plugin, MCP server, and instructions
    console.log("\nStep 3: Configure OpenCode (MCP)");
    const configPath = findOpencodeConfig();

    if (configPath) {
      if (options.tui && rl) {
        const shouldModify = await confirm(rl, `Modify ${configPath}?`);
        if (shouldModify) {
          addPluginToConfig(configPath);
          if (apiKey) {
            addMcpServerToConfig(configPath, apiKey);
          }
          addInstructionsUrl(configPath);
        } else {
          console.log("  Skipped.");
        }
      } else {
        addPluginToConfig(configPath);
        if (apiKey) {
          addMcpServerToConfig(configPath, apiKey);
        }
        addInstructionsUrl(configPath);
      }
    } else {
      if (options.tui && rl) {
        const shouldCreate = await confirm(
          rl,
          "No OpenCode config found. Create one?",
        );
        if (shouldCreate && apiKey) {
          createNewMCPConfig(apiKey);
        } else {
          console.log("  Skipped.");
        }
      } else if (apiKey) {
        createNewMCPConfig(apiKey);
      }
    }

    // Step 4: Clean up old AGENTS.md content
    console.log("\nStep 4: Clean Up Old AGENTS.md");
    cleanupAgentsMd();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "-".repeat(50));
  console.log("\n Setup Complete!\n");

  if (!apiKey) {
    console.log("Next steps:");
    console.log("1. Get your API key from: https://app.trynia.ai");
    if (useSkills) {
      console.log("2. Store your API key:");
      console.log("   mkdir -p ~/.config/nia");
      console.log('   echo "nk_..." > ~/.config/nia/api_key');
    } else {
      console.log("2. Set the environment variable:");
      console.log('   export NIA_API_KEY="nk_..."');
      console.log("   Or edit ~/.config/opencode/nia.json");
    }
  } else {
    console.log("Nia is configured and ready to use!");
  }

  if (useSkills) {
    console.log("\nNia is available as an Agent Skill.");
    console.log(
      "The agent will automatically discover and load it when relevant.",
    );
  } else {
    console.log("\nNia is configured with MCP server and keyword triggers.");
    console.log(
      'Keyword triggers: "research...", "look up...", "find docs...", "grep for..."',
    );
  }

  console.log("\nRestart OpenCode to activate.\n");

  if (rl) rl.close();
  return 0;
}

async function uninstall(options: { tui: boolean }): Promise<number> {
  console.log("\n Nia OpenCode Uninstaller\n");

  const rl = options.tui ? createReadline() : null;

  if (options.tui && rl) {
    const shouldProceed = await confirm(
      rl,
      "Remove all Nia configuration from OpenCode?",
    );
    if (!shouldProceed) {
      console.log("  Cancelled.");
      rl.close();
      return 0;
    }
  }

  console.log("Removing Nia configuration...\n");

  // Remove skill
  console.log("Step 1: Remove Nia Skill");
  removeSkill();

  // Remove from OpenCode config
  console.log("\nStep 2: Clean OpenCode Config");
  const configPath = findOpencodeConfig();
  if (configPath) {
    removeMcpFromConfig(configPath);
    removePluginFromConfig(configPath);
    removeInstructionsFromConfig(configPath);
  } else {
    console.log("  No OpenCode config found");
  }

  // Remove AGENTS.md content
  console.log("\nStep 3: Clean AGENTS.md");
  cleanupAgentsMd();

  // Remove Nia config files
  console.log("\nStep 4: Remove Nia Config Files");
  removeNiaConfig();

  console.log("\n" + "-".repeat(50));
  console.log("\n Nia has been uninstalled.\n");
  console.log("Restart OpenCode for changes to take effect.\n");

  if (rl) rl.close();
  return 0;
}

function printHelp(): void {
  console.log(`
nia-opencode - Nia Knowledge Agent for OpenCode

Commands:
  install                Install and configure Nia for OpenCode
    --no-tui             Non-interactive mode
    --api-key <key>      Provide API key directly

  uninstall              Remove all Nia configuration
    --no-tui             Non-interactive mode

Examples:
  bunx nia-opencode@latest install
  bunx nia-opencode@latest install --no-tui --api-key nk_xxx
  bunx nia-opencode@latest uninstall
`);
}

const args = process.argv.slice(2);

if (
  args.length === 0 ||
  args[0] === "help" ||
  args[0] === "--help" ||
  args[0] === "-h"
) {
  printHelp();
  process.exit(0);
}

if (args[0] === "install") {
  const noTui = args.includes("--no-tui");
  const apiKeyIndex = args.indexOf("--api-key");
  const apiKey = apiKeyIndex !== -1 ? args[apiKeyIndex + 1] : undefined;

  install({ tui: !noTui, apiKey }).then((code) => process.exit(code));
} else if (args[0] === "uninstall") {
  const noTui = args.includes("--no-tui");

  uninstall({ tui: !noTui }).then((code) => process.exit(code));
} else {
  console.error(`Unknown command: ${args[0]}`);
  printHelp();
  process.exit(1);
}
