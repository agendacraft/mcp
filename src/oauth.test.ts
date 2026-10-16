import { mkdtempSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildAuthorizationUrl,
  exchangeCode,
  fetchMetadata,
  generatePkcePair,
  generateState,
  isTokenExpired,
  metadataFromPayload,
  OAuthError,
  refreshAccessToken,
  runLoginFlow,
  openSystemBrowser,
  TokenStore,
  tokenBundleFromResponse,
  type AuthServerMetadata,
} from "./oauth";
import type { Settings } from "./config";

const metadata: AuthServerMetadata = {
  issuer: "https://api.agendacraft.ai",
  authorizationEndpoint: "https://api.agendacraft.ai/o/authorize/",
  tokenEndpoint: "https://api.agendacraft.ai/o/token/",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generatePkcePair", () => {
  it("derives an S256 challenge from the verifier", async () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("produces a fresh verifier each call", () => {
    expect(generatePkcePair().verifier).not.toBe(generatePkcePair().verifier);
  });
});

describe("metadataFromPayload", () => {
  it("parses a valid discovery document", () => {
    const parsed = metadataFromPayload({
      issuer: "https://api.agendacraft.ai",
      authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
      token_endpoint: "https://api.agendacraft.ai/o/token/",
    });
    expect(parsed).toEqual(metadata);
  });

  it.each(["authorization_endpoint", "token_endpoint", "issuer"])(
    "rejects insecure or non-absolute discovery %s values",
    (field) => {
      for (const value of [
        "http://remote.example/oauth",
        "//auth.example/oauth",
        "/relative",
        "javascript:void(0)",
        "http://localhost.attacker.example/oauth",
      ]) {
        expect(() =>
          metadataFromPayload({
            issuer: "https://auth.example",
            authorization_endpoint: "https://auth.example/authorize",
            token_endpoint: "https://auth.example/token",
            [field]: value,
          })
        ).toThrow(OAuthError);
      }
    }
  );

  it.each(["127.0.0.1", "localhost", "[::1]"])(
    "allows explicit HTTP loopback discovery endpoints at %s",
    (host) => {
      const parsed = metadataFromPayload({
        issuer: `http://${host}:8765`,
        authorization_endpoint: `http://${host}:8765/authorize`,
        token_endpoint: `http://${host}:8765/token`,
      });

      expect(parsed.tokenEndpoint).toBe(`http://${host}:8765/token`);
    }
  );

  it("throws when the token endpoint is missing", () => {
    expect(() =>
      metadataFromPayload({ authorization_endpoint: "https://api.agendacraft.ai/o/authorize/" })
    ).toThrow(OAuthError);
  });
});

describe("buildAuthorizationUrl", () => {
  it("preserves endpoint query values while adding the required OAuth parameters", () => {
    const url = new URL(
      buildAuthorizationUrl(
        {
          ...metadata,
          authorizationEndpoint: "https://auth.example/authorize?audience=api&state=old",
        },
        {
          clientId: "fixture-client",
          redirectUri: "http://127.0.0.1/callback",
          scope: "agenda:read",
          state: "fresh",
          codeChallenge: "fixture-challenge",
        }
      )
    );

    expect(url.searchParams.get("audience")).toBe("api");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.getAll("state")).toEqual(["fresh"]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("includes the PKCE and consent query parameters", () => {
    const url = new URL(
      buildAuthorizationUrl(metadata, {
        clientId: "agendacraft-mcp",
        redirectUri: "http://127.0.0.1:5000/callback",
        scope: "agenda:read",
        state: "state-123",
        codeChallenge: "challenge-abc",
      })
    );
    expect(url.origin + url.pathname).toBe("https://api.agendacraft.ai/o/authorize/");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("agendacraft-mcp");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5000/callback");
    expect(url.searchParams.get("scope")).toBe("agenda:read");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("tokenBundleFromResponse / isTokenExpired", () => {
  it("computes the absolute expiry from expires_in", () => {
    const bundle = tokenBundleFromResponse(
      { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "agenda:read" },
      1_000_000
    );
    expect(bundle.accessToken).toBe("at");
    expect(bundle.refreshToken).toBe("rt");
    expect(bundle.scope).toBe("agenda:read");
    expect(bundle.expiresAt).toBe(1_000_000 + 3600 * 1000);
  });

  it("treats a bundle without an expiry as non-expiring", () => {
    const bundle = tokenBundleFromResponse({ access_token: "at" }, 0);
    expect(bundle.expiresAt).toBeNull();
    expect(isTokenExpired(bundle, 9_999_999_999)).toBe(false);
  });

  it("applies the leeway window", () => {
    const bundle = tokenBundleFromResponse({ access_token: "at", expires_in: 100 }, 0);
    expect(isTokenExpired(bundle, 100_000 - 61_000)).toBe(false);
    expect(isTokenExpired(bundle, 100_000 - 59_000)).toBe(true);
  });
});

describe("exchangeCode / refreshAccessToken", () => {
  it("posts an authorization_code grant", async () => {
    let captured: { url: string; body: string } | undefined;
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      captured = { url: String(input), body: String(init?.body) };
      return jsonResponse({ access_token: "new-at", expires_in: 3600 });
    }) as typeof fetch;

    const bundle = await exchangeCode({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "agendacraft-mcp",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:5000/callback",
      codeVerifier: "verifier",
      fetchImpl,
      nowMs: 0,
    });

    expect(bundle.accessToken).toBe("new-at");
    expect(captured?.url).toBe(metadata.tokenEndpoint);
    const params = new URLSearchParams(captured?.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("code_verifier")).toBe("verifier");
  });

  it("posts a refresh_token grant", async () => {
    let body = "";
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      body = String(init?.body);
      return jsonResponse({ access_token: "refreshed", expires_in: 3600 });
    }) as typeof fetch;

    const bundle = await refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "agendacraft-mcp",
      refreshToken: "rt",
      fetchImpl,
      nowMs: 0,
    });

    expect(bundle.accessToken).toBe("refreshed");
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("rt");
  });

  it("passes timeout signals to token requests", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      signals.push(init?.signal);
      return jsonResponse({ access_token: "at", expires_in: 3600 });
    }) as typeof fetch;
    const exchangeSignal = AbortSignal.timeout(30_000);
    const refreshSignal = AbortSignal.timeout(30_000);

    await exchangeCode({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "agendacraft-mcp",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:5000/callback",
      codeVerifier: "verifier",
      fetchImpl,
      signal: exchangeSignal,
      nowMs: 0,
    });
    await refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "agendacraft-mcp",
      refreshToken: "rt",
      fetchImpl,
      signal: refreshSignal,
      nowMs: 0,
    });

    expect(signals).toEqual([exchangeSignal, refreshSignal]);
  });

  it("raises OAuthError on a non-200 token response", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch;
    await expect(
      refreshAccessToken({
        tokenEndpoint: metadata.tokenEndpoint,
        clientId: "agendacraft-mcp",
        refreshToken: "rt",
        fetchImpl,
        nowMs: 0,
      })
    ).rejects.toThrow(OAuthError);
  });

  it("retries a 429 token response honouring Retry-After, then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 429, headers: { "Retry-After": "2" } });
      }
      return jsonResponse({ access_token: "refreshed", expires_in: 3600 });
    }) as typeof fetch;

    const bundle = await refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "agendacraft-mcp",
      refreshToken: "rt",
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      nowMs: 0,
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(bundle.accessToken).toBe("refreshed");
  });

  it("creates a fresh timeout signal for token retry attempts", async () => {
    let calls = 0;
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      calls += 1;
      signals.push(init?.signal);
      expect(init?.signal?.aborted).toBe(false);
      if (calls === 1) {
        return new Response("", { status: 429 });
      }
      return jsonResponse({ access_token: "refreshed", expires_in: 3600 });
    }) as typeof fetch;

    const bundle = await refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "agendacraft-mcp",
      refreshToken: "rt",
      fetchImpl,
      timeoutMs: 1,
      sleep: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      nowMs: 0,
    });

    expect(bundle.accessToken).toBe("refreshed");
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("fetchMetadata", () => {
  it("fetches and parses the discovery document", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        issuer: "https://api.agendacraft.ai",
        authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
        token_endpoint: "https://api.agendacraft.ai/o/token/",
      })) as typeof fetch;
    const parsed = await fetchMetadata("https://api.agendacraft.ai/.well-known/x", { fetchImpl });
    expect(parsed).toEqual(metadata);
  });

  it("raises OAuthError on a non-200 discovery response", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(
      fetchMetadata("https://api.agendacraft.ai/.well-known/x", { fetchImpl })
    ).rejects.toThrow(OAuthError);
  });

  it("retries a 429 discovery response honouring Retry-After, then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 429, headers: { "Retry-After": "1" } });
      }
      return jsonResponse({
        issuer: "https://api.agendacraft.ai",
        authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
        token_endpoint: "https://api.agendacraft.ai/o/token/",
      });
    }) as typeof fetch;

    const parsed = await fetchMetadata("https://api.agendacraft.ai/.well-known/x", {
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(parsed).toEqual(metadata);
  });
});

describe("openSystemBrowser", () => {
  it("rejects when the browser command exits unsuccessfully", async () => {
    await expect(
      openSystemBrowser("https://api.agendacraft.ai/login", {
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
      })
    ).rejects.toThrow(/exited with status 3/);
  });
});

describe("TokenStore", () => {
  it("round-trips a bundle with owner-only permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-store-"));
    const store = new TokenStore(join(dir, "nested", "token.json"));
    const bundle = tokenBundleFromResponse(
      { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "agenda:read" },
      0
    );

    await store.save(bundle);
    expect(await store.load()).toEqual(bundle);

    const mode = statSync(join(dir, "nested", "token.json")).mode & 0o777;
    expect(mode).toBe(0o600);

    const raw = JSON.parse(await readFile(join(dir, "nested", "token.json"), "utf8"));
    expect(raw.accessToken).toBe("at");

    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("returns null when no token file exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-store-"));
    expect(await new TokenStore(join(dir, "absent.json")).load()).toBeNull();
  });

  it("loads legacy snake_case token cache files with second-based expiries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-store-"));
    const tokenPath = join(dir, "legacy-token.json");
    await writeFile(
      tokenPath,
      JSON.stringify({
        access_token: "legacy-at",
        refresh_token: "legacy-rt",
        expires_at: 1_700_000_000,
        scope: "agenda:read",
      })
    );

    await expect(new TokenStore(tokenPath).load()).resolves.toEqual({
      accessToken: "legacy-at",
      refreshToken: "legacy-rt",
      expiresAt: 1_700_000_000_000,
      scope: "agenda:read",
    });
  });

  it("returns null for a corrupted (non-JSON) token file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-store-"));
    const path = join(dir, "token.json");
    await writeFile(path, "{not valid json");

    expect(await new TokenStore(path).load()).toBeNull();
  });
});

describe("runLoginFlow", () => {
  it("drives the loopback PKCE flow and persists the tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-login-"));
    const tokenPath = join(dir, "token.json");

    const settings: Settings = {
      agendaServiceUrl: "https://api.agendacraft.ai",
      oauthClientId: "agendacraft-mcp",
      oauthScopes: "agenda:read agenda:write",
      requestTimeoutMs: 30_000,
      tokenPath,
    };

    // Routes both the discovery GET and the token POST; the browser stub drives
    // the loopback callback so the whole flow runs without a real browser.
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          issuer: "https://api.agendacraft.ai",
          authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
          token_endpoint: "https://api.agendacraft.ai/o/token/",
        });
      }
      if (url === metadata.tokenEndpoint) {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("grant_type")).toBe("authorization_code");
        expect(params.get("code")).toBe("the-code");
        return jsonResponse({
          access_token: "live-at",
          refresh_token: "live-rt",
          expires_in: 3600,
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const openBrowser = async (authUrl: string) => {
      const parsed = new URL(authUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri");
      const state = parsed.searchParams.get("state");
      const callback = new URL(redirectUri ?? "");
      callback.searchParams.set("code", "the-code");
      callback.searchParams.set("state", state ?? "");
      await fetch(callback.toString());
    };

    const bundle = await runLoginFlow(settings, { fetchImpl, openBrowser, now: () => 0 });

    expect(bundle.accessToken).toBe("live-at");
    expect(bundle.refreshToken).toBe("live-rt");
    expect(bundle.scope).toBe("agenda:read agenda:write");
    expect(await new TokenStore(tokenPath).load()).toEqual(bundle);
  });

  it("ignores non-callback loopback requests before the authorization callback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-login-"));
    const tokenPath = join(dir, "token.json");

    const settings: Settings = {
      agendaServiceUrl: "https://api.agendacraft.ai",
      oauthClientId: "agendacraft-mcp",
      oauthScopes: "agenda:read",
      requestTimeoutMs: 30_000,
      tokenPath,
    };

    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
          token_endpoint: "https://api.agendacraft.ai/o/token/",
        });
      }
      if (url === metadata.tokenEndpoint) {
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("code")).toBe("the-code");
        return jsonResponse({ access_token: "live-at", expires_in: 3600 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const openBrowser = async (authUrl: string) => {
      const parsed = new URL(authUrl);
      const callback = new URL(parsed.searchParams.get("redirect_uri") ?? "");
      await fetch(`${callback.origin}/favicon.ico`);
      callback.searchParams.set("code", "the-code");
      callback.searchParams.set("state", parsed.searchParams.get("state") ?? "");
      void fetch(callback.toString()).catch(() => undefined);
    };

    const bundle = await runLoginFlow(settings, { fetchImpl, openBrowser, now: () => 0 });

    expect(bundle.accessToken).toBe("live-at");
    expect(await new TokenStore(tokenPath).load()).toEqual(bundle);
  });

  it("rejects a state mismatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-login-"));
    const settings: Settings = {
      agendaServiceUrl: "https://api.agendacraft.ai",
      oauthClientId: "agendacraft-mcp",
      oauthScopes: "agenda:read",
      requestTimeoutMs: 30_000,
      tokenPath: join(dir, "token.json"),
    };

    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
          token_endpoint: "https://api.agendacraft.ai/o/token/",
        });
      }
      throw new Error("token endpoint should not be reached on state mismatch");
    }) as typeof fetch;

    const openBrowser = async (authUrl: string) => {
      const redirectUri = new URL(authUrl).searchParams.get("redirect_uri");
      const callback = new URL(redirectUri ?? "");
      callback.searchParams.set("code", "the-code");
      callback.searchParams.set("state", "wrong-state");
      await fetch(callback.toString());
    };

    await expect(runLoginFlow(settings, { fetchImpl, openBrowser, now: () => 0 })).rejects.toThrow(
      OAuthError
    );
  });
});

describe("generateState", () => {
  it("produces unique URL-safe values", () => {
    expect(generateState()).not.toBe(generateState());
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("OAuth throttle deadlines", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["Wed, 14 Oct 2026 12:00:02 GMT", 2_000],
    ["Wed, 14 Oct 2026 11:59:59 GMT", 0],
    ["Wed, 14 Oct 2026 13:00:00 GMT", 30_000],
    ["not a date", 30_000],
    ["-1", 30_000],
    ["2", 2_000],
  ])("waits for the bounded server deadline %s", async (retryAfter, expectedMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const sleeps: number[] = [];
    let attempt = 0;
    const fetchImpl = (async () =>
      attempt++ === 0
        ? new Response(null, { status: 429, headers: { "Retry-After": retryAfter } })
        : jsonResponse({ access_token: "fixture-access" })) as typeof fetch;

    const bundle = await refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "fixture-client",
      refreshToken: "fixture-refresh",
      fetchImpl,
      nowMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(bundle.accessToken).toBe("fixture-access");
    expect(sleeps).toEqual([expectedMs]);
  });
});

describe("OAuth error privacy and limits", () => {
  afterEach(() => vi.useRealTimers());

  function refreshWithResponse(response: Response) {
    return refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "fixture-client",
      refreshToken: "fixture-refresh",
      fetchImpl: (async () => response) as typeof fetch,
      nowMs: 0,
    });
  }

  it("reports only a recognized OAuth error code", async () => {
    const response = jsonResponse(
      {
        error: "invalid_grant",
        error_description: "private user data and fixture-refresh",
        refresh_token: "fixture-refresh",
        access_token: "fixture-access",
        code: "fixture-code",
      },
      400
    );

    await expect(refreshWithResponse(response)).rejects.toThrow(
      /^Token endpoint returned 400: invalid_grant$/
    );
  });

  it.each([
    [{ error: "secret_opaque_value", error_description: "private diagnostic" }, "application/json"],
    ["private HTML response with fixture-refresh", "text/html"],
    ["{broken private JSON", "application/json"],
  ])("omits untrusted error details %#", async (body, contentType) => {
    const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: 502,
      headers: { "Content-Type": contentType },
    });

    await expect(refreshWithResponse(response)).rejects.toThrow(/^Token endpoint returned 502\.$/);
  });

  it("cancels an oversized error body without reading the remaining stream", async () => {
    let cancelled = false;
    let reads = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          reads++;
          controller.enqueue(new TextEncoder().encode("x".repeat(8_192)));
          if (reads === 10) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

    await expect(refreshWithResponse(response)).rejects.toThrow(/^Token endpoint returned 400\.$/);

    expect(cancelled).toBe(true);
    expect(reads).toBeLessThan(4);
  });

  it("returns a sanitized OAuth error after a stalled error body reaches its deadline", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
    const rejection = expect(refreshWithResponse(response)).rejects.toThrow(
      /^Token endpoint returned 503\.$/
    );

    await vi.advanceTimersByTimeAsync(3_001);
    await rejection;

    expect(cancelled).toBe(true);
  });

  it("keeps stream failures out of the OAuth error", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("private upstream failure"));
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );

    await expect(refreshWithResponse(response)).rejects.toThrow(/^Token endpoint returned 502\.$/);
  });
});

describe("OAuth throttled response cleanup", () => {
  it("releases every discarded body before waiting", async () => {
    const cancelled: number[] = [];
    const responses = [0, 1].map(
      (index) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("throttled"));
            },
            cancel() {
              cancelled.push(index);
            },
          }),
          { status: 429, headers: { "Retry-After": "0" } }
        )
    );
    responses.push(jsonResponse({ access_token: "fixture-access" }));
    let attempt = 0;
    let waits = 0;

    const bundle = await refreshAccessToken({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: "fixture-client",
      refreshToken: "fixture-refresh",
      fetchImpl: (async () => responses[attempt++]!) as typeof fetch,
      nowMs: 0,
      sleep: async () => {
        waits++;
        expect(cancelled).toEqual(waits === 1 ? [0] : [0, 1]);
      },
    });

    expect(bundle.accessToken).toBe("fixture-access");
    expect(cancelled).toEqual([0, 1]);
  });
});
