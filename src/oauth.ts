/**
 * OAuth Authorization Code + PKCE login for the local (stdio) MCP server.
 *
 * The server performs a one-time browser-based Authorization Code + PKCE flow
 * against AgendaCraft using the public `agendacraft-mcp` client and RFC 8414
 * discovery metadata, caches the resulting
 * tokens, and refreshes them silently. This mirrors how CLI tools such as
 * `gh auth login` authenticate: the MCP host speaks plain MCP over stdio and
 * never touches OAuth.
 *
 * Hosted MCP OAuth uses the authorization server's Dynamic Client Registration
 * metadata path; this local stdio helper intentionally uses the configured
 * static client ID fallback.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";

import { lock } from "proper-lockfile";

import { metadataUrl, type Settings } from "./config";

import { parseRetryAfterMs } from "./retryAfter";

const TOKEN_EXPIRY_LEEWAY_MS = 60_000;
const LOGOUT_LOCK_TIMEOUT_MS = 420_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

const CALLBACK_HTML =
  "<html><body><h3>AgendaCraft authentication complete.</h3>" +
  "<p>You can close this tab and return to your terminal.</p></body></html>";

type JsonObject = Record<string, unknown>;

function stringField(data: JsonObject, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

function numberField(data: JsonObject, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

/** Raised when the OAuth login or token exchange fails. */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export interface AuthServerMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

export interface TokenBundle {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Absolute expiry as an epoch timestamp in milliseconds, or null if unbounded. */
  readonly expiresAt: number | null;
  readonly scope: string | null;
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** Return a `(verifier, challenge)` pair for PKCE S256. */
export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

export function requireOAuthMetadataUrl(
  value: unknown,
  field: string,
  options: { readonly allowLoopbackHttp?: boolean } = {}
): string {
  if (typeof value !== "string" || value === "") {
    throw new OAuthError(`OAuth metadata is missing a valid ${field}.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError(`OAuth metadata ${field} must be an absolute URL.`);
  }
  const loopbackHttp =
    options.allowLoopbackHttp === true &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !loopbackHttp) ||
    url.username ||
    url.password ||
    url.href.includes("#")
  ) {
    throw new OAuthError(
      `OAuth metadata ${field} must use HTTPS without credentials or fragments.`
    );
  }
  return value;
}

export function metadataFromPayload(payload: JsonObject): AuthServerMetadata {
  const localOptions = { allowLoopbackHttp: true };
  return {
    issuer:
      payload["issuer"] === undefined
        ? ""
        : requireOAuthMetadataUrl(payload["issuer"], "issuer", localOptions),
    authorizationEndpoint: requireOAuthMetadataUrl(
      payload["authorization_endpoint"],
      "authorization_endpoint",
      localOptions
    ),
    tokenEndpoint: requireOAuthMetadataUrl(
      payload["token_endpoint"],
      "token_endpoint",
      localOptions
    ),
  };
}

export interface AuthorizationUrlParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  readonly codeChallenge: string;
}

export function buildAuthorizationUrl(
  metadata: AuthServerMetadata,
  params: AuthorizationUrlParams
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  const endpoint = new URL(metadata.authorizationEndpoint);
  for (const [name, value] of query) endpoint.searchParams.set(name, value);
  return endpoint.toString();
}

export function tokenBundleFromResponse(payload: JsonObject, nowMs: number): TokenBundle {
  const accessToken = payload["access_token"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new OAuthError("Token response is missing 'access_token'.");
  }
  const expiresInRaw = payload["expires_in"];
  let expiresAt: number | null = null;
  if (expiresInRaw != null) {
    const seconds = Number(expiresInRaw);
    expiresAt = Number.isFinite(seconds) ? nowMs + seconds * 1000 : null;
  }
  const refreshToken = payload["refresh_token"];
  const scope = payload["scope"];
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" ? refreshToken : null,
    expiresAt,
    scope: typeof scope === "string" ? scope : null,
  };
}

export function tokenBundleWithFallbackScope(
  bundle: TokenBundle,
  fallbackScope: string | null
): TokenBundle {
  return bundle.scope === null ? { ...bundle, scope: fallbackScope } : bundle;
}

export function isTokenExpired(
  bundle: TokenBundle,
  nowMs: number,
  leewayMs: number = TOKEN_EXPIRY_LEEWAY_MS
): boolean {
  if (bundle.expiresAt === null) {
    return false;
  }
  return nowMs >= bundle.expiresAt - leewayMs;
}

interface FetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxRetries?: number;
  readonly maxRetryDelayMs?: number;
}

interface BrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Issue `fetchImpl(url, init)` and retry `429` responses with bounded
 * `Retry-After` backoff, as required for the auth path (repo rule: outbound
 * calls handle `429` / `Retry-After`).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchOptions
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const initForAttempt = (): RequestInit => {
    if (options.timeoutMs === undefined) {
      return init;
    }
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    return {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal,
    };
  };

  let response = await fetchImpl(url, initForAttempt());
  let attempt = 0;
  while (response.status === 429 && attempt < maxRetries) {
    const delayMs = Math.min(
      parseRetryAfterMs(response.headers.get("retry-after"), maxRetryDelayMs, Date.now()),
      maxRetryDelayMs
    );
    void response.body?.cancel().catch(() => undefined);
    await sleep(delayMs);
    attempt += 1;
    response = await fetchImpl(url, initForAttempt());
  }
  return response;
}

export async function fetchMetadata(
  url: string,
  options: FetchOptions = {}
): Promise<AuthServerMetadata> {
  const init: RequestInit = { method: "GET", headers: { Accept: "application/json" } };
  if (options.signal) {
    init.signal = options.signal;
  }
  const response = await fetchWithRetry(url, init, options);
  if (response.status !== 200) {
    throw new OAuthError(`Discovery endpoint returned ${response.status} for ${url}.`);
  }
  return metadataFromPayload((await response.json()) as JsonObject);
}

const OAUTH_ERROR_CODES = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
]);

/** Provider descriptions may echo credentials; retain only recognized protocol codes. */
async function readOAuthErrorCode(response: Response): Promise<string | undefined> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.body?.getReader();
    if (!reader) return undefined;
    const bodyReader = reader;
    const read = async (): Promise<string | undefined> => {
      const buffer = new Uint8Array(4_096);
      let size = 0;
      while (true) {
        const { done, value } = await bodyReader.read();
        if (done) break;
        if (value.byteLength > buffer.byteLength - size) return undefined;
        buffer.set(value, size);
        size += value.byteLength;
      }
      const payload: unknown = JSON.parse(new TextDecoder().decode(buffer.subarray(0, size)));
      if (payload === null || typeof payload !== "object") return undefined;
      const code = (payload as JsonObject)["error"];
      return typeof code === "string" && OAUTH_ERROR_CODES.has(code) ? code : undefined;
    };
    return await Promise.race([
      read(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 3_000);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader?.cancel().catch(() => undefined);
  }
}

async function requestToken(
  tokenEndpoint: string,
  data: Record<string, string>,
  options: FetchOptions & { nowMs: number }
): Promise<TokenBundle> {
  const init: RequestInit = {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  };
  if (options.signal) {
    init.signal = options.signal;
  }
  const response = await fetchWithRetry(tokenEndpoint, init, options);
  if (response.status !== 200) {
    const code = await readOAuthErrorCode(response);
    throw new OAuthError(`Token endpoint returned ${response.status}${code ? `: ${code}` : "."}`);
  }
  return tokenBundleFromResponse((await response.json()) as JsonObject, options.nowMs);
}

export interface ExchangeCodeOptions extends FetchOptions {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly nowMs: number;
}

export function exchangeCode(options: ExchangeCodeOptions): Promise<TokenBundle> {
  return requestToken(
    options.tokenEndpoint,
    {
      grant_type: "authorization_code",
      client_id: options.clientId,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    },
    options
  );
}

export interface RefreshTokenOptions extends FetchOptions {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly refreshToken: string;
  readonly nowMs: number;
}

export async function refreshAccessToken(options: RefreshTokenOptions): Promise<TokenBundle> {
  const bundle = await requestToken(
    options.tokenEndpoint,
    {
      grant_type: "refresh_token",
      client_id: options.clientId,
      refresh_token: options.refreshToken,
    },
    options
  );
  return { ...bundle, refreshToken: bundle.refreshToken ?? options.refreshToken };
}

/** Persists the token bundle to an owner-only JSON file. */
export class TokenStore {
  constructor(private readonly path: string) {}

  async load(): Promise<TokenBundle | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    let data: JsonObject;
    try {
      data = JSON.parse(raw) as JsonObject;
    } catch {
      // A corrupted token file (partial write, tampering) is treated as "no
      // cached token" so callers fall back to a fresh `agenda-mcp login`
      // instead of surfacing an opaque SyntaxError.
      return null;
    }
    const accessToken = stringField(data, "accessToken") ?? stringField(data, "access_token");
    if (accessToken === null) {
      return null;
    }
    return {
      accessToken,
      refreshToken: stringField(data, "refreshToken") ?? stringField(data, "refresh_token"),
      expiresAt: tokenExpiryField(data),
      scope: stringField(data, "scope"),
    };
  }

  async save(bundle: TokenBundle): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const destination = await realpath(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return resolve(this.path);
    });
    const temporaryPath = `${destination}.${randomBytes(16).toString("hex")}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(bundle), { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, destination);
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async withRefreshLock<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let release: (() => Promise<void>) | undefined;
    while (release === undefined) {
      try {
        release = await lock(this.path, { stale: 30_000, update: 10_000 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || Date.now() >= deadline)
          throw error;
        await defaultSleep(Math.min(100, Math.max(0, deadline - Date.now())));
      }
    }
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  async clear(): Promise<void> {
    try {
      await this.withRefreshLock(() => unlink(this.path), LOGOUT_LOCK_TIMEOUT_MS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function tokenExpiryField(data: JsonObject): number | null {
  const expiresAt = numberField(data, "expiresAt");
  if (expiresAt !== null) {
    return expiresAt;
  }
  const legacyExpiresAt = numberField(data, "expires_at");
  if (legacyExpiresAt === null) {
    return null;
  }
  return legacyExpiresAt < 10_000_000_000 ? legacyExpiresAt * 1000 : legacyExpiresAt;
}

function browserCommandForUrl(url: string): BrowserCommand {
  const { platform } = process;
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    // `cmd /c start "" <url>` mis-parses the URL: cmd.exe treats the unescaped
    // `&` between query params as a command separator, so only the prefix up to
    // the first `&` opens. rundll32 is spawned directly (no shell), so it
    // receives the full URL as a single argument.
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export function openSystemBrowser(
  url: string,
  browserCommand: BrowserCommand = browserCommandForUrl(url)
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(browserCommand.command, browserCommand.args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = code === null ? `signal ${signal ?? "unknown"}` : `status ${code}`;
      reject(new Error(`Browser command exited with ${reason}.`));
    });
  });
}

async function launchBrowserOrHint(
  openBrowser: (url: string) => void | Promise<void>,
  authUrl: string
): Promise<void> {
  try {
    await openBrowser(authUrl);
  } catch {
    process.stderr.write(`Could not open a browser. Visit this URL to authorize:\n${authUrl}\n`);
  }
}

export interface LoginDeps {
  readonly fetchImpl?: typeof fetch;
  readonly openBrowser?: (url: string) => void | Promise<void>;
  readonly now?: () => number;
}

/**
 * Run the interactive Authorization Code + PKCE login and persist the tokens.
 *
 * Binds a transient loopback listener on `127.0.0.1` (RFC 8252; DOT matches
 * loopback ports port-agnostically), opens the system browser to the consent
 * screen, then exchanges the returned code for tokens.
 */
export async function runLoginFlow(settings: Settings, deps: LoginDeps = {}): Promise<TokenBundle> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const openBrowser = deps.openBrowser ?? openSystemBrowser;
  const now = deps.now ?? Date.now;

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const callbackParams = new Promise<URLSearchParams>((resolve) => {
    server.on("request", (req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_HTML);
      resolve(requestUrl.searchParams);
    });
  });

  try {
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const metadata = await fetchMetadata(metadataUrl(settings), {
      fetchImpl,
      timeoutMs: settings.requestTimeoutMs,
    });
    const { verifier, challenge } = generatePkcePair();
    const state = generateState();
    const authUrl = buildAuthorizationUrl(metadata, {
      clientId: settings.oauthClientId,
      redirectUri,
      scope: settings.oauthScopes,
      state,
      codeChallenge: challenge,
    });

    await launchBrowserOrHint(openBrowser, authUrl);
    const params = await callbackParams;

    if (params.get("state") !== state) {
      throw new OAuthError("OAuth state mismatch; aborting login.");
    }
    const code = params.get("code");
    if (!code) {
      throw new OAuthError(
        `Authorization failed: ${params.get("error") ?? "no authorization code returned"}.`
      );
    }

    const bundle = tokenBundleWithFallbackScope(
      await exchangeCode({
        tokenEndpoint: metadata.tokenEndpoint,
        clientId: settings.oauthClientId,
        code,
        redirectUri,
        codeVerifier: verifier,
        fetchImpl,
        timeoutMs: settings.requestTimeoutMs,
        nowMs: now(),
      }),
      settings.oauthScopes
    );
    await new TokenStore(settings.tokenPath).save(bundle);
    return bundle;
  } finally {
    server.close();
  }
}
