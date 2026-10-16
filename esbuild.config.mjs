import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir(".cache", { recursive: true });

const requireShim = [
  "#!/usr/bin/env node",
  "import { createRequire as __nodeCreateRequire } from 'node:module';",
  "import { fileURLToPath as __nodeFileURLToPath } from 'node:url';",
  "import { dirname as __nodeDirname } from 'node:path';",
  "const require = __nodeCreateRequire(import.meta.url);",
  "const __filename = __nodeFileURLToPath(import.meta.url);",
  "const __dirname = __nodeDirname(__filename);",
].join("\n");

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: false,
  metafile: true,
  legalComments: "external",
  banner: { js: requireShim },
  logLevel: "info",
});

await writeFile(".cache/bundle-meta.json", JSON.stringify(result.metafile, null, 2));
await import("./scripts/third-party-notices.mjs");
