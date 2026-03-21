#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { storeApiKeyNiaSkill } from "./cli/api-key.js";
import {
	cleanupAgentsMd,
	removeInstructionsFromConfig,
	removeNiaConfig,
	removePluginFromConfig,
} from "./cli/cleanup.js";
import { findOpencodeConfig, stripJsoncComments } from "./cli/config.js";
import {
	NIA_INSTRUCTIONS_PATH,
	OPENCODE_CONFIG_DIR,
	PLUGIN_NAME,
} from "./cli/constants.js";
import { confirm, createReadline, prompt } from "./cli/prompt.js";
import { installSkill, removeSkill } from "./cli/skill.js";

interface InstallOptions {
	tui: boolean;
	apiKey?: string;
}

function addPluginToConfig(configPath: string): boolean {
	try {
		const content = readFileSync(configPath, "utf-8");

		if (content.includes(PLUGIN_NAME)) {
			console.log("  Plugin already registered in config");
			return true;
		}

		// Parse JSON (support JSONC by stripping comments)
		let config: Record<string, unknown>;
		try {
			const jsonContent = stripJsoncComments(content);
			config = JSON.parse(jsonContent);
		} catch {
			console.error("  Failed to parse config file");
			return false;
		}

		const plugins = (config.plugin as string[]) || [];
		plugins.push(PLUGIN_NAME);
		config.plugin = plugins;

		writeFileSync(configPath, JSON.stringify(config, null, 2));
		console.log(`  Added plugin to ${configPath}`);
		return true;
	} catch (err) {
		console.error("  Failed to update config:", err);
		return false;
	}
}

function addInstructionsToConfig(configPath: string): boolean {
	try {
		const content = readFileSync(configPath, "utf-8");

		if (
			content.includes("nia-opencode") ||
			content.includes(NIA_INSTRUCTIONS_PATH)
		) {
			console.log("  Nia instructions already in config");
			return true;
		}

		let config: Record<string, unknown>;
		try {
			const jsonContent = stripJsoncComments(content);
			config = JSON.parse(jsonContent);
		} catch {
			console.error("  Failed to parse config file");
			return false;
		}

		const instructions = (config.instructions as string[]) || [];
		instructions.push(NIA_INSTRUCTIONS_PATH);
		config.instructions = instructions;

		writeFileSync(configPath, JSON.stringify(config, null, 2));
		console.log("  Added Nia instructions to config");
		return true;
	} catch (err) {
		console.error("  Failed to add instructions:", err);
		return false;
	}
}

function createNewConfig(): boolean {
	try {
		mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });

		const configPath = join(OPENCODE_CONFIG_DIR, "opencode.json");
		const config: Record<string, unknown> = {
			plugin: [PLUGIN_NAME],
			instructions: [NIA_INSTRUCTIONS_PATH],
		};

		writeFileSync(configPath, JSON.stringify(config, null, 2));
		console.log(`  Created ${configPath}`);
		return true;
	} catch (err) {
		console.error("  Failed to create config:", err);
		return false;
	}
}

async function install(options: InstallOptions): Promise<number> {
	console.log("\n Nia OpenCode Plugin Installer\n");

	const rl = options.tui ? createReadline() : null;

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

	// ── Step 2: Store API key in environment ────────────────────────────────
	console.log("\nStep 2: Store API Key");
	if (apiKey) {
		storeApiKeyNiaSkill(apiKey);
		console.log("  API key stored in ~/.config/nia/api_key");
		console.log("  Set NIA_API_KEY environment variable for session access:");
		console.log(`  export NIA_API_KEY="${apiKey}"`);
	} else {
		console.log("  Skipped (no API key)");
	}

	// ── Step 3: Install nia-skill ───────────────────────────────────────────
	console.log("\nStep 3: Install Nia Skill");
	installSkill();

	// ── Step 4: Configure OpenCode with native plugin ──────────────────────
	console.log("\nStep 4: Configure OpenCode (Native Plugin)");
	const configPath = findOpencodeConfig();

	if (configPath) {
		if (options.tui && rl) {
			const shouldModify = await confirm(rl, `Modify ${configPath}?`);
			if (shouldModify) {
				addPluginToConfig(configPath);
				addInstructionsToConfig(configPath);
			} else {
				console.log("  Skipped.");
			}
		} else {
			addPluginToConfig(configPath);
			addInstructionsToConfig(configPath);
		}
	} else {
		if (options.tui && rl) {
			const shouldCreate = await confirm(
				rl,
				"No OpenCode config found. Create one?",
			);
			if (shouldCreate) {
				createNewConfig();
			} else {
				console.log("  Skipped.");
			}
		} else {
			createNewConfig();
		}
	}

	// ── Step 5: Cleanup legacy artifacts ───────────────────────────────────
	console.log("\nStep 5: Clean Up Legacy Config");
	cleanupAgentsMd();

	const existingConfigPath = findOpencodeConfig();
	if (existingConfigPath) {
		// Clean up any old MCP config if it exists
		removePluginFromConfig(existingConfigPath);
		removeInstructionsFromConfig(existingConfigPath);
	}

	// ── Summary ───────────────────────────────────────────────────────────
	console.log("\n" + "-".repeat(50));
	console.log("\n Setup Complete!\n");

	if (!apiKey) {
		console.log("Next steps:");
		console.log("1. Get your API key from: https://app.trynia.ai");
		console.log("2. Store your API key:");
		console.log("   mkdir -p ~/.config/nia");
		console.log('   echo "nk_..." > ~/.config/nia/api_key');
		console.log("3. Set environment variable for current session:");
		console.log('   export NIA_API_KEY="nk_..."');
	} else {
		console.log("Nia is configured and ready to use!");
	}

	console.log("\nNia is available as an Agent Skill.");
	console.log(
		"The agent will automatically discover and load it when relevant.",
	);

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

export function createProgram(): Command {
	const program = new Command();

	program
		.name("nia-opencode")
		.description("Nia Knowledge Agent for OpenCode")
		.version("0.1.5");

	program
		.command("install")
		.description("Install and configure Nia for OpenCode")
		.option("--no-tui", "Non-interactive mode")
		.option("--api-key <key>", "Provide API key directly")
		.action(async (opts: { tui: boolean; apiKey?: string }) => {
			await install({ tui: opts.tui, apiKey: opts.apiKey });
		});

	program
		.command("uninstall")
		.description("Remove all Nia configuration")
		.option("--no-tui", "Non-interactive mode")
		.action(async (opts: { tui: boolean }) => {
			await uninstall({ tui: opts.tui });
		});

	return program;
}

const isDirectExecution =
	process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts");

if (isDirectExecution) {
	createProgram().parseAsync();
}
