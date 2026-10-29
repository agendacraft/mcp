import { join } from "node:path";

import {
  ConfigError,
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_OAUTH_SCOPES,
  loadHostedSettings,
  loadSettings,
  metadataUrl,
  resolveTokenPath,
} from "./config";

const baseEnv = { AGENDA_SERVICE_URL: "https://api.agendacraft.ai" };

describe("loadSettings", () => {
  it("reads the service URL and applies defaults", () => {
    const settings = loadSettings({ ...baseEnv });
    expect(settings.agendaServiceUrl).toBe("https://api.agendacraft.ai");
    expect(settings.oauthClientId).toBe(DEFAULT_OAUTH_CLIENT_ID);
    expect(settings.oauthScopes).toBe(DEFAULT_OAUTH_SCOPES);
    expect(settings.requestTimeoutMs).toBe(30_000);
  });

  it("strips trailing slashes from the service URL", () => {
    const settings = loadSettings({ AGENDA_SERVICE_URL: "https://api.agendacraft.ai/" });
    expect(settings.agendaServiceUrl).toBe("https://api.agendacraft.ai");
  });

  it.each(["?tenant=x", "#section", "?", "#"])("rejects a service base URL with %s", (suffix) => {
    expect(() => loadSettings({ AGENDA_SERVICE_URL: `https://api.example${suffix}` })).toThrow(
      ConfigError
    );
  });

  it.each(["user:pass", "user", ":pass", "user%40name:p%3Ass"])(
    "rejects service URL userinfo %s without echoing credentials",
    (userinfo) => {
      expect(() => loadSettings({ AGENDA_SERVICE_URL: `https://${userinfo}@api.example` })).toThrow(
        "AGENDA_SERVICE_URL must not contain credentials."
      );
    }
  );

  it("preserves a valid service path prefix for endpoint construction", () => {
    const settings = loadSettings({ AGENDA_SERVICE_URL: "https://api.example/agenda/" });

    expect(metadataUrl(settings)).toBe(
      "https://api.example/agenda/.well-known/oauth-authorization-server"
    );
  });

  it("honours explicit client id, scopes, and timeout overrides", () => {
    const settings = loadSettings({
      ...baseEnv,
      AGENDA_MCP_OAUTH_CLIENT_ID: "custom-client",
      AGENDA_MCP_OAUTH_SCOPES: "agenda:read",
      AGENDA_MCP_REQUEST_TIMEOUT: "5",
    });
    expect(settings.oauthClientId).toBe("custom-client");
    expect(settings.oauthScopes).toBe("agenda:read");
    expect(settings.requestTimeoutMs).toBe(5_000);
  });

  it("rejects a missing service URL", () => {
    expect(() => loadSettings({})).toThrow(ConfigError);
  });

  it("rejects a service URL without an http(s) scheme", () => {
    expect(() => loadSettings({ AGENDA_SERVICE_URL: "api.agendacraft.ai" })).toThrow(ConfigError);
  });

  it("rejects a scheme-only or malformed service URL", () => {
    expect(() => loadSettings({ AGENDA_SERVICE_URL: "https://" })).toThrow(ConfigError);
    expect(() => loadSettings({ AGENDA_SERVICE_URL: "https://bad host" })).toThrow(ConfigError);
  });

  it("falls back to defaults for whitespace-only OAuth overrides", () => {
    const settings = loadSettings({
      ...baseEnv,
      AGENDA_MCP_OAUTH_CLIENT_ID: "   ",
      AGENDA_MCP_OAUTH_SCOPES: "   ",
    });
    expect(settings.oauthClientId).toBe(DEFAULT_OAUTH_CLIENT_ID);
    expect(settings.oauthScopes).toBe(DEFAULT_OAUTH_SCOPES);
  });

  it("rejects a non-numeric timeout", () => {
    expect(() => loadSettings({ ...baseEnv, AGENDA_MCP_REQUEST_TIMEOUT: "soon" })).toThrow(
      ConfigError
    );
  });

  it("rejects a non-positive timeout", () => {
    expect(() => loadSettings({ ...baseEnv, AGENDA_MCP_REQUEST_TIMEOUT: "0" })).toThrow(
      ConfigError
    );
  });
});

describe("metadataUrl", () => {
  it("appends the RFC 8414 discovery path", () => {
    const settings = loadSettings({ ...baseEnv });
    expect(metadataUrl(settings)).toBe(
      "https://api.agendacraft.ai/.well-known/oauth-authorization-server"
    );
  });
});

describe("loadHostedSettings", () => {
  const hostedEnv = {
    ...baseEnv,
    AGENDA_MCP_INTROSPECTION_CLIENT_ID: "mcp-rs",
    AGENDA_MCP_INTROSPECTION_CLIENT_SECRET: "secret",
  };

  it.each(["AGENDA_MCP_PUBLIC_URL", "AGENDA_MCP_AUTHORIZATION_SERVER_URL"])(
    "rejects query or fragment components in the %s base URL",
    (variable) => {
      for (const suffix of ["?tenant=x", "#section", "?", "#"]) {
        expect(() =>
          loadHostedSettings({ ...hostedEnv, [variable]: `https://auth.example${suffix}` })
        ).toThrow(ConfigError);
      }
    }
  );

  it("applies hosted defaults", () => {
    const settings = loadHostedSettings({ ...hostedEnv });
    expect(settings.authorizationServerUrl).toBe("https://api.agendacraft.ai");
    expect(settings.host).toBe("127.0.0.1");
    expect(settings.port).toBe(8001);
    expect(settings.publicUrl).toBe("http://127.0.0.1:8001");
    expect(settings.resource).toBe("http://127.0.0.1:8001/mcp");
    expect(settings.allowedHosts).toEqual(["127.0.0.1"]);
    expect(settings.allowedOrigins).toEqual(["http://127.0.0.1:8001"]);
  });

  it("derives the protected resource from the public URL at the MCP endpoint", () => {
    const settings = loadHostedSettings({
      ...hostedEnv,
      AGENDA_MCP_PUBLIC_URL: "https://mcp.agendacraft.ai/",
    });

    expect(settings.publicUrl).toBe("https://mcp.agendacraft.ai");
    expect(settings.resource).toBe("https://mcp.agendacraft.ai/mcp");
  });

  it("uses explicit public resource, allowed hosts, and allowed origins", () => {
    const settings = loadHostedSettings({
      ...hostedEnv,
      AGENDA_MCP_HOST: "0.0.0.0",
      AGENDA_MCP_PORT: "9001",
      AGENDA_MCP_PUBLIC_URL: "https://mcp.agendacraft.ai/",
      AGENDA_MCP_RESOURCE: "https://mcp.agendacraft.ai/mcp/",
      AGENDA_MCP_AUTHORIZATION_SERVER_URL: "https://api.agendacraft.ai/",
      AGENDA_MCP_ALLOWED_HOSTS: "mcp.agendacraft.ai, localhost:9001",
      AGENDA_MCP_ALLOWED_ORIGINS: "https://claude.ai, https://mcp.agendacraft.ai",
    });
    expect(settings.authorizationServerUrl).toBe("https://api.agendacraft.ai");
    expect(settings.host).toBe("0.0.0.0");
    expect(settings.port).toBe(9001);
    expect(settings.publicUrl).toBe("https://mcp.agendacraft.ai");
    expect(settings.resource).toBe("https://mcp.agendacraft.ai/mcp");
    expect(settings.allowedHosts).toEqual(["mcp.agendacraft.ai", "localhost"]);
    expect(settings.allowedOrigins).toEqual(["https://mcp.agendacraft.ai", "https://claude.ai"]);
  });

  it("preserves registered introspection credentials exactly", () => {
    const settings = loadHostedSettings({
      ...hostedEnv,
      AGENDA_MCP_INTROSPECTION_CLIENT_ID: " client id ",
      AGENDA_MCP_INTROSPECTION_CLIENT_SECRET: "\t secret value \n",
    });

    expect(settings.introspectionClientId).toBe(" client id ");
    expect(settings.introspectionClientSecret).toBe("\t secret value \n");
  });

  it.each(["AGENDA_MCP_INTROSPECTION_CLIENT_ID", "AGENDA_MCP_INTROSPECTION_CLIENT_SECRET"])(
    "rejects blank %s",
    (key) => {
      expect(() => loadHostedSettings({ ...hostedEnv, [key]: " \t\n" })).toThrow(ConfigError);
    }
  );

  it("requires introspection credentials for hosted mode", () => {
    expect(() => loadHostedSettings({ ...baseEnv })).toThrow(ConfigError);
  });

  it("rejects empty explicit hosted ports and malformed CORS origins", () => {
    expect(() => loadHostedSettings({ ...hostedEnv, AGENDA_MCP_PORT: "" })).toThrow(ConfigError);
    expect(() =>
      loadHostedSettings({
        ...hostedEnv,
        AGENDA_MCP_ALLOWED_ORIGINS: "https://claude.ai/path",
      })
    ).toThrow(ConfigError);
  });
});

describe("resolveTokenPath", () => {
  it("prefers an explicit AGENDA_MCP_TOKEN_PATH", () => {
    expect(resolveTokenPath({ AGENDA_MCP_TOKEN_PATH: "/tmp/token.json" })).toBe("/tmp/token.json");
  });

  it("falls back to XDG_CONFIG_HOME when no explicit path is set", () => {
    expect(resolveTokenPath({ XDG_CONFIG_HOME: "/cfg" })).toBe(
      join("/cfg", "agenda-mcp", "token.json")
    );
  });
});

describe("request timeout timer limits", () => {
  it.each(["0.0001", "2147483.648", "4294967.296", "1e308"])(
    "rejects unrepresentable timeout %s at startup",
    (value) => {
      expect(() => loadSettings({ ...baseEnv, AGENDA_MCP_REQUEST_TIMEOUT: value })).toThrow(
        ConfigError
      );
    }
  );

  it.each(["0.001", "1.25", "30", "2147483.647"])(
    "accepts millisecond-precision timeout %s",
    (value) => {
      const settings = loadSettings({ ...baseEnv, AGENDA_MCP_REQUEST_TIMEOUT: value });

      expect(settings.requestTimeoutMs).toBe(Number(value) * 1000);
      expect(() => AbortSignal.timeout(settings.requestTimeoutMs)).not.toThrow();
    }
  );
});
