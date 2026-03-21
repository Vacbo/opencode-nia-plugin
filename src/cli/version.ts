import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS_MIN_VERSION } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getVersion(): string {
  const packageJsonPath = join(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  return pkg.version;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function getOpencodeVersion(): string | null {
  try {
    const output = execSync("opencode --version", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const match = output.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function supportsSkills(version: string | null): boolean {
  if (!version) return false;
  return compareVersions(version, SKILLS_MIN_VERSION) >= 0;
}
