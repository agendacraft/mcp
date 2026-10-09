/**
 * CLI entrypoint: `agenda-mcp [serve|stdio|http|login|logout]`.
 *
 * `serve` (the default) and `stdio` run the MCP server over stdio. `http`
 * runs the hosted Streamable HTTP resource server. `login` performs the
 * one-time browser OAuth flow; `logout` clears the cached tokens.
 * Human-facing output goes to stderr so it never corrupts the stdio MCP channel
 * on stdout.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createAgendaClient } from "./apiClient";
import {
  loadHostedSettings,
  loadSettings,
  metadataUrl,
  resolveTokenPath,
  type HostedSettings,
  type Settings,
} from "./config";
import { serveHosted } from "./hostedTransport";
import {
  fetchMetadata,
  isTokenExpired,
  refreshAccessToken,
  runLoginFlow,
  TokenStore,
  tokenBundleWithFallbackScope,
  type TokenBundle,
} from "./oauth";
import { createMcpServer } from "./server";

/** Raised when the user must (re-)authenticate before the server can run. */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export interface TokenProviderDeps {
  readonly store?: TokenStore;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/**
 * Build the access-token provider the API client calls before each request.
 *
 * It returns the cached access token, silently refreshing it when expired. If
 * there is no cached token (or it is expired with no refresh token), it throws
 * {@link AuthRequiredError} directing the user to run `agenda-mcp login`.
 */
export function buildAccessTokenProvider(
  settings: Settings,
  deps: TokenProviderDeps = {}
): () => Promise<string> {
  const store = deps.store ?? new TokenStore(settings.tokenPath);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  return async () => {
    let bundle = await store.load();
    if (bundle === null) {
      throw new AuthRequiredError("No saved credentials. Run `agenda-mcp login` first.");
    }
    if (isTokenExpired(bundle, now())) {
      if (bundle.refreshToken === null) {
        throw new AuthRequiredError("Session expired. Run `agenda-mcp login` again.");
      }
      const metadata = await fetchMetadata(metadataUrl(settings), {
        fetchImpl,
        timeoutMs: settings.requestTimeoutMs,
      });
      bundle = tokenBundleWithFallbackScope(
        await refreshAccessToken({
          tokenEndpoint: metadata.tokenEndpoint,
          clientId: settings.oauthClientId,
          refreshToken: bundle.refreshToken,
          fetchImpl,
          timeoutMs: settings.requestTimeoutMs,
          nowMs: now(),
        }),
        bundle.scope
      );
      await store.save(bundle);
    }
    return bundle.accessToken;
  };
}

function scopeListFromString(scope: string): readonly string[] {
  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Return scopes persisted with the cached local token. */
export function grantedScopesFromCachedToken(
  tokenBundle: TokenBundle | null
): readonly string[] | undefined {
  if (tokenBundle === null) {
    return undefined;
  }
  if (tokenBundle.scope === null) {
    throw new AuthRequiredError(
      "Cached credentials are missing granted OAuth scopes. Run `agenda-mcp login` again."
    );
  }
  return scopeListFromString(tokenBundle.scope);
}

async function serveStdio(settings: Settings): Promise<void> {
  const store = new TokenStore(settings.tokenPath);
  const accessTokenProvider = buildAccessTokenProvider(settings, { store });
  const tokenBundle = await store.load();
  const client = createAgendaClient({
    baseUrl: settings.agendaServiceUrl,
    accessTokenProvider,
    requestTimeoutMs: settings.requestTimeoutMs,
  });
  const grantedScopes = grantedScopesFromCachedToken(tokenBundle);
  const server = createMcpServer(
    client,
    grantedScopes === undefined ? {} : { grantedScopes, includeSyncTools: true }
  );
  await server.connect(new StdioServerTransport());
}

async function runHttp(settings: HostedSettings): Promise<void> {
  await serveHosted(settings);
}

async function runLogin(settings: Settings): Promise<void> {
  const bundle = await runLoginFlow(settings);
  process.stderr.write(`Logged in. Granted scopes: ${bundle.scope ?? settings.oauthScopes}\n`);
}

async function runLogout(env: Record<string, string | undefined>): Promise<void> {
  await new TokenStore(resolveTokenPath(env)).clear();
  process.stderr.write("Logged out; cached credentials cleared.\n");
}

export interface CliDeps {
  readonly env: Record<string, string | undefined>;
  readonly serve: (settings: Settings) => Promise<void>;
  readonly http: (settings: HostedSettings) => Promise<void>;
  readonly login: (settings: Settings) => Promise<void>;
  readonly logout: (env: Record<string, string | undefined>) => Promise<void>;
  readonly stderr: (message: string) => void;
}

const KNOWN_SERVE_COMMANDS = new Set(["serve", "stdio"]);

export async function main(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = {
    env: overrides.env ?? process.env,
    serve: overrides.serve ?? serveStdio,
    http: overrides.http ?? runHttp,
    login: overrides.login ?? runLogin,
    logout: overrides.logout ?? runLogout,
    stderr: overrides.stderr ?? ((message) => process.stderr.write(message)),
  };

  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const command = args[0] ?? "serve";

  // `logout` must work even when AGENDA_SERVICE_URL is unset, so dispatch it
  // before the validating loadSettings() call.
  if (command === "logout") {
    await deps.logout(deps.env);
    return 0;
  }

  if (command !== "login" && command !== "http" && !KNOWN_SERVE_COMMANDS.has(command)) {
    deps.stderr(`Unknown command: ${command}. Use one of: serve, http, login, logout.\n`);
    return 2;
  }

  if (command === "http") {
    await deps.http(loadHostedSettings(deps.env));
    return 0;
  }

  const settings = loadSettings(deps.env);
  if (command === "login") {
    await deps.login(settings);
    return 0;
  }
  await deps.serve(settings);
  return 0;
}

export function isDirectCliInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}

const invokedDirectly = isDirectCliInvocation(import.meta.url, process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
