import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (name === "src/api") continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(name)));
    else if (/\.(ts|mjs)$/.test(name)) files.push(name);
  }
  return files;
}
const files = [
  ...(await sourceFiles("src")),
  ...(await sourceFiles("scripts")),
  "esbuild.config.mjs",
  "vitest.config.mts",
];
const result = spawnSync("oxlint", ["--no-ignore", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
