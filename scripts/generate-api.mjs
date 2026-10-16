import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const version = "7.25.0";
const checksum = "41ce4f6b07f196676439d710759fa1ced7a08066d06ff1bf314681470289efae";
const jar = `.cache/openapi-generator-cli-${version}.jar`;
await mkdir(".cache", { recursive: true });
let bytes;
try {
  bytes = await readFile(jar);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const response = await fetch(
    `https://repo.maven.apache.org/maven2/org/openapitools/openapi-generator-cli/${version}/openapi-generator-cli-${version}.jar`,
    { signal: AbortSignal.timeout(120_000) }
  );
  if (!response.ok) throw new Error(`Generator download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== checksum) {
  throw new Error("OpenAPI Generator checksum mismatch");
}
await writeFile(jar, bytes);
await rm(".cache/generated-api", { recursive: true, force: true });
const result = spawnSync(
  "java",
  [
    "-jar",
    jar,
    "generate",
    "-i",
    "openapi/schema.json",
    "-g",
    "typescript-fetch",
    "-o",
    ".cache/generated-api",
    "-c",
    "openapi/config.json",
    "-t",
    "openapi/templates",
    "--global-property",
    "apis,models,supportingFiles=runtime.ts:index.ts:apis/index.ts:models/index.ts,apiDocs=false,modelDocs=false,apiTests=false,modelTests=false",
  ],
  { stdio: "inherit" }
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await rm("src/api", { recursive: true, force: true });
await cp(".cache/generated-api/src", "src/api", { recursive: true });
