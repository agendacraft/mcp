import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { HostedSettings, Settings } from "./config";
import {
  buildAccessTokenProvider,
  grantedScopesFromCachedToken,
  isDirectCliInvocation,
  main,
} from "./index";
import { TokenStore, tokenBundleFromResponse } from "./oauth";

function settingsWith(tokenPath: string): Settings {
  return {
    agendaServiceUrl: "https://api.agendacraft.ai",
    oauthClientId: "agendacraft-mcp",
    oauthScopes: "agenda:read",
    requestTimeoutMs: 30_000,
    tokenPath,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildAccessTokenProvider", () => {
  it("returns a cached, unexpired access token without any network call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-cli-"));
    const store = new TokenStore(join(dir, "token.json"));
    await store.save(tokenBundleFromResponse({ access_token: "cached", expires_in: 3600 }, 0));

    const fetchImpl = (async () => {
      throw new Error("should not fetch for a fresh token");
    }) as typeof fetch;

    const provider = buildAccessTokenProvider(settingsWith(join(dir, "token.json")), {
      store,
      fetchImpl,
      now: () => 1_000,
    });

    expect(await provider()).toBe("cached");
  });

  it("refreshes an expired token and persists the new one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-cli-"));
    const tokenPath = join(dir, "token.json");
    const store = new TokenStore(tokenPath);
    await store.save(
      tokenBundleFromResponse(
        { access_token: "old", refresh_token: "rt", expires_in: 1, scope: "profile:read" },
        0
      )
    );

    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      signals.push(init?.signal);
      if (String(input).endsWith("/.well-known/oauth-authorization-server")) {
        return jsonResponse({
          authorization_endpoint: "https://api.agendacraft.ai/o/authorize/",
          token_endpoint: "https://api.agendacraft.ai/o/token/",
        });
      }
      return jsonResponse({ access_token: "fresh", refresh_token: "rt2", expires_in: 3600 });
    }) as typeof fetch;

    const provider = buildAccessTokenProvider(settingsWith(tokenPath), {
      store,
      fetchImpl,
      now: () => 10_000_000,
    });

    expect(await provider()).toBe("fresh");
    expect((await store.load())?.accessToken).toBe("fresh");
    expect((await store.load())?.scope).toBe("profile:read");
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("throws when no token is cached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-cli-"));
    const provider = buildAccessTokenProvider(settingsWith(join(dir, "absent.json")));
    await expect(provider()).rejects.toThrow(/login/i);
  });

  it("throws when the token is expired and not refreshable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-cli-"));
    const store = new TokenStore(join(dir, "token.json"));
    await store.save(tokenBundleFromResponse({ access_token: "old", expires_in: 1 }, 0));

    const provider = buildAccessTokenProvider(settingsWith(join(dir, "token.json")), {
      store,
      now: () => 10_000_000,
    });
    await expect(provider()).rejects.toThrow(/login/i);
  });
});

describe("grantedScopesFromCachedToken", () => {
  it("requires re-login when old cached tokens have no persisted scope", () => {
    const bundle = tokenBundleFromResponse({ access_token: "cached", expires_in: 3600 }, 0);

    expect(() => grantedScopesFromCachedToken(bundle)).toThrow(/agenda-mcp login/);
  });

  it("uses the scopes persisted with the cached token", () => {
    const bundle = tokenBundleFromResponse(
      { access_token: "cached", expires_in: 3600, scope: "profile:read agenda:read" },
      0
    );

    expect(grantedScopesFromCachedToken(bundle)).toEqual(["profile:read", "agenda:read"]);
  });

  it("uses no granted scopes when the token response explicitly granted an empty scope", () => {
    const bundle = tokenBundleFromResponse(
      { access_token: "cached", expires_in: 3600, scope: "" },
      0
    );

    expect(grantedScopesFromCachedToken(bundle)).toEqual([]);
  });

  it("keeps scope registration unavailable when no cached token exists", () => {
    expect(grantedScopesFromCachedToken(null)).toBeUndefined();
  });
});

describe("main", () => {
  it("dispatches logout without requiring AGENDA_SERVICE_URL", async () => {
    let loggedOut = false;
    const code = await main(["logout"], {
      env: {},
      logout: async () => {
        loggedOut = true;
      },
    });
    expect(code).toBe(0);
    expect(loggedOut).toBe(true);
  });

  it("dispatches login with parsed settings", async () => {
    let loginSettings: Settings | undefined;
    const code = await main(["login"], {
      env: { AGENDA_SERVICE_URL: "https://api.agendacraft.ai" },
      login: async (settings) => {
        loginSettings = settings;
      },
    });
    expect(code).toBe(0);
    expect(loginSettings?.agendaServiceUrl).toBe("https://api.agendacraft.ai");
  });

  it("defaults to serve", async () => {
    let served = false;
    const code = await main([], {
      env: { AGENDA_SERVICE_URL: "https://api.agendacraft.ai" },
      serve: async () => {
        served = true;
      },
    });
    expect(code).toBe(0);
    expect(served).toBe(true);
  });

  it("accepts a pnpm separator before the serve command", async () => {
    let served = false;
    const code = await main(["--", "serve"], {
      env: { AGENDA_SERVICE_URL: "https://api.agendacraft.ai" },
      serve: async () => {
        served = true;
      },
    });

    expect(code).toBe(0);
    expect(served).toBe(true);
  });

  it("dispatches hosted HTTP mode with hosted settings", async () => {
    let httpSettings: HostedSettings | undefined;
    const code = await main(["http"], {
      env: {
        AGENDA_SERVICE_URL: "https://api.agendacraft.ai",
        AGENDA_MCP_PUBLIC_URL: "https://mcp.agendacraft.ai",
        AGENDA_MCP_INTROSPECTION_CLIENT_ID: "mcp-rs",
        AGENDA_MCP_INTROSPECTION_CLIENT_SECRET: "secret",
      },
      http: async (settings) => {
        httpSettings = settings;
      },
    });
    expect(code).toBe(0);
    expect(httpSettings?.publicUrl).toBe("https://mcp.agendacraft.ai");
    expect(httpSettings?.introspectionClientId).toBe("mcp-rs");
  });

  it("returns a non-zero code for an unknown command", async () => {
    const messages: string[] = [];
    const code = await main(["frobnicate"], {
      env: {},
      stderr: (msg) => messages.push(msg),
    });
    expect(code).toBe(2);
    expect(messages.join("")).toMatch(/unknown command/i);
  });
});

describe("isDirectCliInvocation", () => {
  it("treats symlinked bin paths as direct invocations", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenda-mcp-bin-"));
    const target = join(dir, "dist-index.js");
    const symlink = join(dir, "agenda-mcp");
    writeFileSync(target, "");
    symlinkSync(target, symlink);

    expect(isDirectCliInvocation(pathToFileURL(target).href, symlink)).toBe(true);
  });
});
