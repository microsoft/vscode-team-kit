//
// Ensures `npm install` has been run in the team-kit root.
//
// Usage in a script entry point:
//
//   import install from '<team-kit>/common/install-if-necessary.mts';
//   install().then(() => import('./impl.mts'));
//

import { execSync } from "child_process";
import { existsSync, statSync, utimesSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const packageJson = resolve(root, "package.json");
const nodeModules = resolve(root, "node_modules");
const lockfile = resolve(root, "package-lock.json");

function needsInstall(): boolean {
  if (!existsSync(nodeModules)) {
    return true;
  }

  const nmStat = statSync(nodeModules);
  const pkgStat = statSync(packageJson);

  if (pkgStat.mtimeMs > nmStat.mtimeMs) {
    return true;
  }

  if (existsSync(lockfile) && statSync(lockfile).mtimeMs > nmStat.mtimeMs) {
    return true;
  }

  return false;
}

export default async function install(): Promise<void> {
  if (needsInstall()) {
    execSync("npm install", { cwd: root, stdio: "inherit" });
    // Touch node_modules so future mtime checks are accurate
    const now = new Date();
    utimesSync(nodeModules, now, now);
  }
}
