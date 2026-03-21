import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cli/api-key.js", () => ({
	storeApiKeyNiaSkill: vi.fn(),
}));
vi.mock("./cli/cleanup.js", () => ({
	cleanupAgentsMd: vi.fn(),
	removeInstructionsFromConfig: vi.fn(),
	removeNiaConfig: vi.fn(),
	removePluginFromConfig: vi.fn(),
}));
vi.mock("./cli/config.js", () => ({
	findOpencodeConfig: vi.fn(() => null),
	stripJsoncComments: vi.fn((s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?:^|\n)\s*\/\/.*\n?/gm, "").replace(/(?<=\s)\/\/.*$/gm, "")),
}));
vi.mock("./cli/skill.js", () => ({
	installSkill: vi.fn(),
	removeSkill: vi.fn(),
}));
vi.mock("./cli/prompt.js", () => ({
	confirm: vi.fn(),
	createReadline: vi.fn(() => ({ close: vi.fn() })),
	prompt: vi.fn(),
}));

import { createProgram } from "./cli.js";

describe("CLI", () => {
	let helpOutput: string;
	let errorOutput: string;

	beforeEach(() => {
		helpOutput = "";
		errorOutput = "";
	});

	function runCLI(args: string[]) {
		const program = createProgram();
		program.exitOverride();
		program.configureOutput({
			writeOut: (str: string) => {
				helpOutput += str;
			},
			writeErr: (str: string) => {
				errorOutput += str;
			},
		});
		return program.parseAsync(["node", "nia-opencode", ...args]);
	}

	describe("--help", () => {
		it("should print usage information", async () => {
			await expect(runCLI(["--help"])).rejects.toThrow();
			expect(helpOutput).toContain("install");
			expect(helpOutput).toContain("uninstall");
			expect(helpOutput).toContain("nia-opencode");
		});
	});

	describe("install command", () => {
		it("should accept --no-tui and --api-key flags", async () => {
			await runCLI(["install", "--no-tui", "--api-key", "nk_test123"]);
		});

		it("should accept install with --no-tui only", async () => {
			await runCLI(["install", "--no-tui"]);
		});
	});

	describe("uninstall command", () => {
		it("should accept --no-tui flag", async () => {
			await runCLI(["uninstall", "--no-tui"]);
		});
	});

	describe("unknown command", () => {
		it("should exit with error for unknown commands", async () => {
			await expect(runCLI(["foobar"])).rejects.toThrow();
			expect(errorOutput).toContain("foobar");
		});
	});
});
