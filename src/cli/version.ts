import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getVersion(): string {
  const packageJsonPath = join(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  return pkg.version;
}
