import { readFileSync } from "node:fs";
import { createAgendaClient } from "./apiClient";
import { PlannerUpdateInToJSON, TaskOutFromJSON, TaskOutToJSON } from "./api/index";

const taskJson = {
  id: "task-demo",
  summary: "Review agenda",
  domain: "project-demo",
  order: 1,
  created_at: "2026-01-21T12:00:00Z",
  updated_at: "2026-01-21T12:00:00Z",
  is_complete: false,
  start_date: "2026-01-22",
  planner: null,
  recurrence_rule: { frequency: "WEEKLY", by_weekday: ["MO"], interval: 2 },
};

describe("public API wire compatibility", () => {
  it("sends snake_case recurrence fields and receives camelCase task fields", async () => {
    let body: unknown;
    const client = createAgendaClient({
      baseUrl: "https://agenda.example",
      accessTokenProvider: async () => "fixture-token",
      audit: () => {},
      fetchImpl: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json(taskJson);
      }) as typeof fetch,
    });

    const task = await client.createTask({
      summary: "Review agenda",
      startDate: new Date("2026-01-22T00:00:00Z"),
      planner: null,
      recurrenceRule: { frequency: "WEEKLY", byWeekday: ["MO"], interval: 2 },
    });

    expect(body).toMatchObject({
      summary: "Review agenda",
      start_date: "2026-01-22",
      planner: null,
      recurrence_rule: { frequency: "WEEKLY", by_weekday: ["MO"], interval: 2 },
    });
    expect(body).not.toHaveProperty("recurrenceRule");
    expect(task).toMatchObject({
      isComplete: false,
      planner: null,
      startDate: new Date("2026-01-22T00:00:00Z"),
      recurrenceRule: { frequency: "WEEKLY", byWeekday: ["MO"], interval: 2 },
    });
  });

  it("preserves explicit nulls when clearing task scheduling and recurrence", async () => {
    let body: unknown;
    const client = createAgendaClient({
      baseUrl: "https://agenda.example",
      accessTokenProvider: async () => "fixture-token",
      audit: () => {},
      fetchImpl: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json(taskJson);
      }) as typeof fetch,
    });

    await client.updateTask("task-demo", {
      recurrenceRule: null,
      planner: null,
      dueDate: null,
      startDate: null,
      startTime: null,
      endDate: null,
      endTime: null,
    });

    expect(body).toEqual({
      recurrence_rule: null,
      planner: null,
      due_date: null,
      start_date: null,
      start_time: null,
      end_date: null,
      end_time: null,
    });
    expect(body).not.toHaveProperty("minutes");
  });

  it.each([
    { startDate: null, expected: { start_date: null } },
    { startDate: undefined, expected: {} },
    { startDate: new Date("2026-01-22T00:00:00Z"), expected: { start_date: "2026-01-22" } },
  ])("preserves a Time Window date update as $expected", ({ startDate, expected }) => {
    const input = startDate === undefined ? {} : { startDate };

    const wire = JSON.parse(JSON.stringify(PlannerUpdateInToJSON(input)));

    expect(wire).toEqual(expected);
  });

  it("preserves cleared completion dates through a model round trip", () => {
    const json = {
      ...taskJson,
      completed_at: null,
      completed_start_date: null,
      completed_start_time: null,
    };

    const wire = JSON.parse(JSON.stringify(TaskOutToJSON(TaskOutFromJSON(json))));

    expect(wire).toMatchObject({
      completed_at: null,
      completed_start_date: null,
      completed_start_time: null,
    });
    expect(wire).not.toHaveProperty("end_time");
  });

  it("parses nested sync changes and timestamps", async () => {
    const client = createAgendaClient({
      baseUrl: "https://agenda.example",
      accessTokenProvider: async () => "fixture-token",
      audit: () => {},
      fetchImpl: (async () =>
        Response.json({
          sync_version: 4,
          next_cursor: "next-demo",
          has_more: false,
          tasks: {
            changed: [
              { id: "task-demo", change_type: "updated", changed_at: "2026-01-21T12:00:00Z" },
            ],
            deleted: [],
          },
          events: { changed: [], deleted: [] },
          list_placements: { changed: [], deleted: [] },
        })) as typeof fetch,
    });

    const result = await client.syncAgenda({});

    expect(result).toMatchObject({ syncVersion: 4, nextCursor: "next-demo", hasMore: false });
    expect(result.tasks.changed?.[0]).toMatchObject({
      id: "task-demo",
      changeType: "updated",
      changedAt: new Date("2026-01-21T12:00:00Z"),
    });
  });
});

describe("approved public contract", () => {
  it("contains exactly the allowed operations and only their referenced components", () => {
    const schema = JSON.parse(readFileSync("openapi/schema.json", "utf8"));
    const allowed = JSON.parse(readFileSync("openapi/operations.json", "utf8"));
    const operations = Object.values(schema.paths).flatMap((verbs) =>
      Object.values(verbs as object)
    );

    expect(operations.map((op) => op.operationId).sort()).toEqual([...allowed].sort());
    const referenced = new Set<string>();
    function visit(node: unknown): void {
      if (!node || typeof node !== "object") return;
      if ("$ref" in node) {
        const ref = String(node.$ref);
        if (referenced.has(ref)) return;
        referenced.add(ref);
        const [, , kind, name] = ref.split("/");
        expect(kind).toBe("schemas");
        expect(schema.components[kind!][name!]).toBeDefined();
        visit(schema.components[kind!][name!]);
      }
      Object.values(node).forEach(visit);
    }
    visit(schema.paths);

    expect([...referenced].sort()).toEqual(
      Object.keys(schema.components.schemas)
        .map((name) => `#/components/schemas/${name}`)
        .sort()
    );
  });
});
