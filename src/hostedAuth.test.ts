import {
  HostedAuthError,
  introspectBearerToken,
  parseBearerAuthHeader,
  requireScopes,
} from "./hostedAuth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseBearerAuthHeader", () => {
  it("extracts bearer tokens", () => {
    expect(parseBearerAuthHeader("Bearer abc123")).toBe("abc123");
  });

  it("rejects missing or malformed headers", () => {
    expect(() => parseBearerAuthHeader(undefined)).toThrow(HostedAuthError);
    expect(() => parseBearerAuthHeader("Basic abc123")).toThrow(HostedAuthError);
  });
});

describe("introspectBearerToken", () => {
  it("validates active audience-bound tokens", async () => {
    const requests: Array<{ url: string; body: string; authorization: string | null }> = [];
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      requests.push({
        url: String(input),
        body: String(init?.body),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return jsonResponse({
        active: true,
        client_id: "claude",
        scope: "agenda:read agenda:write profile:read",
        exp: 2_000,
        aud: ["https://mcp.agendacraft.ai/mcp"],
        username: "ada",
      });
    }) as typeof fetch;

    const authInfo = await introspectBearerToken("token", {
      introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
      clientId: "mcp-rs",
      clientSecret: "secret",
      resource: "https://mcp.agendacraft.ai/mcp",
      fetchImpl,
      now: () => 1_000_000,
    });

    expect(authInfo.clientId).toBe("claude");
    expect(authInfo.scopes).toEqual(["agenda:read", "agenda:write", "profile:read"]);
    expect(authInfo.resource?.href).toBe("https://mcp.agendacraft.ai/mcp");
    expect(requests[0]?.body).toContain("resource=https%3A%2F%2Fmcp.agendacraft.ai%2Fmcp");
    expect(requests[0]?.authorization).toMatch(/^Basic /);
  });

  it.each([
    { clientId: "fixture-client", clientSecret: "fixture-secret" },
    { clientId: "fixture:client+%", clientSecret: "fixture+%: secret" },
    { clientId: "fixture café", clientSecret: "fixture/秘密" },
  ])(
    "authenticates introspection with form-significant credentials $clientId",
    async ({ clientId, clientSecret }) => {
      const fetchImpl = (async (_input, init) => {
        const header = new Headers(init?.headers).get("Authorization")!;
        const credentials = Buffer.from(header.slice("Basic ".length), "base64")
          .toString()
          .split(":")
          .map((part) => decodeURIComponent(part.replace(/\+/g, " ")));
        if (
          credentials.length !== 2 ||
          credentials[0] !== clientId ||
          credentials[1] !== clientSecret
        ) {
          return new Response("", { status: 401 });
        }
        return jsonResponse({
          active: true,
          client_id: "fixture-public-client",
          scope: "agenda:read",
        });
      }) as typeof fetch;

      const result = await introspectBearerToken("fixture-token", {
        introspectionEndpoint: "https://auth.example/introspect",
        clientId,
        clientSecret,
        resource: "https://mcp.example/mcp",
        fetchImpl,
      });

      expect(result.clientId).toBe("fixture-public-client");
      expect(result.scopes).toEqual(["agenda:read"]);
    }
  );

  it("accepts current AgendaCraft introspection responses without audience fields", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        active: true,
        client_id: "claude",
        scope: "agenda:read",
      })) as typeof fetch;

    const authInfo = await introspectBearerToken("token", {
      introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
      clientId: "mcp-rs",
      clientSecret: "secret",
      resource: "https://mcp.agendacraft.ai/mcp",
      fetchImpl,
    });

    expect(authInfo.resource?.href).toBe("https://mcp.agendacraft.ai/mcp");
  });

  it("marks throttled introspection as transient and preserves Retry-After", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 429, headers: { "Retry-After": "3" } })) as typeof fetch;

    await expect(
      introspectBearerToken("token", {
        introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
        clientId: "mcp-rs",
        clientSecret: "secret",
        resource: "https://mcp.agendacraft.ai/mcp",
        fetchImpl,
      })
    ).rejects.toMatchObject({
      status: 503,
      headers: { "Retry-After": "3" },
    });
  });

  it("marks introspection client authentication failures as hosted server errors", async () => {
    const fetchImpl = (async () => new Response("", { status: 401 })) as typeof fetch;

    await expect(
      introspectBearerToken("token", {
        introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
        clientId: "mcp-rs",
        clientSecret: "wrong",
        resource: "https://mcp.agendacraft.ai/mcp",
        fetchImpl,
      })
    ).rejects.toMatchObject({ status: 503 });
  });

  it("marks introspection timeouts and malformed responses as transient", async () => {
    const timeoutFetch = (async () => {
      throw new DOMException("Timed out", "TimeoutError");
    }) as typeof fetch;

    await expect(
      introspectBearerToken("token", {
        introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
        clientId: "mcp-rs",
        clientSecret: "secret",
        resource: "https://mcp.agendacraft.ai/mcp",
        fetchImpl: timeoutFetch,
      })
    ).rejects.toMatchObject({ status: 503 });

    const malformedFetch = (async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    await expect(
      introspectBearerToken("token", {
        introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
        clientId: "mcp-rs",
        clientSecret: "secret",
        resource: "https://mcp.agendacraft.ai/mcp",
        fetchImpl: malformedFetch,
      })
    ).rejects.toMatchObject({ status: 503 });
  });

  it("rejects inactive tokens and tokens for another resource", async () => {
    const inactiveFetch = (async () => jsonResponse({ active: false })) as typeof fetch;
    await expect(
      introspectBearerToken("token", {
        introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
        clientId: "mcp-rs",
        clientSecret: "secret",
        resource: "https://mcp.agendacraft.ai/mcp",
        fetchImpl: inactiveFetch,
      })
    ).rejects.toThrow(HostedAuthError);

    const wrongAudienceFetch = (async () =>
      jsonResponse({
        active: true,
        client_id: "claude",
        scope: "agenda:read",
        aud: ["https://other.example"],
      })) as typeof fetch;
    await expect(
      introspectBearerToken("token", {
        introspectionEndpoint: "https://api.agendacraft.ai/o/introspect/",
        clientId: "mcp-rs",
        clientSecret: "secret",
        resource: "https://mcp.agendacraft.ai/mcp",
        fetchImpl: wrongAudienceFetch,
      })
    ).rejects.toThrow(/audience/i);
  });
});

describe("requireScopes", () => {
  it("rejects missing scopes", () => {
    expect(() =>
      requireScopes(
        {
          token: "token",
          clientId: "claude",
          scopes: ["agenda:read"],
        },
        ["agenda:write"]
      )
    ).toThrow(/agenda:write/);
  });
});
