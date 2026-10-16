import { createAgendaClient, createRetryAuditMiddleware, type AuditEntry } from "./apiClient";

const baseUrl = "https://api.agendacraft.ai";

const userJson = {
  id: "u1",
  username: "ada",
  email: "ada@agendacraft.ai",
  given_name: "Ada",
  family_name: "Lovelace",
  settings: { timezone: "Europe/London", timeFormat: "24h", notifications_enabled: true },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("createAgendaClient.getMe", () => {
  it("authenticates profile requests with the user's bearer token", async () => {
    let seenUrl = "";
    let authorization: string | null = null;
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      seenUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization");
      return jsonResponse(userJson);
    }) as typeof fetch;

    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "test-token",
      fetchImpl,
    });

    await client.getMe();

    expect(seenUrl).toBe("https://api.agendacraft.ai/api/v1/auth/me");
    expect(authorization).toBe("Bearer test-token");
  });

  it("retries once on 429 honouring Retry-After, then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 429, headers: { "Retry-After": "2" } });
      }
      return jsonResponse(userJson);
    }) as typeof fetch;

    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "test-token",
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await client.getMe();

    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after exhausting retries on persistent 429", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 429, headers: { "Retry-After": "0" } });
    }) as typeof fetch;

    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "t",
      fetchImpl,
      sleep: async () => {},
      maxRetries: 2,
    });

    await expect(client.getMe()).rejects.toThrow("HTTP 429");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("emits a structured audit entry per request", async () => {
    const entries: AuditEntry[] = [];
    const fetchImpl = (async () => jsonResponse(userJson)) as typeof fetch;

    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "t",
      fetchImpl,
      audit: (entry) => entries.push(entry),
    });

    await client.getMe();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe(200);
    expect(entries[0]?.method).toBe("GET");
    expect(entries[0]?.url).toBe("https://api.agendacraft.ai/api/v1/auth/me");
  });
});

describe("createAgendaClient.listTasks", () => {
  it("serializes status all into the agenda-service query", async () => {
    let seenUrl = "";
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      seenUrl = String(input);
      return jsonResponse([]);
    }) as typeof fetch;
    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "test-token",
      fetchImpl,
    });

    await client.listTasks({ status: "all", limit: 101 });

    const requestUrl = new URL(seenUrl);
    expect(requestUrl.pathname).toBe("/api/v1/tasks/");
    expect(requestUrl.searchParams.get("status")).toBe("all");
    expect(requestUrl.searchParams.get("limit")).toBe("101");
  });
});

describe("request audit privacy", () => {
  it("keeps sync cursors out of audit records without changing the request", async () => {
    const entries: AuditEntry[] = [];
    let requestUrl = "";
    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "fixture-token",
      fetchImpl: (async (input) => {
        requestUrl = String(input);
        return jsonResponse({});
      }) as typeof fetch,
      audit: (entry) => entries.push(entry),
    });

    await client.syncAgenda({ since: "private-cursor" });

    expect(new URL(requestUrl).searchParams.get("since")).toBe("private-cursor");
    expect(entries[0]?.url).toBe(`${baseUrl}/api/v1/sync/`);
  });
});

describe("API throttle deadlines", () => {
  it.each([
    ["Wed, 14 Oct 2026 12:00:02 GMT", 2_000],
    ["Wed, 14 Oct 2026 11:59:59 GMT", 0],
    ["Wed, 14 Oct 2026 13:00:00 GMT", 30_000],
    ["not a date", 30_000],
    ["-1", 30_000],
    ["2", 2_000],
  ])("waits for the bounded server deadline %s", async (retryAfter, expectedMs) => {
    const sleeps: number[] = [];
    let attempt = 0;
    const client = createAgendaClient({
      baseUrl,
      accessTokenProvider: async () => "fixture-token",
      now: () => Date.parse("2026-10-14T12:00:00Z"),
      fetchImpl: (async () =>
        attempt++ === 0
          ? new Response(null, { status: 429, headers: { "Retry-After": retryAfter } })
          : jsonResponse(userJson)) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      audit: () => {},
    });

    const user = await client.getMe();

    expect(user.id).toBe("u1");
    expect(sleeps).toEqual([expectedMs]);
  });
});

describe("response preservation", () => {
  it.each([200, 429])(
    "leaves an unretried HTTP %s response with the generated client",
    async (status) => {
      const middleware = createRetryAuditMiddleware({
        fetchImpl: fetch,
        maxRetries: 0,
        maxRetryDelayMs: 30_000,
        sleep: async () => {},
        now: () => 0,
        audit: () => {},
      });
      const response = new Response("fixture", { status });

      const replacement = await middleware.post!({
        fetch,
        url: `${baseUrl}/api/v1/tasks/`,
        init: {},
        response,
      });

      expect(replacement).toBeUndefined();
    }
  );

  it("returns the newly fetched response after a retry", async () => {
    const replacement = jsonResponse(userJson);
    const middleware = createRetryAuditMiddleware({
      fetchImpl: (async () => replacement) as typeof fetch,
      maxRetries: 1,
      maxRetryDelayMs: 30_000,
      sleep: async () => {},
      now: () => 0,
      audit: () => {},
    });

    const result = await middleware.post!({
      fetch,
      url: `${baseUrl}/api/v1/auth/me`,
      init: {},
      response: new Response(null, { status: 429 }),
    });

    expect(result).toBe(replacement);
  });
});
