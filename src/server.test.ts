import {
  type BulkReorderResponseSchema,
  ResponseError,
  type AreaOut,
  type PlannerBlockOut,
  type PlannerOut,
  type ProjectOut,
  type SyncResponse,
  type TaskOut,
  type UserOut,
} from "./api/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { AgendaApiClient } from "./apiClient";
import { createMcpServer, type CreateMcpServerOptions } from "./server";

const taskId = "018f7674-7067-7385-8000-000000000001";
const projectId = "018f7674-7067-7385-8000-000000000002";
const areaId = "018f7674-7067-7385-8000-000000000003";
const plannerId = "018f7674-7067-7385-8000-000000000004";

const stubUser: UserOut = {
  id: "u1",
  username: "ada",
  email: "ada@agendacraft.ai",
  givenName: "Ada",
  familyName: "Lovelace",
  settings: { timezone: "Europe/London" },
};

const stubTask: TaskOut = {
  id: taskId,
  summary: "Plan launch",
  domain: projectId,
  planner: plannerId,
  effectivePlanner: plannerId,
  project: projectId,
  area: null,
  order: 0,
  isComplete: false,
  startTime: new Date("2026-04-21T09:00:00Z"),
  endTime: new Date("2026-04-21T10:00:00Z"),
  createdAt: new Date("2026-04-20T09:00:00Z"),
  updatedAt: new Date("2026-04-20T09:00:00Z"),
};

const stubEvent: TaskOut = {
  ...stubTask,
  id: "018f7674-7067-7385-8000-000000000012",
  summary: "Calendar hold",
  origin: "google_calendar",
  kind: "event",
  googleCalendarId: "primary",
};

const stubProject: ProjectOut = {
  id: projectId,
  area: null,
  name: "Launch",
  planner: plannerId,
  isComplete: false,
  createdAt: new Date("2026-04-20T09:00:00Z"),
  updatedAt: new Date("2026-04-20T09:00:00Z"),
};

const stubArea: AreaOut = {
  id: areaId,
  name: "Work",
  planner: plannerId,
  color: "#123456",
  isComplete: false,
  createdAt: new Date("2026-04-20T09:00:00Z"),
  updatedAt: new Date("2026-04-20T09:00:00Z"),
};

const stubPlanner: PlannerOut = {
  id: plannerId,
  startTime: "09:00:00",
  minutes: 60,
  recurrenceRule: null,
  plannerType: "USER",
  isManual: false,
  isSystem: false,
  isComplete: false,
  createdAt: new Date("2026-04-20T09:00:00Z"),
  updatedAt: new Date("2026-04-20T09:00:00Z"),
};

const stubPlannerBlock: PlannerBlockOut = {
  id: "block-1",
  name: "Morning",
  startTime: new Date("2026-04-21T09:00:00Z"),
  endTime: new Date("2026-04-21T10:00:00Z"),
  minutes: 60,
  availableMinutes: 30,
  utilizationPercent: 50,
  isPast: false,
  plannerId,
  plannerName: "Morning planner",
  tasks: [],
};

const stubSync: SyncResponse = {
  syncVersion: 4,
  nextCursor: "cursor-2",
  hasMore: false,
  tasks: { changed: [], deleted: [] },
  events: { changed: [], deleted: [] },
};

const stubReorderResponse: BulkReorderResponseSchema = {
  success: true,
  updatedCount: 2,
  message: "Reordered 2 items.",
};

const fullToolNames = [
  "complete_task",
  "complete_time_window",
  "create_area",
  "create_project",
  "create_task",
  "create_time_window",
  "delete_area",
  "delete_project",
  "delete_task",
  "delete_time_window",
  "get_area",
  "get_project",
  "get_task",
  "get_time_window",
  "list_areas",
  "list_projects",
  "list_schedule",
  "list_tasks",
  "list_time_window_blocks",
  "list_time_windows",
  "reorder_areas",
  "reorder_projects",
  "reorder_tasks",
  "reorder_time_windows",
  "sync_tasks",
  "uncomplete_time_window",
  "update_area",
  "update_project",
  "update_task",
  "update_time_window",
  "whoami",
];

const readProfileToolNames = [
  "get_area",
  "get_project",
  "get_task",
  "get_time_window",
  "list_areas",
  "list_projects",
  "list_schedule",
  "list_tasks",
  "list_time_window_blocks",
  "list_time_windows",
  "whoami",
];

const readToolNames = readProfileToolNames.filter((toolName) => toolName !== "whoami");

const allResourceUris = [
  "agenda://me",
  "agenda://schedule/today",
  "agenda://tasks/today",
  "agenda://tasks/upcoming",
];

function createStubApiClient(overrides: Partial<AgendaApiClient> = {}): AgendaApiClient {
  return {
    getMe: vi.fn(async () => stubUser),
    listTasks: vi.fn(async () => [stubTask]),
    getTask: vi.fn(async () => stubTask),
    listProjects: vi.fn(async () => [stubProject]),
    getProject: vi.fn(async () => stubProject),
    listAreas: vi.fn(async () => [stubArea]),
    getArea: vi.fn(async () => stubArea),
    listPlanners: vi.fn(async () => [stubPlanner]),
    getPlanner: vi.fn(async () => stubPlanner),
    listPlannerBlocks: vi.fn(async () => [stubPlannerBlock]),
    syncAgenda: vi.fn(async () => stubSync),
    createTask: vi.fn(async () => stubTask),
    updateTask: vi.fn(async () => stubTask),
    completeTask: vi.fn(async () => ({ ...stubTask, isComplete: true })),
    deleteTask: vi.fn(async () => undefined),
    reorderTasks: vi.fn(async () => stubReorderResponse),
    createProject: vi.fn(async () => stubProject),
    updateProject: vi.fn(async () => stubProject),
    deleteProject: vi.fn(async () => undefined),
    reorderProjects: vi.fn(async () => stubReorderResponse),
    createArea: vi.fn(async () => stubArea),
    updateArea: vi.fn(async () => stubArea),
    deleteArea: vi.fn(async () => undefined),
    reorderAreas: vi.fn(async () => stubReorderResponse),
    createPlanner: vi.fn(async () => stubPlanner),
    updatePlanner: vi.fn(async () => stubPlanner),
    deletePlanner: vi.fn(async () => undefined),
    reorderPlanners: vi.fn(async () => stubReorderResponse),
    completePlanner: vi.fn(async () => ({ ...stubPlanner, isComplete: true })),
    uncompletePlanner: vi.fn(async () => ({ ...stubPlanner, isComplete: false })),
    ...overrides,
  };
}

async function connectClient(
  apiClient: AgendaApiClient,
  options?: CreateMcpServerOptions
): Promise<Client> {
  const server = createMcpServer(apiClient, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

type ReadMethod =
  | "listTasks"
  | "getTask"
  | "listProjects"
  | "getProject"
  | "listAreas"
  | "getArea"
  | "listPlanners"
  | "getPlanner"
  | "listPlannerBlocks"
  | "syncAgenda";
type TaskWriteMethod = "createTask" | "updateTask" | "completeTask" | "deleteTask" | "reorderTasks";
type StructureWriteMethod =
  | "createProject"
  | "updateProject"
  | "deleteProject"
  | "reorderProjects"
  | "createArea"
  | "updateArea"
  | "deleteArea"
  | "reorderAreas"
  | "createPlanner"
  | "updatePlanner"
  | "deletePlanner"
  | "reorderPlanners"
  | "completePlanner"
  | "uncompletePlanner";
type ToolArguments = Record<string, unknown>;
type HappyToolCase = {
  readonly tool: string;
  readonly args: ToolArguments;
  readonly method: ReadMethod;
  readonly expectedArgs: unknown;
};
type ValidationCase = readonly [tool: string, args: ToolArguments];
type ApiErrorCase = readonly [tool: string, method: ReadMethod, args: ToolArguments];

function firstJsonContent(result: unknown): unknown {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new Error("Expected MCP result content");
  }
  if (!Array.isArray(result.content)) {
    throw new Error("Expected MCP result content");
  }
  const first = result.content[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("text" in first) ||
    typeof first.text !== "string"
  ) {
    throw new Error("Expected first MCP content item to be text");
  }
  return JSON.parse(first.text);
}

function objectKeysIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(objectKeysIn);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => [key, ...objectKeysIn(entry)]);
}

function expectMethodCalled(
  apiClient: AgendaApiClient,
  method: ReadMethod,
  expectedArgs: unknown
): void {
  switch (method) {
    case "listTasks":
      expect(apiClient.listTasks).toHaveBeenCalledWith(expectedArgs);
      return;
    case "getTask":
      expect(apiClient.getTask).toHaveBeenCalledWith(expectedArgs);
      return;
    case "listProjects":
      expect(apiClient.listProjects).toHaveBeenCalledWith(expectedArgs);
      return;
    case "getProject":
      expect(apiClient.getProject).toHaveBeenCalledWith(expectedArgs);
      return;
    case "listAreas":
      expect(apiClient.listAreas).toHaveBeenCalledWith(expectedArgs);
      return;
    case "getArea":
      expect(apiClient.getArea).toHaveBeenCalledWith(expectedArgs);
      return;
    case "listPlanners":
      expect(apiClient.listPlanners).toHaveBeenCalledWith(expectedArgs);
      return;
    case "getPlanner":
      expect(apiClient.getPlanner).toHaveBeenCalledWith(expectedArgs);
      return;
    case "listPlannerBlocks":
      expect(apiClient.listPlannerBlocks).toHaveBeenCalledWith(expectedArgs);
      return;
    case "syncAgenda":
      expect(apiClient.syncAgenda).toHaveBeenCalledWith(expectedArgs);
      return;
  }
}

function createApiClientWithThrowingMethod(method: ReadMethod): AgendaApiClient {
  const throwing = vi.fn(async () => {
    throw apiError(403);
  });
  switch (method) {
    case "listTasks":
      return createStubApiClient({ listTasks: throwing });
    case "getTask":
      return createStubApiClient({ getTask: throwing });
    case "listProjects":
      return createStubApiClient({ listProjects: throwing });
    case "getProject":
      return createStubApiClient({ getProject: throwing });
    case "listAreas":
      return createStubApiClient({ listAreas: throwing });
    case "getArea":
      return createStubApiClient({ getArea: throwing });
    case "listPlanners":
      return createStubApiClient({ listPlanners: throwing });
    case "getPlanner":
      return createStubApiClient({ getPlanner: throwing });
    case "listPlannerBlocks":
      return createStubApiClient({ listPlannerBlocks: throwing });
    case "syncAgenda":
      return createStubApiClient({ syncAgenda: throwing });
  }
}

function apiError(status: number, body: unknown = { message: "Forbidden" }): ResponseError {
  return new ResponseError(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      statusText: "Forbidden",
      headers: { "content-type": "application/json" },
    })
  );
}

describe("createMcpServer", () => {
  it("exposes the full local surface when granted scopes are unavailable", async () => {
    const client = await connectClient(createStubApiClient());
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();

    expect(tools.map((tool) => tool.name).sort()).toEqual(fullToolNames);
    expect(tools).toHaveLength(31);
    expect(resources.map((resource) => resource.uri).sort()).toEqual(allResourceUris);
    expect(resources).toHaveLength(4);

    await client.close();
  });

  it("exposes read tools and resources when profile and agenda read scopes are granted", async () => {
    const client = await connectClient(createStubApiClient(), {
      grantedScopes: ["profile:read", "agenda:read"],
    });
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();

    expect(tools.map((tool) => tool.name).sort()).toEqual(readProfileToolNames);
    expect(tools).toHaveLength(11);
    expect(resources.map((resource) => resource.uri).sort()).toEqual(allResourceUris);
    expect(resources).toHaveLength(4);

    await client.close();
  });

  it("does not expose profile-dependent agenda resources when only agenda read is granted", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient, {
      grantedScopes: ["agenda:read"],
    });
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(readToolNames);
    expect(tools).toHaveLength(10);
    await expect(client.listResources()).rejects.toThrow("Method not found");
    expect(apiClient.getMe).not.toHaveBeenCalled();

    await client.close();
  });

  it("honors an explicit agenda resource disable when profile and agenda read scopes are granted", async () => {
    const client = await connectClient(createStubApiClient(), {
      grantedScopes: ["profile:read", "agenda:read"],
      includeAgendaResources: false,
    });
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();

    expect(tools.map((tool) => tool.name).sort()).toEqual(readProfileToolNames);
    expect(tools).toHaveLength(11);
    expect(resources.map((resource) => resource.uri)).toEqual(["agenda://me"]);
    expect(resources).toHaveLength(1);

    await client.close();
  });

  it("exposes task sync tools only when read scopes opt into sync registration", async () => {
    const client = await connectClient(createStubApiClient(), {
      grantedScopes: ["profile:read", "agenda:read"],
      includeSyncTools: true,
    });
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...readProfileToolNames, "sync_tasks"].sort()
    );
    expect(tools).toHaveLength(12);

    await client.close();
  });

  it("exposes only the profile surface when only profile read is granted", async () => {
    const client = await connectClient(createStubApiClient(), {
      grantedScopes: ["profile:read"],
    });
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();

    expect(tools.map((tool) => tool.name)).toEqual(["whoami"]);
    expect(resources.map((resource) => resource.uri)).toEqual(["agenda://me"]);

    await client.close();
  });

  it("exposes only the new Time Window MCP names and fields", async () => {
    const client = await connectClient(createStubApiClient());

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.has("list_planners")).toBe(false);
    expect(byName.has("get_planner")).toBe(false);
    expect(byName.has("create_planner")).toBe(false);
    expect(byName.has("reorder_planners")).toBe(false);
    expect(byName.has("get_schedule")).toBe(false);
    expect(byName.has("sync_agenda")).toBe(false);

    const listProjectsSchema = byName.get("list_projects")?.inputSchema as
      | { properties?: Record<string, { description?: string }> }
      | undefined;
    const createTaskSchema = byName.get("create_task")?.inputSchema as
      | { properties?: Record<string, { description?: string }> }
      | undefined;

    expect(listProjectsSchema?.properties).not.toHaveProperty("plannerId");
    expect(listProjectsSchema?.properties?.["timeWindowId"]?.description).toContain("Time Window");
    expect(createTaskSchema?.properties).not.toHaveProperty("planner");
    expect(createTaskSchema?.properties?.["timeWindow"]?.description).toContain("Time Window");

    await client.close();
  });

  it("returns only Time Window field names in tool results", async () => {
    const client = await connectClient(createStubApiClient());

    const taskResult = await client.callTool({ name: "list_tasks", arguments: {} });
    const projectResult = await client.callTool({ name: "list_projects", arguments: {} });
    const timeWindowResult = await client.callTool({ name: "list_time_windows", arguments: {} });
    const blockResult = await client.callTool({ name: "list_time_window_blocks", arguments: {} });
    const createResult = await client.callTool({
      name: "create_time_window",
      arguments: {
        startTime: "09:00",
        minutes: 60,
        recurrenceRule: { frequency: "daily" },
      },
    });

    expect(taskResult.structuredContent).toMatchObject({
      items: [{ timeWindow: plannerId, effectiveTimeWindow: plannerId }],
    });
    expect(projectResult.structuredContent).toMatchObject({
      items: [{ timeWindow: plannerId }],
    });
    expect(timeWindowResult.structuredContent).toMatchObject({
      items: [{ timeWindowType: "USER" }],
    });
    expect(blockResult.structuredContent).toMatchObject({
      items: [{ timeWindowId: plannerId, timeWindowName: "Morning planner" }],
    });
    expect(createResult.structuredContent).toMatchObject({
      item: { timeWindowType: "USER" },
    });

    const publicKeys = [
      taskResult.structuredContent,
      projectResult.structuredContent,
      timeWindowResult.structuredContent,
      blockResult.structuredContent,
      createResult.structuredContent,
    ].flatMap(objectKeysIn);
    expect(publicKeys).not.toEqual(
      expect.arrayContaining([
        "planner",
        "effectivePlanner",
        "plannerId",
        "plannerName",
        "plannerType",
      ])
    );

    await client.close();
  });

  it("whoami returns the authenticated user's identity", async () => {
    const client = await connectClient(createStubApiClient());

    const result = await client.callTool({ name: "whoami", arguments: {} });

    expect(result.isError ?? false).toBe(false);
    const expectedProfile = {
      id: "u1",
      email: "ada@agendacraft.ai",
      username: "ada",
      displayName: "Ada Lovelace",
      timezone: "Europe/London",
      timeFormat: null,
    };
    expect(result.structuredContent).toEqual(expectedProfile);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(expectedProfile, null, 2) },
    ]);

    await client.close();
  });

  it.each([
    {
      name: "authentication failures",
      error: apiError(403),
      expected: {
        status: 403,
        statusText: "Forbidden",
        body: JSON.stringify({ message: "Forbidden" }),
      },
    },
    {
      name: "upstream transport failures",
      error: new Error("agenda-service unavailable"),
      expected: {
        status: null,
        statusText: "Tool error",
        body: "agenda-service unavailable",
      },
    },
  ])("whoami surfaces $name as normalized tool errors", async ({ error, expected }) => {
    const client = await connectClient(
      createStubApiClient({
        getMe: vi.fn(async () => {
          throw error;
        }),
      })
    );

    const result = await client.callTool({ name: "whoami", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    expect(firstJsonContent(result)).toEqual({ error: expected });

    await client.close();
  });

  it("falls back to a runtime timezone when the account has none", async () => {
    const userWithoutTz: UserOut = { ...stubUser, settings: {} };
    const client = await connectClient(createStubApiClient({ getMe: async () => userWithoutTz }));

    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.structuredContent).toMatchObject({ id: "u1" });
    expect(result.structuredContent).toMatchObject({ timezone: expect.any(String) });
    expect(result.structuredContent).not.toMatchObject({ timezone: "" });

    await client.close();
  });

  it.each([
    {
      tool: "list_tasks",
      args: { startTime: "2026-04-21T00:00:00Z", endTime: "2026-04-22T00:00:00Z" },
      method: "listTasks",
      expectedArgs: {
        startTime: new Date("2026-04-21T00:00:00Z"),
        endTime: new Date("2026-04-22T00:00:00Z"),
        isComplete: false,
        kind: "task",
        limit: 101,
        offset: 0,
      },
    },
    {
      tool: "get_task",
      args: { id: taskId },
      method: "getTask",
      expectedArgs: taskId,
    },
    {
      tool: "list_projects",
      args: { timeWindowId: plannerId, isComplete: false },
      method: "listProjects",
      expectedArgs: { plannerId, isComplete: false },
    },
    {
      tool: "get_project",
      args: { id: projectId },
      method: "getProject",
      expectedArgs: projectId,
    },
    {
      tool: "list_areas",
      args: { timeWindowId: plannerId, isComplete: false },
      method: "listAreas",
      expectedArgs: { plannerId, isComplete: false },
    },
    {
      tool: "get_area",
      args: { id: areaId },
      method: "getArea",
      expectedArgs: areaId,
    },
    {
      tool: "list_time_windows",
      args: { isComplete: false },
      method: "listPlanners",
      expectedArgs: { isComplete: false },
    },
    {
      tool: "get_time_window",
      args: { id: plannerId },
      method: "getPlanner",
      expectedArgs: plannerId,
    },
    {
      tool: "list_time_window_blocks",
      args: { startDate: "2026-04-21", endDate: "2026-04-22" },
      method: "listPlannerBlocks",
      expectedArgs: {
        startDate: new Date("2026-04-21T00:00:00Z"),
        endDate: new Date("2026-04-22T00:00:00Z"),
      },
    },
    {
      tool: "sync_tasks",
      args: { since: "cursor-1", limit: 50 },
      method: "syncAgenda",
      expectedArgs: { since: "cursor-1", limit: 50 },
    },
    {
      tool: "list_schedule",
      args: { startTime: "2026-04-21T00:00:00Z", endTime: "2026-04-22T00:00:00Z" },
      method: "listTasks",
      expectedArgs: {
        overlapStartTime: new Date("2026-04-21T00:00:00Z"),
        overlapEndTime: new Date("2026-04-22T00:00:00Z"),
        isComplete: false,
        schedulable: true,
        limit: 101,
        offset: 0,
      },
    },
  ] satisfies HappyToolCase[])(
    "$tool returns data from the agenda-service client",
    async ({ tool, args, method, expectedArgs }) => {
      const apiClient = createStubApiClient();
      const client = await connectClient(apiClient);

      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError ?? false).toBe(false);
      expect(firstJsonContent(result)).toBeTruthy();
      expectMethodCalled(apiClient, method, expectedArgs);

      await client.close();
    }
  );

  it("lists active real tasks by default with pagination metadata", async () => {
    const apiClient = createStubApiClient({
      listTasks: vi.fn(async () => [
        { ...stubTask, summary: "First" },
        { ...stubTask, id: "018f7674-7067-7385-8000-000000000013", summary: "Second" },
        stubEvent,
      ]),
    });
    const client = await connectClient(apiClient);

    const result = await client.callTool({ name: "list_tasks", arguments: { limit: 1 } });

    expect(result.isError ?? false).toBe(false);
    expect(apiClient.listTasks).toHaveBeenCalledWith({
      isComplete: false,
      kind: "task",
      limit: 2,
      offset: 0,
    });
    expect(result.structuredContent).toMatchObject({
      count: 1,
      limit: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: true,
      items: [{ summary: "First" }],
    });

    await client.close();
  });

  it.each([
    ["active", false],
    ["completed", true],
  ] as const)(
    "maps list_tasks status %s to the legacy completion filter",
    async (status, isComplete) => {
      const apiClient = createStubApiClient();
      const client = await connectClient(apiClient);

      await client.callTool({ name: "list_tasks", arguments: { status } });

      expect(apiClient.listTasks).toHaveBeenCalledWith({
        kind: "task",
        limit: 101,
        offset: 0,
        isComplete,
      });

      await client.close();
    }
  );

  it("sends list_tasks status all explicitly to agenda-service", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    await client.callTool({ name: "list_tasks", arguments: { status: "all" } });

    expect(apiClient.listTasks).toHaveBeenCalledWith({
      status: "all",
      kind: "task",
      limit: 101,
      offset: 0,
    });

    await client.close();
  });

  it("sends list_schedule status all explicitly to agenda-service", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    await client.callTool({
      name: "list_schedule",
      arguments: {
        startTime: "2026-04-21T00:00:00Z",
        endTime: "2026-04-22T00:00:00Z",
        status: "all",
      },
    });

    expect(apiClient.listTasks).toHaveBeenCalledWith({
      overlapStartTime: new Date("2026-04-21T00:00:00Z"),
      overlapEndTime: new Date("2026-04-22T00:00:00Z"),
      status: "all",
      schedulable: true,
      limit: 101,
      offset: 0,
    });

    await client.close();
  });

  it("reserves agenda-service capacity for pagination lookahead", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    await client.callTool({ name: "list_tasks", arguments: { limit: 499 } });

    expect(apiClient.listTasks).toHaveBeenCalledWith({
      isComplete: false,
      kind: "task",
      limit: 500,
      offset: 0,
    });

    await client.close();
  });

  it("keeps legacy list_tasks isComplete accepted when status is omitted", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    await client.callTool({ name: "list_tasks", arguments: { isComplete: true } });

    expect(apiClient.listTasks).toHaveBeenCalledWith({
      kind: "task",
      isComplete: true,
      limit: 101,
      offset: 0,
    });

    await client.close();
  });

  it("keeps list_schedule isComplete accepted when status is omitted", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    await client.callTool({
      name: "list_schedule",
      arguments: {
        startTime: "2026-04-21T00:00:00Z",
        endTime: "2026-04-22T00:00:00Z",
        isComplete: true,
      },
    });

    expect(apiClient.listTasks).toHaveBeenCalledWith({
      overlapStartTime: new Date("2026-04-21T00:00:00Z"),
      overlapEndTime: new Date("2026-04-22T00:00:00Z"),
      isComplete: true,
      schedulable: true,
      limit: 101,
      offset: 0,
    });

    await client.close();
  });

  it("surfaces local read tool errors as normalized tool errors", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    const result = await client.callTool({
      name: "list_schedule",
      arguments: {
        startTime: "2026-04-22T00:00:00Z",
        endTime: "2026-04-21T00:00:00Z",
      },
    });

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    expect(firstJsonContent(result)).toMatchObject({
      error: {
        status: null,
        statusText: "Tool error",
        body: "list_schedule requires startTime before endTime",
      },
    });
    expect(apiClient.listTasks).not.toHaveBeenCalled();

    await client.close();
  });

  it.each([
    ["list_tasks", { startTime: "not-a-date" }],
    ["list_tasks", { isComplete: null }],
    ["list_tasks", { status: "done" }],
    ["list_tasks", { kind: "calendar" }],
    ["list_tasks", { limit: 0 }],
    ["list_tasks", { limit: 500 }],
    ["list_tasks", { offset: -1 }],
    ["get_task", { id: "not-a-uuid" }],
    ["list_projects", { timeWindowId: "not-a-uuid" }],
    ["list_projects", { plannerId }],
    ["list_projects", { isComplete: null }],
    ["get_project", { id: "not-a-uuid" }],
    ["list_areas", { timeWindowId: "not-a-uuid" }],
    ["list_areas", { plannerId }],
    ["list_areas", { isComplete: null }],
    ["get_area", { id: "not-a-uuid" }],
    ["list_time_windows", { isComplete: "false" }],
    ["get_time_window", { id: "not-a-uuid" }],
    ["list_time_window_blocks", { startDate: "2026-13-99" }],
    ["sync_tasks", { limit: 0 }],
    ["list_schedule", { startTime: "not-a-date", endTime: "2026-04-22T00:00:00Z" }],
    [
      "list_schedule",
      { startTime: "2026-04-21T00:00:00Z", endTime: "2026-04-22T00:00:00Z", isComplete: null },
    ],
    [
      "list_schedule",
      { startTime: "2026-04-21T00:00:00Z", endTime: "2026-04-22T00:00:00Z", limit: 0 },
    ],
    [
      "list_schedule",
      { startTime: "2026-04-21T00:00:00Z", endTime: "2026-04-22T00:00:00Z", limit: 500 },
    ],
  ] satisfies ValidationCase[])(
    "%s rejects invalid input before calling agenda-service",
    async (tool, args) => {
      const apiClient = createStubApiClient();
      const client = await connectClient(apiClient);

      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError).toBe(true);
      expect(apiClient.listTasks).not.toHaveBeenCalled();
      expect(apiClient.getTask).not.toHaveBeenCalled();
      expect(apiClient.listProjects).not.toHaveBeenCalled();
      expect(apiClient.getProject).not.toHaveBeenCalled();
      expect(apiClient.listAreas).not.toHaveBeenCalled();
      expect(apiClient.getArea).not.toHaveBeenCalled();
      expect(apiClient.listPlanners).not.toHaveBeenCalled();
      expect(apiClient.getPlanner).not.toHaveBeenCalled();
      expect(apiClient.listPlannerBlocks).not.toHaveBeenCalled();
      expect(apiClient.syncAgenda).not.toHaveBeenCalled();

      await client.close();
    }
  );

  it.each([
    ["list_tasks", "listTasks", {}],
    ["get_task", "getTask", { id: taskId }],
    ["list_projects", "listProjects", {}],
    ["get_project", "getProject", { id: projectId }],
    ["list_areas", "listAreas", {}],
    ["get_area", "getArea", { id: areaId }],
    ["list_time_windows", "listPlanners", {}],
    ["get_time_window", "getPlanner", { id: plannerId }],
    ["list_time_window_blocks", "listPlannerBlocks", {}],
    ["sync_tasks", "syncAgenda", {}],
    [
      "list_schedule",
      "listTasks",
      { startTime: "2026-04-21T00:00:00Z", endTime: "2026-04-22T00:00:00Z" },
    ],
  ] satisfies ApiErrorCase[])(
    "%s surfaces agenda-service API errors",
    async (tool, method, args) => {
      const apiClient = createApiClientWithThrowingMethod(method);
      const client = await connectClient(apiClient);

      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError).toBe(true);
      expect(result).not.toHaveProperty("structuredContent");
      expect(firstJsonContent(result)).toMatchObject({
        error: { status: 403, body: JSON.stringify({ message: "Forbidden" }) },
      });

      await client.close();
    }
  );

  it("maps agenda-service planner terminology in read API errors", async () => {
    const apiClient = createStubApiClient({
      listPlanners: vi.fn(async () => {
        throw apiError(403, {
          message: "System planners cannot be modified",
          plannerId: ["Unknown planner"],
          planner_type: "SYSTEM",
          nested: { effectivePlanner: "planner fallback" },
        });
      }),
    });
    const client = await connectClient(apiClient);

    const result = await client.callTool({ name: "list_time_windows", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    const payload = firstJsonContent(result) as { error: { status: number; body: string } };
    expect(payload.error.status).toBe(403);
    expect(JSON.parse(payload.error.body)).toEqual({
      message: "System Time Windows cannot be modified",
      timeWindowId: ["Unknown Time Window"],
      timeWindowType: "SYSTEM",
      nested: { effectiveTimeWindow: "Time Window fallback" },
    });
    expect(payload.error.body).not.toMatch(
      /planner|Planner|plannerId|planner_type|effectivePlanner/
    );

    await client.close();
  });

  it.each([
    {
      tool: "create_task",
      args: {
        summary: "Write release notes",
        projectId,
        timeWindow: plannerId,
        startDate: "2026-04-21",
        dueDate: null,
        startTime: "2026-04-21T09:00:00Z",
        minutes: 45,
      },
      method: "createTask",
      expectedArgs: {
        summary: "Write release notes",
        projectId,
        planner: plannerId,
        startDate: new Date("2026-04-21T00:00:00Z"),
        dueDate: null,
        startTime: new Date("2026-04-21T09:00:00Z"),
        minutes: 45,
      },
    },
    {
      tool: "create_task",
      args: { summary: "Zero duration", minutes: 0 },
      method: "createTask",
      expectedArgs: { summary: "Zero duration", minutes: 0 },
    },
    {
      tool: "update_task",
      args: {
        id: taskId,
        summary: "Updated",
        timeWindow: null,
        clearStartTime: true,
      },
      method: "updateTask",
      expectedArgs: [taskId, { summary: "Updated", planner: null, clearStartTime: true }],
    },
    {
      tool: "update_task",
      args: { id: taskId, minutes: 0 },
      method: "updateTask",
      expectedArgs: [taskId, { minutes: 0 }],
    },
    {
      tool: "complete_task",
      args: { id: taskId },
      method: "completeTask",
      expectedArgs: taskId,
    },
    {
      tool: "delete_task",
      args: { id: taskId },
      method: "deleteTask",
      expectedArgs: taskId,
    },
    {
      tool: "reorder_tasks",
      args: {
        items: [
          { id: taskId, order: 10 },
          { id: "018f7674-7067-7385-8000-000000000011", order: 30 },
        ],
      },
      method: "reorderTasks",
      expectedArgs: {
        items: [
          { id: taskId, order: 10 },
          { id: "018f7674-7067-7385-8000-000000000011", order: 30 },
        ],
      },
    },
  ] satisfies {
    readonly tool: string;
    readonly args: ToolArguments;
    readonly method: TaskWriteMethod;
    readonly expectedArgs: unknown;
  }[])("$tool calls the agenda-service write API", async ({ tool, args, method, expectedArgs }) => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    const result = await client.callTool({ name: tool, arguments: args });

    expect(result.isError ?? false).toBe(false);
    if (Array.isArray(expectedArgs)) {
      expect(apiClient[method]).toHaveBeenCalledWith(...expectedArgs);
    } else {
      expect(apiClient[method]).toHaveBeenCalledWith(expectedArgs);
    }

    await client.close();
  });

  it.each([
    ["create_task", { summary: "" }],
    ["create_task", { summary: "Write release notes", timeWindow: "not-a-uuid" }],
    ["create_task", { summary: "Write release notes", planner: plannerId }],
    ["update_task", { id: "not-a-uuid", summary: "Updated" }],
    ["update_task", { id: taskId, timeWindow: "not-a-uuid" }],
    ["update_task", { id: taskId, planner: plannerId }],
    ["complete_task", { id: "not-a-uuid" }],
    ["delete_task", { id: "not-a-uuid" }],
    ["reorder_tasks", { items: [{ id: taskId, order: -1 }] }],
  ] satisfies ValidationCase[])("%s rejects invalid write input", async (tool, args) => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    const result = await client.callTool({ name: tool, arguments: args });

    expect(result.isError).toBe(true);
    expect(apiClient.createTask).not.toHaveBeenCalled();
    expect(apiClient.updateTask).not.toHaveBeenCalled();
    expect(apiClient.completeTask).not.toHaveBeenCalled();
    expect(apiClient.deleteTask).not.toHaveBeenCalled();
    expect(apiClient.reorderTasks).not.toHaveBeenCalled();

    await client.close();
  });

  it.each([
    ["create_task", "createTask", { summary: "Write release notes" }],
    ["update_task", "updateTask", { id: taskId, summary: "Updated" }],
    ["complete_task", "completeTask", { id: taskId }],
    ["delete_task", "deleteTask", { id: taskId }],
    ["reorder_tasks", "reorderTasks", { items: [{ id: taskId, order: 10 }] }],
  ] satisfies readonly [string, TaskWriteMethod, ToolArguments][])(
    "%s surfaces write API errors",
    async (tool, method, args) => {
      const apiClient = createStubApiClient({
        [method]: vi.fn(async () => {
          throw apiError(403);
        }),
      });
      const client = await connectClient(apiClient);

      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError).toBe(true);
      expect(result).not.toHaveProperty("structuredContent");
      expect(firstJsonContent(result)).toMatchObject({
        error: { status: 403, body: JSON.stringify({ message: "Forbidden" }) },
      });

      await client.close();
    }
  );

  it("surfaces write transport errors as tool errors", async () => {
    const apiClient = createStubApiClient({
      createTask: vi.fn(async () => {
        throw new Error("agenda-service unavailable");
      }),
    });
    const client = await connectClient(apiClient);

    const result = await client.callTool({
      name: "create_task",
      arguments: { summary: "Write release notes" },
    });

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    expect(firstJsonContent(result)).toMatchObject({
      error: {
        status: null,
        statusText: "Tool error",
        body: "agenda-service unavailable",
      },
    });

    await client.close();
  });

  it.each([
    {
      tool: "create_project",
      args: { name: "Launch", timeWindow: plannerId, area: null, dueDate: "2026-04-30" },
      method: "createProject",
      expectedArgs: {
        name: "Launch",
        planner: plannerId,
        area: null,
        dueDate: new Date("2026-04-30T00:00:00Z"),
      },
    },
    {
      tool: "update_project",
      args: { id: projectId, name: "Renamed", timeWindow: null },
      method: "updateProject",
      expectedArgs: [projectId, { name: "Renamed", planner: null }],
    },
    {
      tool: "delete_project",
      args: { id: projectId },
      method: "deleteProject",
      expectedArgs: projectId,
    },
    {
      tool: "reorder_projects",
      args: { items: [{ id: projectId, order: 20 }] },
      method: "reorderProjects",
      expectedArgs: { items: [{ id: projectId, order: 20 }] },
    },
    {
      tool: "create_area",
      args: { name: "Work", timeWindow: plannerId, color: "#123456" },
      method: "createArea",
      expectedArgs: { name: "Work", planner: plannerId, color: "#123456" },
    },
    {
      tool: "update_area",
      args: { id: areaId, timeWindow: plannerId, color: "#abcdef" },
      method: "updateArea",
      expectedArgs: [areaId, { planner: plannerId, color: "#abcdef" }],
    },
    {
      tool: "update_area",
      args: { id: areaId, timeWindow: null },
      method: "updateArea",
      expectedArgs: [areaId, { planner: null }],
    },
    {
      tool: "delete_area",
      args: { id: areaId },
      method: "deleteArea",
      expectedArgs: areaId,
    },
    {
      tool: "reorder_areas",
      args: { items: [{ id: areaId, order: 20 }] },
      method: "reorderAreas",
      expectedArgs: { items: [{ id: areaId, order: 20 }] },
    },
    {
      tool: "create_time_window",
      args: { startTime: "09:00", minutes: 60, recurrenceRule: { frequency: "daily" } },
      method: "createPlanner",
      expectedArgs: { startTime: "09:00", minutes: 60, recurrenceRule: { frequency: "daily" } },
    },
    {
      tool: "update_time_window",
      args: { id: plannerId, recurrenceRule: null },
      method: "updatePlanner",
      expectedArgs: [plannerId, { recurrenceRule: null }],
    },
    {
      tool: "delete_time_window",
      args: { id: plannerId },
      method: "deletePlanner",
      expectedArgs: plannerId,
    },
    {
      tool: "reorder_time_windows",
      args: { items: [{ id: plannerId, order: 20 }] },
      method: "reorderPlanners",
      expectedArgs: { items: [{ id: plannerId, order: 20 }] },
    },
    {
      tool: "complete_time_window",
      args: { id: plannerId },
      method: "completePlanner",
      expectedArgs: plannerId,
    },
    {
      tool: "uncomplete_time_window",
      args: { id: plannerId },
      method: "uncompletePlanner",
      expectedArgs: plannerId,
    },
  ] satisfies {
    readonly tool: string;
    readonly args: ToolArguments;
    readonly method: StructureWriteMethod;
    readonly expectedArgs: unknown;
  }[])(
    "$tool calls the agenda-service structure write API",
    async ({ tool, args, method, expectedArgs }) => {
      const apiClient = createStubApiClient();
      const client = await connectClient(apiClient);

      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError ?? false).toBe(false);
      if (Array.isArray(expectedArgs)) {
        expect(apiClient[method]).toHaveBeenCalledWith(...expectedArgs);
      } else {
        expect(apiClient[method]).toHaveBeenCalledWith(expectedArgs);
      }

      await client.close();
    }
  );

  it.each([
    ["create_project", { name: "" }],
    ["create_project", { name: "Launch", timeWindow: "not-a-uuid" }],
    ["create_project", { name: "Launch", planner: plannerId }],
    ["create_project", { name: "Inbox", isInbox: true }],
    ["create_project", { name: "Launch", order: -1 }],
    ["update_project", { id: projectId, isInbox: true }],
    ["update_project", { id: projectId, timeWindow: "not-a-uuid" }],
    ["update_project", { id: projectId, planner: plannerId }],
    ["update_project", { id: "not-a-uuid", name: "Project" }],
    ["update_project", { id: projectId, name: null }],
    ["update_project", { id: projectId, order: null }],
    ["update_project", { id: projectId, order: -1 }],
    ["create_area", { name: "Work", color: "blue" }],
    ["create_area", { name: "Work", timeWindow: "not-a-uuid" }],
    ["create_area", { name: "Work", planner: plannerId }],
    ["create_area", { name: "Work", order: -1 }],
    ["update_area", { id: areaId, color: "blue" }],
    ["update_area", { id: areaId, timeWindow: "not-a-uuid" }],
    ["update_area", { id: areaId, planner: plannerId }],
    ["update_area", { id: areaId, name: null }],
    ["update_area", { id: areaId, order: null }],
    ["update_area", { id: areaId, order: -1 }],
    [
      "create_time_window",
      { startTime: "9am", minutes: 60, recurrenceRule: { frequency: "daily" } },
    ],
    [
      "create_time_window",
      { startTime: "09:00", minutes: 60, recurrenceRule: { frequency: "daily" }, order: -1 },
    ],
    [
      "create_time_window",
      { startTime: "09:00", minutes: 60, recurrenceRule: { frequency: "daily" }, name: null },
    ],
    [
      "create_time_window",
      { startTime: "09:00", minutes: 60, recurrenceRule: { frequency: "weekly", byWeekday: null } },
    ],
    ["update_time_window", { id: plannerId, minutes: 0 }],
    ["update_time_window", { id: plannerId, minutes: null }],
    ["update_time_window", { id: plannerId, name: null }],
    ["update_time_window", { id: plannerId, order: 10 }],
    [
      "update_time_window",
      { id: plannerId, recurrenceRule: { frequency: "weekly", byWeekday: null } },
    ],
    ["delete_time_window", { id: "not-a-uuid" }],
    ["complete_time_window", { id: "not-a-uuid" }],
    ["uncomplete_time_window", { id: "not-a-uuid" }],
    ["reorder_projects", { items: [{ id: projectId, order: -1 }] }],
    ["reorder_areas", { items: [{ id: areaId, order: -1 }] }],
    ["reorder_time_windows", { items: [{ id: plannerId, order: -1 }] }],
  ] satisfies ValidationCase[])("%s rejects invalid structure write input", async (tool, args) => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient);

    const result = await client.callTool({ name: tool, arguments: args });

    expect(result.isError).toBe(true);
    expect(apiClient.createProject).not.toHaveBeenCalled();
    expect(apiClient.updateProject).not.toHaveBeenCalled();
    expect(apiClient.createArea).not.toHaveBeenCalled();
    expect(apiClient.updateArea).not.toHaveBeenCalled();
    expect(apiClient.createPlanner).not.toHaveBeenCalled();
    expect(apiClient.updatePlanner).not.toHaveBeenCalled();

    await client.close();
  });

  it("surfaces structure write API errors", async () => {
    const apiClient = createStubApiClient({
      updatePlanner: vi.fn(async () => {
        throw apiError(403, {
          message: "System planners cannot be modified",
          plannerId: ["Unknown planner"],
          planner_type: "SYSTEM",
        });
      }),
    });
    const client = await connectClient(apiClient);

    const result = await client.callTool({
      name: "update_time_window",
      arguments: { id: plannerId, name: "System planner edit" },
    });

    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    const payload = firstJsonContent(result) as { error: { status: number; body: string } };
    expect(payload.error.status).toBe(403);
    expect(JSON.parse(payload.error.body)).toMatchObject({
      message: "System Time Windows cannot be modified",
      timeWindowId: ["Unknown Time Window"],
      timeWindowType: "SYSTEM",
    });
    expect(payload.error.body).not.toMatch(/planner|Planner|plannerId|planner_type/);

    await client.close();
  });

  it("exposes agenda resources backed by read helpers", async () => {
    const apiClient = createStubApiClient();
    const client = await connectClient(apiClient, {
      now: () => new Date("2026-04-21T12:00:00Z"),
    });

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "agenda://me",
      "agenda://schedule/today",
      "agenda://tasks/today",
      "agenda://tasks/upcoming",
    ]);

    const todayTasks = await client.readResource({ uri: "agenda://tasks/today" });
    expect(todayTasks.contents[0]?.mimeType).toBe("application/json");
    const upcomingTasks = await client.readResource({ uri: "agenda://tasks/upcoming" });
    expect(upcomingTasks.contents[0]?.mimeType).toBe("application/json");
    const schedule = await client.readResource({ uri: "agenda://schedule/today" });
    expect(schedule.contents[0]?.mimeType).toBe("application/json");

    expect(apiClient.listTasks).toHaveBeenNthCalledWith(1, {
      startTime: new Date("2026-04-20T23:00:00Z"),
      endTime: new Date("2026-04-21T23:00:00Z"),
      isComplete: false,
      schedulable: true,
    });
    expect(apiClient.listTasks).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        startTime: new Date("2026-04-21T23:00:00Z"),
        endTime: expect.any(Date),
        isComplete: false,
        schedulable: true,
      })
    );
    expect(apiClient.listTasks).toHaveBeenNthCalledWith(3, {
      overlapStartTime: new Date("2026-04-20T23:00:00Z"),
      overlapEndTime: new Date("2026-04-21T23:00:00Z"),
      isComplete: false,
      schedulable: true,
    });

    await client.close();
  });
});
