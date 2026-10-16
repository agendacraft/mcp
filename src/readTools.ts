import { addDays, getEffectiveTimezone, getUpcomingRangeEnd } from "./datetime/index";
import {
  type ListAreasRequest,
  type ListTasksKindEnum,
  type ListTasksStatusEnum,
  type ListPlannerBlocksRequest,
  type ListPlannersRequest,
  type ListProjectsRequest,
  type ListTasksRequest,
  type SyncTasksRequest,
} from "./api/index";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";

import type { AgendaApiClient } from "./apiClient";
import { toMcpSurfaceValue } from "./mcpSurface";
import { apiErrorResult } from "./toolResults";

dayjs.extend(utc);
dayjs.extend(timezone);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface RegisterReadToolsOptions {
  /** Clock used by local-day agenda resources. */
  readonly now?: () => Date;
  /** Register the explicit sync tool; hosted HTTP leaves it off unless opted in. */
  readonly includeSyncTools?: boolean;
  /** Register local-day agenda resources. Use false to disable them even when profile data exists. */
  readonly includeAgendaResources?: boolean;
}

type ToolResult =
  | ReturnType<typeof listResult>
  | ReturnType<typeof paginatedListResult>
  | ReturnType<typeof itemResult>
  | ReturnType<typeof syncResult>
  | Awaited<ReturnType<typeof apiErrorResult>>;

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().refine(isIsoDate, "Expected a valid YYYY-MM-DD date");
const uuid = z.string().uuid();
const taskStatus = z.enum(["active", "completed", "all"]);
const taskKind = z.enum(["task", "event", "all"]);
const AGENDA_SERVICE_MAX_LIST_LIMIT = 500;
const listLimit = z
  .number()
  .int()
  .positive()
  .max(AGENDA_SERVICE_MAX_LIST_LIMIT - 1);
const listOffset = z.number().int().nonnegative();
const DEFAULT_LIST_LIMIT = 100;

const listTasksInputSchema = z
  .object({
    projectId: uuid.optional(),
    areaId: uuid.optional(),
    startTime: isoDateTime.optional(),
    endTime: isoDateTime.optional(),
    status: taskStatus.optional(),
    isComplete: z.boolean().optional(),
    kind: taskKind.optional(),
    schedulable: z.boolean().optional(),
    limit: listLimit.optional(),
    offset: listOffset.optional(),
  })
  .strict();

const getByIdInputSchema = z
  .object({
    id: uuid,
  })
  .strict();

const listProjectsInputSchema = z
  .object({
    timeWindowId: uuid.describe("Filter projects by Time Window id.").optional(),
    isInbox: z.boolean().nullable().optional(),
    isComplete: z.boolean().optional(),
  })
  .strict();

const listAreasInputSchema = z
  .object({
    timeWindowId: uuid.describe("Filter areas by Time Window id.").optional(),
    isComplete: z.boolean().optional(),
  })
  .strict();

const listPlannersInputSchema = z
  .object({
    isComplete: z.boolean().optional(),
  })
  .strict();

const listPlannerBlocksInputSchema = z
  .object({
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict();

const syncTasksInputSchema = z
  .object({
    since: z.string().min(1).nullable().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

const listScheduleInputSchema = z
  .object({
    startTime: isoDateTime,
    endTime: isoDateTime,
    status: taskStatus.optional(),
    isComplete: z.boolean().optional(),
    kind: taskKind.optional(),
    schedulable: z.boolean().optional(),
    limit: listLimit.optional(),
    offset: listOffset.optional(),
  })
  .strict();

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

const listOutputSchema = {
  count: z.number().int().nonnegative(),
  items: z.array(z.unknown()),
};

const paginatedListOutputSchema = {
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
  items: z.array(z.unknown()),
};

const itemOutputSchema = {
  item: z.unknown(),
};

const syncOutputSchema = {
  result: z.unknown(),
};

function toJsonValue(value: unknown): JsonValue {
  const parsed: unknown = toMcpSurfaceValue(JSON.parse(JSON.stringify(value)));
  if (!isJsonValue(parsed)) {
    throw new Error("MCP result could not be serialized as JSON");
  }
  return parsed;
}

function toJsonObject(value: unknown): JsonObject {
  const parsed = toJsonValue(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("MCP structured content must be a JSON object");
  }
  return parsed;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function jsonText(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

function listResult(items: unknown[]) {
  const payload = toJsonObject({ count: items.length, items });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

function paginatedListResult(items: unknown[], limit: number, offset: number) {
  const pageItems = items.slice(0, limit);
  const hasMore = items.length > limit;
  const payload = toJsonObject({
    count: pageItems.length,
    limit,
    offset,
    nextOffset: hasMore ? offset + pageItems.length : null,
    hasMore,
    items: pageItems,
  });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

function itemResult(item: unknown) {
  const payload = toJsonObject({ item });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

function syncResult(result: unknown) {
  const payload = toJsonObject({ result });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

function parseDateTime(value: string): Date {
  return new Date(value);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toListTasksRequest(args: z.infer<typeof listTasksInputSchema>): {
  request: ListTasksRequest;
  limit: number;
  offset: number;
} {
  const filters: ListTasksRequest = {};
  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const offset = args.offset ?? 0;
  if (args.projectId !== undefined) filters.projectId = args.projectId;
  if (args.areaId !== undefined) filters.areaId = args.areaId;
  if (args.startTime !== undefined) filters.startTime = parseDateTime(args.startTime);
  if (args.endTime !== undefined) filters.endTime = parseDateTime(args.endTime);
  setCompletionFilter(filters, args.status, args.isComplete);
  if ((args.kind ?? "task") !== "all") filters.kind = (args.kind ?? "task") as ListTasksKindEnum;
  if (args.schedulable !== undefined) filters.schedulable = args.schedulable;
  filters.limit = limit + 1;
  filters.offset = offset;
  return { request: filters, limit, offset };
}

function toScheduleRequest(args: z.infer<typeof listScheduleInputSchema>): {
  request: ListTasksRequest;
  limit: number;
  offset: number;
} {
  const overlapStartTime = parseDateTime(args.startTime);
  const overlapEndTime = parseDateTime(args.endTime);
  if (overlapStartTime >= overlapEndTime) {
    throw new Error("list_schedule requires startTime before endTime");
  }
  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const offset = args.offset ?? 0;
  const filters: ListTasksRequest = {
    overlapStartTime,
    overlapEndTime,
    schedulable: args.schedulable ?? true,
    limit: limit + 1,
    offset,
  };
  setCompletionFilter(filters, args.status, args.isComplete);
  if (args.kind !== undefined && args.kind !== "all") filters.kind = args.kind as ListTasksKindEnum;
  return { request: filters, limit, offset };
}

function setCompletionFilter(
  filters: ListTasksRequest,
  status: "active" | "completed" | "all" | undefined,
  legacyIsComplete: boolean | undefined
): void {
  if (status === "active" || (status === undefined && legacyIsComplete === undefined)) {
    filters.isComplete = false;
    return;
  }
  if (status === "completed") {
    filters.isComplete = true;
    return;
  }
  if (status === "all") {
    filters.status = status as ListTasksStatusEnum;
    return;
  }
  if (legacyIsComplete !== undefined) filters.isComplete = legacyIsComplete;
}

function toListProjectsRequest(args: z.infer<typeof listProjectsInputSchema>): ListProjectsRequest {
  const filters: ListProjectsRequest = {};
  if (args.timeWindowId !== undefined) filters.plannerId = args.timeWindowId;
  if (args.isInbox !== undefined) filters.isInbox = args.isInbox;
  if (args.isComplete !== undefined) filters.isComplete = args.isComplete;
  return filters;
}

function toListAreasRequest(args: z.infer<typeof listAreasInputSchema>): ListAreasRequest {
  const filters: ListAreasRequest = {};
  if (args.timeWindowId !== undefined) filters.plannerId = args.timeWindowId;
  if (args.isComplete !== undefined) filters.isComplete = args.isComplete;
  return filters;
}

function toListPlannersRequest(args: z.infer<typeof listPlannersInputSchema>): ListPlannersRequest {
  const filters: ListPlannersRequest = {};
  if (args.isComplete !== undefined) filters.isComplete = args.isComplete;
  return filters;
}

function toListPlannerBlocksRequest(
  args: z.infer<typeof listPlannerBlocksInputSchema>
): ListPlannerBlocksRequest {
  const filters: ListPlannerBlocksRequest = {};
  if (args.startDate !== undefined) filters.startDate = parseDate(args.startDate);
  if (args.endDate !== undefined) filters.endDate = parseDate(args.endDate);
  return filters;
}

function toSyncTasksRequest(args: z.infer<typeof syncTasksInputSchema>): SyncTasksRequest {
  const filters: SyncTasksRequest = {};
  if (args.since !== undefined) filters.since = args.since;
  if (args.limit !== undefined) filters.limit = args.limit;
  return filters;
}

function timezoneToday(timezoneName: string, now: Date): string {
  return dayjs(now).tz(timezoneName).format("YYYY-MM-DD");
}

function localDayWindow(date: string, timezoneName: string): { start: Date; end: Date } {
  return {
    start: dayjs.tz(`${date}T00:00:00`, timezoneName).toDate(),
    end: dayjs.tz(`${addDays(date, 1)}T00:00:00`, timezoneName).toDate(),
  };
}

async function userTimezone(client: AgendaApiClient): Promise<string> {
  const user = await client.getMe();
  return getEffectiveTimezone(user.settings.timezone);
}

async function readJsonResource(uri: URL, value: unknown) {
  const payload = toJsonValue(value);
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: jsonText(payload),
      },
    ],
  };
}

async function withApiErrors(operation: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await operation();
  } catch (error) {
    return apiErrorResult(error);
  }
}

export function registerReadTools(
  server: McpServer,
  client: AgendaApiClient,
  options: RegisterReadToolsOptions = {}
): void {
  const now = options.now ?? (() => new Date());

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List real AgendaCraft tasks, defaulting to active task items only (status=active, kind=task) with limit/offset pagination. Use kind=event or list_schedule when you explicitly need imported calendar events.",
      inputSchema: listTasksInputSchema,
      outputSchema: paginatedListOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => {
        const page = toListTasksRequest(args);
        return paginatedListResult(await client.listTasks(page.request), page.limit, page.offset);
      })
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description: "Get one AgendaCraft task by id.",
      inputSchema: getByIdInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => withApiErrors(async () => itemResult(await client.getTask(args.id)))
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List AgendaCraft projects.",
      inputSchema: listProjectsInputSchema,
      outputSchema: listOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => listResult(await client.listProjects(toListProjectsRequest(args))))
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Get one AgendaCraft project by id.",
      inputSchema: getByIdInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => withApiErrors(async () => itemResult(await client.getProject(args.id)))
  );

  server.registerTool(
    "list_areas",
    {
      title: "List areas",
      description: "List AgendaCraft areas.",
      inputSchema: listAreasInputSchema,
      outputSchema: listOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => listResult(await client.listAreas(toListAreasRequest(args))))
  );

  server.registerTool(
    "get_area",
    {
      title: "Get area",
      description: "Get one AgendaCraft area by id.",
      inputSchema: getByIdInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => withApiErrors(async () => itemResult(await client.getArea(args.id)))
  );

  registerTimeWindowReadTools(server, client);
  if (options.includeSyncTools === true) {
    registerSyncTools(server, client);
  }
  registerScheduleTools(server, client);

  if (options.includeAgendaResources === false) return;

  server.registerResource(
    "agenda-tasks-today",
    "agenda://tasks/today",
    {
      title: "Today's active AgendaCraft tasks",
      mimeType: "application/json",
    },
    async (uri) => {
      const tz = await userTimezone(client);
      const today = timezoneToday(tz, now());
      const window = localDayWindow(today, tz);
      return readJsonResource(
        uri,
        await client.listTasks({
          startTime: window.start,
          endTime: window.end,
          isComplete: false,
          schedulable: true,
        })
      );
    }
  );

  server.registerResource(
    "agenda-tasks-upcoming",
    "agenda://tasks/upcoming",
    {
      title: "Upcoming active AgendaCraft tasks",
      mimeType: "application/json",
    },
    async (uri) => {
      const tz = await userTimezone(client);
      const today = timezoneToday(tz, now());
      const window = {
        start: localDayWindow(addDays(today, 1), tz).start,
        end: localDayWindow(addDays(getUpcomingRangeEnd(today), 1), tz).start,
      };
      return readJsonResource(
        uri,
        await client.listTasks({
          startTime: window.start,
          endTime: window.end,
          isComplete: false,
          schedulable: true,
        })
      );
    }
  );

  server.registerResource(
    "agenda-schedule-today",
    "agenda://schedule/today",
    {
      title: "Today's AgendaCraft schedule",
      mimeType: "application/json",
    },
    async (uri) => {
      const tz = await userTimezone(client);
      const today = timezoneToday(tz, now());
      const window = localDayWindow(today, tz);
      return readJsonResource(
        uri,
        await client.listTasks({
          overlapStartTime: window.start,
          overlapEndTime: window.end,
          isComplete: false,
          schedulable: true,
        })
      );
    }
  );
}

function registerSyncTools(server: McpServer, client: AgendaApiClient): void {
  const syncTasksHandler = async (args: z.infer<typeof syncTasksInputSchema>) =>
    withApiErrors(async () => syncResult(await client.syncAgenda(toSyncTasksRequest(args))));

  server.registerTool(
    "sync_tasks",
    {
      title: "Sync tasks",
      description:
        "Read task sync deltas or a task snapshot from agenda-service. This is a client-side replication primitive for explicit sync clients.",
      inputSchema: syncTasksInputSchema,
      outputSchema: syncOutputSchema,
    },
    syncTasksHandler
  );
}

function registerScheduleTools(server: McpServer, client: AgendaApiClient): void {
  const listScheduleHandler = async (args: z.infer<typeof listScheduleInputSchema>) =>
    withApiErrors(async () => {
      const page = toScheduleRequest(args);
      return paginatedListResult(await client.listTasks(page.request), page.limit, page.offset);
    });

  server.registerTool(
    "list_schedule",
    {
      title: "List schedule",
      description:
        "List scheduled AgendaCraft items whose [start_time, end_time) interval overlaps the requested UTC window, defaulting to active items with limit/offset pagination. This is the preferred tool for calendar-style schedule reads and imported events.",
      inputSchema: listScheduleInputSchema,
      outputSchema: paginatedListOutputSchema,
    },
    listScheduleHandler
  );
}

function registerTimeWindowReadTools(server: McpServer, client: AgendaApiClient): void {
  const listTimeWindowsHandler = async (args: z.infer<typeof listPlannersInputSchema>) =>
    withApiErrors(async () => listResult(await client.listPlanners(toListPlannersRequest(args))));
  const getTimeWindowHandler = async (args: z.infer<typeof getByIdInputSchema>) =>
    withApiErrors(async () => itemResult(await client.getPlanner(args.id)));
  const listTimeWindowBlocksHandler = async (args: z.infer<typeof listPlannerBlocksInputSchema>) =>
    withApiErrors(async () =>
      listResult(await client.listPlannerBlocks(toListPlannerBlocksRequest(args)))
    );

  server.registerTool(
    "list_time_windows",
    {
      title: "List time windows",
      description: "List AgendaCraft Time Windows.",
      inputSchema: listPlannersInputSchema,
      outputSchema: listOutputSchema,
    },
    listTimeWindowsHandler
  );

  server.registerTool(
    "get_time_window",
    {
      title: "Get time window",
      description: "Get one AgendaCraft Time Window by id.",
      inputSchema: getByIdInputSchema,
      outputSchema: itemOutputSchema,
    },
    getTimeWindowHandler
  );

  server.registerTool(
    "list_time_window_blocks",
    {
      title: "List time window blocks",
      description: "List Time Window blocks and their scheduled tasks for a date range.",
      inputSchema: listPlannerBlocksInputSchema,
      outputSchema: listOutputSchema,
    },
    listTimeWindowBlocksHandler
  );
}

export function registerProfileResource(server: McpServer, client: AgendaApiClient): void {
  server.registerResource(
    "agenda-me",
    "agenda://me",
    {
      title: "Authenticated AgendaCraft profile",
      mimeType: "application/json",
    },
    async (uri) => readJsonResource(uri, await client.getMe())
  );
}
