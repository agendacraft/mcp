import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export class HostedAuthError extends Error {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    message: string,
    status: number = 401,
    headers: Readonly<Record<string, string>> = {}
  ) {
    super(message);
    this.name = "HostedAuthError";
    this.status = status;
    this.headers = headers;
  }
}

export interface IntrospectionVerifierOptions {
  readonly introspectionEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly resource: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

type JsonObject = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  return [];
}

function extractAudience(payload: JsonObject): string[] {
  return [
    ...asStringArray(payload["aud"]),
    ...asStringArray(payload["audience"]),
    ...asStringArray(payload["resource"]),
    ...asStringArray(payload["resources"]),
  ];
}

function stripHash(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.href.replace(/\/+$/, "");
}

function validateAudience(payload: JsonObject, expectedResource: string): URL {
  const expected = stripHash(expectedResource);
  const audiences = extractAudience(payload);
  if (audiences.length === 0) {
    return new URL(expected);
  }
  const matched = audiences.find((audience) => {
    try {
      return stripHash(audience) === expected;
    } catch {
      return false;
    }
  });
  if (matched === undefined) {
    throw new HostedAuthError("OAuth token is not audience-bound to this MCP resource.", 403);
  }
  return new URL(matched);
}

function introspectionAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function introspectBearerToken(
  token: string,
  options: IntrospectionVerifierOptions
): Promise<AuthInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({ token, resource: options.resource });
  const timeoutSignal =
    options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
  const init: RequestInit = {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: introspectionAuthHeader(options.clientId, options.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  };
  if (timeoutSignal !== undefined) {
    init.signal = timeoutSignal;
  }
  let response: Response;
  try {
    response = await fetchImpl(options.introspectionEndpoint, init);
  } catch {
    throw new HostedAuthError("Token introspection temporarily unavailable.", 503);
  }
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new HostedAuthError("Token introspection credentials were rejected.", 503);
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = response.headers.get("Retry-After");
      throw new HostedAuthError(
        `Token introspection temporarily unavailable (${response.status}).`,
        503,
        retryAfter === null ? {} : { "Retry-After": retryAfter }
      );
    }
    throw new HostedAuthError(`Token introspection returned ${response.status}.`);
  }

  let payload: JsonObject;
  try {
    payload = (await response.json()) as JsonObject;
  } catch {
    throw new HostedAuthError("Token introspection returned malformed JSON.", 503);
  }
  if (payload["active"] !== true) {
    throw new HostedAuthError("OAuth token is inactive.");
  }
  const clientId = asString(payload["client_id"]);
  if (clientId === null) {
    throw new HostedAuthError("Token introspection response is missing client_id.");
  }
  const resource = validateAudience(payload, options.resource);
  const exp = typeof payload["exp"] === "number" ? payload["exp"] : undefined;
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  if (exp !== undefined && exp <= nowSeconds) {
    throw new HostedAuthError("OAuth token is expired.");
  }
  const authInfo: AuthInfo = {
    token,
    clientId,
    scopes: asStringArray(payload["scope"]),
    resource,
    extra: {
      username: asString(payload["username"]),
    },
  };
  if (exp !== undefined) {
    authInfo.expiresAt = exp;
  }
  return authInfo;
}

export function parseBearerAuthHeader(header: string | undefined): string {
  if (header === undefined) {
    throw new HostedAuthError("Missing bearer token.");
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    throw new HostedAuthError("Expected Authorization: Bearer <token>.");
  }
  return token;
}

export function requireScopes(authInfo: AuthInfo, scopes: readonly string[]): void {
  const granted = new Set(authInfo.scopes);
  const missing = scopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new HostedAuthError(
      `OAuth token is missing required scope(s): ${missing.join(", ")}.`,
      403
    );
  }
}
