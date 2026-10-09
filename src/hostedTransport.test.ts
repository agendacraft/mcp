import type { AddressInfo } from "node:net";

import type { HostedSettings } from "./config";
import { createHostedApp } from "./hostedTransport";

function hostedSettings(): HostedSettings {
  return {
    agendaServiceUrl: "https://api.agendacraft.ai",
    oauthClientId: "agendacraft-mcp",
    oauthScopes: "agenda:read agenda:write profile:read",
    requestTimeoutMs: 30_000,
    tokenPath: "/tmp/agenda-mcp-token.json",
    host: "127.0.0.1",
    port: 0,
    publicUrl: "https://mcp.agendacraft.ai",
    resource: "https://mcp.agendacraft.ai/mcp",
    introspectionClientId: "mcp-rs",
    introspectionClientSecret: "secret",
    allowedHosts: ["mcp.agendacraft.ai", "127.0.0.1"],
    allowedOrigins: ["https://mcp.agendacraft.ai", "https://claude.ai"],
    authorizationServerUrl: "https://app.agendacraft.ai",
  };
}

function metadataResponse(): Response {
  return new Response(
    JSON.stringify({
      issuer: "https://app.agendacraft.ai",
      authorization_endpoint: "https://app.agendacraft.ai/o/authorize/",
      token_endpoint: "https://app.agendacraft.ai/o/token/",
      introspection_endpoint: "https://app.agendacraft.ai/o/introspect/",
      response_types_supported: ["code"],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("createHostedApp", () => {
  it("serves health, protected-resource metadata, and auth challenges", async () => {
    const fetchImpl = (async () => metadataResponse()) as typeof fetch;
    const app = await createHostedApp(hostedSettings(), { fetchImpl });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const prm = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
      expect(prm.status).toBe(200);
      expect(await prm.json()).toMatchObject({
        resource: "https://mcp.agendacraft.ai/mcp",
        authorization_servers: ["https://app.agendacraft.ai"],
        scopes_supported: ["agenda:read", "agenda:write", "profile:read"],
      });

      const browserPrm = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`, {
        headers: { Origin: "https://claude.ai" },
      });
      expect(browserPrm.status).toBe(200);
      expect(browserPrm.headers.get("access-control-allow-origin")).toBe("https://claude.ai");

      const metadataPreflight = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://claude.ai",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect(metadataPreflight.status).toBe(204);
      expect(metadataPreflight.headers.get("access-control-allow-origin")).toBe(
        "https://claude.ai"
      );
      expect(metadataPreflight.headers.get("access-control-allow-methods")).toContain("GET");

      const mcp = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
      expect(mcp.status).toBe(401);
      expect(mcp.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="https://mcp.agendacraft.ai/.well-known/oauth-protected-resource/mcp"'
      );

      const preflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://claude.ai",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
      expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");

      const rejectedPreflight = await fetch(`${baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Access-Control-Request-Method": "POST",
        },
      });
      expect(rejectedPreflight.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fetches OAuth metadata from the public authorization-server URL", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      requests.push(String(input));
      return metadataResponse();
    }) as typeof fetch;
    const settings = {
      ...hostedSettings(),
      agendaServiceUrl: "http://agenda-service-prod-blue:8000",
      authorizationServerUrl: "https://app.agendacraft.ai",
    };

    await createHostedApp(settings, { fetchImpl });

    expect(requests).toEqual(["https://app.agendacraft.ai/.well-known/oauth-authorization-server"]);
  });
});
