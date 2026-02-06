import { execSync } from "node:child_process";
import { NIA_SKILL_REPO, NIA_SKILL_NAME } from "./constants.js";

export function installSkill(): boolean {
  try {
    console.log(`  Installing nia-skill from ${NIA_SKILL_REPO}...`);
    execSync(`npx skills add ${NIA_SKILL_REPO} -g -a opencode -y`, {
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 60000,
    });
    console.log("  Nia skill installed successfully");
    return true;
  } catch (err) {
    console.error("  Failed to install nia-skill:", err);
    console.log(
      "  You can install it manually: npx skills add nozomio-labs/nia-skill",
    );
    return false;
  }
}

export function removeSkill(): boolean {
  try {
    console.log(`  Removing nia skill...`);
    execSync(`npx skills remove ${NIA_SKILL_NAME} -g -a opencode -y`, {
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 30000,
    });
    console.log("  Nia skill removed successfully");
    return true;
  } catch (err) {
    console.log("  No nia skill found or already removed");
    return true;
  }
}
