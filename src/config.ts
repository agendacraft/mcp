/**
 * Typed, fail-fast configuration for the AgendaCraft MCP server.
 *
 * Configuration is read from the environment and validated eagerly so the
 * server refuses to start with missing or malformed settings (repo rule:
 * validate required environment variables with typed loaders and fail fast at
 * startup).
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_OAUTH_CLIENT_ID = "agendacraft-mcp";
export const DEFAULT_OAUTH_SCOPES = "agenda:read agenda:write profile:read";
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30;

const METADATA_PATH = "/.well-known/oauth-authorization-server";

type Env = Record<string, string | undefined>;

/** Raised when required MCP configuration is missing or invalid. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface Settings {
  readonly agendaServiceUrl: string;
  readonly oauthClientId: string;
  readonly oauthScopes: string;
  readonly requestTimeoutMs: number;
  readonly tokenPath: string;
}

export interface HostedSettings extends Settings {
  readonly authorizationServerUrl: string;
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly resource: string;
  readonly introspectionClientId: string;
  readonly introspectionClientSecret: string;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
}

/** The OAuth authorization-server discovery URL (RFC 8414). */
export function metadataUrl(settings: Settings): string {
  return `${settings.agendaServiceUrl}${METADATA_PATH}`;
}

function requireBaseUrl(value: string, variable: string): string {
  const href = new URL(value).href;
  if (href.includes("?") || href.includes("#")) {
    throw new ConfigError(`${variable} must not contain a query or fragment.`);
  }
  return value;
}

function requireServiceUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new ConfigError("AGENDA_SERVICE_URL is required and must be a non-empty URL.");
  }
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    throw new ConfigError(
      `AGENDA_SERVICE_URL must start with http:// or https:// (got ${JSON.stringify(value)}).`
    );
  }
  try {
    new URL(cleaned);
  } catch {
    throw new ConfigError(
      `AGENDA_SERVICE_URL must be a valid absolute URL (got ${JSON.stringify(value)}).`
    );
  }
  return requireBaseUrl(cleaned, "AGENDA_SERVICE_URL");
}

/**
 * Trim an OAuth override and fall back to `fallback` when it is blank.
 *
 * Treats whitespace-only env values (e.g. `"   "`) as unset so they cannot slip
 * through startup validation and surface as opaque failures during login.
 */
function oauthOverride(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function parseTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    throw new ConfigError(
      `AGENDA_MCP_REQUEST_TIMEOUT must be a number (got ${JSON.stringify(value)}).`
    );
  }
  if (seconds <= 0) {
    throw new ConfigError(
      `AGENDA_MCP_REQUEST_TIMEOUT must be positive (got ${JSON.stringify(value)}).`
    );
  }
  const timeoutMs = seconds * 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs > 2_147_483_647) {
    throw new ConfigError(
      "AGENDA_MCP_REQUEST_TIMEOUT must resolve to 1..2147483647 whole milliseconds."
    );
  }
  return timeoutMs;
}

function optionalUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  const cleaned = raw.replace(/\/+$/, "");
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    throw new ConfigError(`Hosted MCP URL must start with http:// or https:// (got ${raw}).`);
  }
  try {
    new URL(cleaned);
  } catch {
    throw new ConfigError(`Hosted MCP URL must be a valid absolute URL (got ${raw}).`);
  }
  return cleaned;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 8001;
  }
  if (value.trim() === "") {
    throw new ConfigError("AGENDA_MCP_PORT must not be empty.");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`AGENDA_MCP_PORT must be an integer TCP port (got ${value}).`);
  }
  return port;
}

function requiredHostedSecret(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new ConfigError(`${key} is required for hosted HTTP mode.`);
  }
  return value;
}

function parseAllowedHosts(value: string | undefined, publicUrl: string): readonly string[] {
  const configured = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured !== undefined && configured.length > 0) {
    return configured.map((item) => {
      try {
        return new URL(item.includes("://") ? item : `http://${item}`).hostname;
      } catch {
        return item;
      }
    });
  }
  return [new URL(publicUrl).hostname];
}

function parseAllowedOrigins(value: string | undefined, resource: string): readonly string[] {
  const resourceOrigin = new URL(resource).origin;
  const rawOrigins =
    value === undefined || value.trim() === "" ? [resourceOrigin] : value.split(",");
  const origins = new Set<string>([resourceOrigin]);
  for (const rawOrigin of rawOrigins) {
    const trimmed = rawOrigin.trim();
    if (trimmed === "") {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ConfigError(`AGENDA_MCP_ALLOWED_ORIGINS contains an invalid origin: ${trimmed}`);
    }
    if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      throw new ConfigError(
        `AGENDA_MCP_ALLOWED_ORIGINS entries must be origins only (got ${trimmed}).`
      );
    }
    origins.add(parsed.origin);
  }
  return [...origins];
}

function defaultTokenPath(env: Env): string {
  const configHome = env["XDG_CONFIG_HOME"];
  const base = configHome && configHome.trim() !== "" ? configHome : join(homedir(), ".config");
  return join(base, "agenda-mcp", "token.json");
}

/**
 * Resolve the cached-token path from `env` without full validation.
 *
 * Used by `logout`, which only needs the token location and must work even when
 * `AGENDA_SERVICE_URL` is unset (full `loadSettings` would reject it).
 */
export function resolveTokenPath(env: Env = process.env): string {
  const explicit = env["AGENDA_MCP_TOKEN_PATH"];
  return explicit && explicit.trim() !== "" ? explicit : defaultTokenPath(env);
}

/** Build {@link Settings} from `env` (defaults to `process.env`). */
export function loadSettings(env: Env = process.env): Settings {
  return {
    agendaServiceUrl: requireServiceUrl(env["AGENDA_SERVICE_URL"]),
    oauthClientId: oauthOverride(env["AGENDA_MCP_OAUTH_CLIENT_ID"], DEFAULT_OAUTH_CLIENT_ID),
    oauthScopes: oauthOverride(env["AGENDA_MCP_OAUTH_SCOPES"], DEFAULT_OAUTH_SCOPES),
    requestTimeoutMs: parseTimeoutMs(env["AGENDA_MCP_REQUEST_TIMEOUT"]),
    tokenPath: resolveTokenPath(env),
  };
}

export function loadHostedSettings(env: Env = process.env): HostedSettings {
  const settings = loadSettings(env);
  const host = env["AGENDA_MCP_HOST"]?.trim() || "127.0.0.1";
  const port = parsePort(env["AGENDA_MCP_PORT"] ?? env["PORT"]);
  const publicUrl = requireBaseUrl(
    optionalUrl(
      env["AGENDA_MCP_PUBLIC_URL"],
      `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`
    ),
    "AGENDA_MCP_PUBLIC_URL"
  );
  const resource = optionalUrl(env["AGENDA_MCP_RESOURCE"], `${publicUrl}/mcp`);
  const authorizationServerUrl = requireBaseUrl(
    optionalUrl(env["AGENDA_MCP_AUTHORIZATION_SERVER_URL"], settings.agendaServiceUrl),
    "AGENDA_MCP_AUTHORIZATION_SERVER_URL"
  );
  return {
    ...settings,
    authorizationServerUrl,
    host,
    port,
    publicUrl,
    resource,
    introspectionClientId: requiredHostedSecret(env, "AGENDA_MCP_INTROSPECTION_CLIENT_ID"),
    introspectionClientSecret: requiredHostedSecret(env, "AGENDA_MCP_INTROSPECTION_CLIENT_SECRET"),
    allowedHosts: parseAllowedHosts(env["AGENDA_MCP_ALLOWED_HOSTS"], publicUrl),
    allowedOrigins: parseAllowedOrigins(env["AGENDA_MCP_ALLOWED_ORIGINS"], resource),
  };
}
