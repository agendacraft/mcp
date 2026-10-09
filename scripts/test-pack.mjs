import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const work = path.resolve(".cache/pack-smoke");
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
run("npm", ["pack", "--pack-destination", work]);
const archive = (await readdir(work)).find((name) => name.endsWith(".tgz"));
assert.ok(archive, "npm pack must produce an archive");
const tarball = path.join(work, archive);
const files = run("tar", ["-tzf", tarball]).trim().split("\n").sort();
const allowed = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "dist/index.js",
  "dist/index.js.LEGAL.txt",
  "package.json",
]
  .map((name) => `package/${name}`)
  .sort();
assert.deepEqual(files, allowed, "packed file allowlist");
process.stdout.write(`Tarball files:\n${files.join("\n")}\n`);
const extracted = path.join(work, "extracted");
await mkdir(extracted);
run("tar", ["-xzf", tarball, "-C", extracted]);
for (const file of files) {
  const text = await readFile(path.join(extracted, file), "utf8");
  assert.ok(
    !/sourceMappingURL|\/Users\/|\/home\/runner\/work\/|\.treehouse\/|Developer\/firstmate|apps\/backend|packages\/api-client|workspace:\*/.test(
      text
    ),
    `private paths or source maps in ${file}`
  );
}
const installed = path.join(work, "installed");
await mkdir(installed);
run("npm", [
  "install",
  "--prefix",
  installed,
  "--omit=dev",
  "--ignore-scripts",
  "--package-lock=false",
  "--no-audit",
  "--no-fund",
  tarball,
]);
assert.deepEqual(
  (await readdir(path.join(installed, "node_modules"))).filter((name) => !name.startsWith(".")),
  ["@agendacraft"],
  "no installed runtime dependencies"
);
const executable = path.join(installed, "node_modules/.bin/agenda-mcp");
const tokenPath = path.join(work, "fixture-token.json");
const grantedScopes = "agenda:read profile:read";
await writeFile(
  tokenPath,
  JSON.stringify({
    accessToken: "fixture-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3_600_000,
    scope: grantedScopes,
  }),
  { mode: 0o600 }
);

const upstream = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/.well-known/oauth-authorization-server") {
    res.end(
      JSON.stringify({
        issuer: "https://auth.example",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        introspection_endpoint: "https://auth.example/introspect",
        response_types_supported: ["code"],
      })
    );
  } else if (req.url === "/o/introspect/") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const token = new URLSearchParams(body).get("token");
      res.end(
        JSON.stringify({
          active: token === "fixture-access-token",
          client_id: "fixture-public-client",
          exp: Math.floor(Date.now() / 1000) + 3600,
          scope: grantedScopes,
          aud: "https://mcp.example/mcp",
        })
      );
    });
  } else if (req.headers.authorization !== "Bearer fixture-access-token") {
    res.statusCode = 401;
    res.end(JSON.stringify({ detail: "Fixture authorization required" }));
  } else if (req.url === "/api/v1/auth/me") {
    res.end(
      JSON.stringify({
        id: "fixture-user",
        username: "demo",
        email: "demo@example.invalid",
        given_name: "Demo",
        family_name: "User",
        settings: { timezone: "UTC", timeFormat: "24h" },
      })
    );
  } else if (req.url?.startsWith("/api/v1/tasks/")) {
    res.end("[]");
  } else {
    res.statusCode = 404;
    res.end("{}");
  }
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
const env = { ...process.env, AGENDA_SERVICE_URL: upstreamUrl, AGENDA_MCP_TOKEN_PATH: tokenPath };
let httpProcess;
let httpErrors = "";
try {
  const stdio = new StdioClientTransport({
    command: executable,
    args: ["stdio"],
    cwd: installed,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "pack-smoke", version: "1.0.0" });
  try {
    await client.connect(stdio);
    assert.equal(client.getServerVersion().version, manifest.version);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("whoami"));
    assert.ok(!names.includes("create_task"), "read-only scopes hide writes");
    const result = await client.callTool({ name: "whoami", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.id, "fixture-user");
    process.stdout.write(
      "Packed executable: stdio initialization, version, tool scopes, and profile passed.\n"
    );
  } finally {
    await client.close();
    await stdio.close();
  }

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  httpProcess = spawn(executable, ["http"], {
    cwd: installed,
    env: {
      ...env,
      AGENDA_MCP_HOST: "127.0.0.1",
      AGENDA_MCP_PORT: String(port),
      AGENDA_MCP_PUBLIC_URL: "https://mcp.example",
      AGENDA_MCP_RESOURCE: "https://mcp.example/mcp",
      AGENDA_MCP_ALLOWED_HOSTS: "127.0.0.1",
      AGENDA_MCP_ALLOWED_ORIGINS: "https://host.example",
      AGENDA_MCP_INTROSPECTION_CLIENT_ID: "fixture-introspection-client",
      AGENDA_MCP_INTROSPECTION_CLIENT_SECRET: "fixture-introspection-secret",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  httpProcess.stderr.on("data", (chunk) => {
    httpErrors += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (httpProcess.exitCode !== null) throw new Error(`Packed HTTP process exited: ${httpErrors}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        assert.deepEqual(await response.json(), { ok: true });
        healthy = true;
        break;
      }
    } catch {
      /* The process may still be starting. */
    }
    await delay(50);
  }
  assert.ok(healthy, `Packed HTTP health timeout: ${httpErrors}`);
  assert.equal((await fetch(`${base}/mcp`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/mcp`, {
        headers: { Authorization: "Bearer fixture-inactive-token" },
      })
    ).status,
    401
  );
  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).resource, "https://mcp.example/mcp");
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer fixture-access-token" } },
  });
  const httpClient = new Client({ name: "pack-http-smoke", version: "1.0.0" });
  try {
    await httpClient.connect(transport);
    const names = (await httpClient.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("whoami"));
    assert.ok(!names.includes("create_task"));
    const result = await httpClient.callTool({ name: "whoami", arguments: {} });
    assert.equal(result.structuredContent.id, "fixture-user");
    process.stdout.write(
      "Packed executable: HTTP health, discovery, inactive-token denial, introspection, and scoped profile passed.\n"
    );
  } finally {
    await httpClient.close();
    await transport.close();
  }
} finally {
  if (httpProcess && httpProcess.exitCode === null) {
    httpProcess.kill("SIGTERM");
    await once(httpProcess, "exit");
  }
  await new Promise((resolve) => upstream.close(resolve));
}
