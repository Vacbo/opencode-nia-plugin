import { join } from "node:path";
import { homedir } from "node:os";

export const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode");
export const NIA_CONFIG_PATH = join(OPENCODE_CONFIG_DIR, "nia.json");
export const AGENTS_MD_PATH = join(OPENCODE_CONFIG_DIR, "AGENTS.md");
export const NIA_API_KEY_DIR = join(homedir(), ".config", "nia");
export const NIA_API_KEY_PATH = join(NIA_API_KEY_DIR, "api_key");
export const PLUGIN_NAME = "@vacbo/opencode-nia-plugin@latest";
export const NIA_SKILL_REPO = "nozomio-labs/nia-skill";
export const NIA_SKILL_NAME = "nia";
export const SKILLS_MIN_VERSION = "1.1.50";
export const NIA_INSTRUCTIONS_PATH = "nia-opencode/instructions/nia-tools.md";
