import { createAgendaClient } from "./apiClient";
import { ResponseError } from "./api/index";
import { apiErrorResult, listResult, withApiErrors } from "./toolResults";

function clientWithErrorResponse(response: Response) {
  return createAgendaClient({
    baseUrl: "https://agenda.example",
    accessTokenProvider: async () => "fixture-token",
    audit: () => {},
    fetchImpl: (async () => response) as typeof fetch,
  });
}

describe("API tool error envelopes", () => {
  afterEach(() => vi.useRealTimers());

  it("returns bounded redacted details for a large upstream error", async () => {
    const client = clientWithErrorResponse(
      new Response("private task content ".repeat(10_000), {
        status: 500,
        statusText: "private upstream status text",
      })
    );

    const result = await withApiErrors(async () => listResult(await client.listTasks({})));

    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text.length).toBeLessThan(4_096);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: {
        status: 500,
        statusText: "Internal Server Error",
        body: "[REDACTED]...[truncated]",
      },
    });
  });

  it("returns the shared envelope when the error body stalls beyond its deadline", async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const client = clientWithErrorResponse(new Response(stream, { status: 503 }));

    const pending = withApiErrors(async () => listResult(await client.listTasks({})));
    await vi.advanceTimersByTimeAsync(3_001);
    controller.close();
    const result = await pending;

    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: {
        status: 503,
        statusText: "Service Unavailable",
        body: "[unavailable]",
      },
    });
  });

  it("returns an error envelope even when the upstream body cannot be read", async () => {
    const client = clientWithErrorResponse(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("fixture body failure"));
          },
        }),
        { status: 502 }
      )
    );

    const result = await withApiErrors(async () => listResult(await client.listTasks({})));

    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: {
        status: 502,
        statusText: "Bad Gateway",
        body: "[unavailable]",
      },
    });
  });

  it("keeps safe diagnostic codes while redacting sensitive JSON fields", async () => {
    const client = clientWithErrorResponse(
      Response.json(
        {
          code: "planner_unavailable",
          message: "private task content",
          access_token: "fixture-token",
        },
        { status: 403 }
      )
    );

    const result = await withApiErrors(async () => listResult(await client.listTasks({})));
    const body = JSON.parse(JSON.parse(result.content[0]!.text).error.body);

    expect(body).toEqual({
      code: "planner_unavailable",
      message: "[REDACTED]",
      access_token: "[REDACTED]",
    });
  });

  it("does not reread raw bodies when an error has no captured details", async () => {
    const error = new ResponseError(new Response("private task content", { status: 403 }));

    const result = await apiErrorResult(error);

    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: {
        status: 403,
        statusText: "Forbidden",
        body: "[unavailable]",
      },
    });
  });
});
