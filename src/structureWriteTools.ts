import type {
  AreaIn,
  AreaUpdateIn,
  BulkReorderSchema,
  PlannerIn,
  PlannerUpdateIn,
  ProjectIn,
  ProjectUpdateIn,
  RecurrenceRuleSchema,
} from "./api/index";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AgendaApiClient } from "./apiClient";
import { actionResult, itemResult, withApiErrors } from "./toolResults";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().refine(isIsoDate, "Expected a valid YYYY-MM-DD date");
const localTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected HH:MM or HH:MM:SS");
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const order = z.number().int().nonnegative();

const recurrenceRuleSchema = z
  .object({
    frequency: z.string().min(1),
    byWeekday: z.array(z.string()).optional(),
    interval: z.number().int().positive().optional(),
    count: z.number().int().positive().nullable().optional(),
    until: isoDate.nullable().optional(),
    byMonth: z.string().nullable().optional(),
    byWeekNumber: z.string().nullable().optional(),
    byYearDay: z.string().nullable().optional(),
    byMonthDay: z.string().nullable().optional(),
    byDay: z.string().nullable().optional(),
    byHour: z.string().nullable().optional(),
    byMinute: z.string().nullable().optional(),
  })
  .strict();

const projectCreateInputSchema = z
  .object({
    id: nullableUuid.optional(),
    timeWindow: nullableUuid.describe("Assign the project to a Time Window.").optional(),
    area: nullableUuid.optional(),
    name: z.string().min(1),
    order: order.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    isInbox: z.never().optional(),
    completedAt: isoDateTime.nullable().optional(),
  })
  .strict();

const projectUpdateInputSchema = z
  .object({
    id: uuid,
    timeWindow: nullableUuid.describe("Assign the project to a Time Window.").optional(),
    area: nullableUuid.optional(),
    name: z.string().min(1).optional(),
    order: order.optional(),
    dueDate: isoDate.nullable().optional(),
    isInbox: z.never().optional(),
    completedAt: isoDateTime.nullable().optional(),
  })
  .strict();

const areaCreateInputSchema = z
  .object({
    id: nullableUuid.optional(),
    name: z.string().min(1),
    timeWindow: nullableUuid.describe("Assign the area to a Time Window.").optional(),
    color: hexColor.nullable().optional(),
    order: order.nullable().optional(),
    completedAt: isoDateTime.nullable().optional(),
  })
  .strict();

const areaUpdateInputSchema = z
  .object({
    id: uuid,
    name: z.string().min(1).optional(),
    timeWindow: nullableUuid.describe("Assign the area to a Time Window.").optional(),
    color: hexColor.optional(),
    order: order.optional(),
    completedAt: isoDateTime.nullable().optional(),
  })
  .strict();

const plannerCreateInputSchema = z
  .object({
    startTime: localTime,
    minutes: z.number().int().positive(),
    recurrenceRule: recurrenceRuleSchema,
    name: z.string().min(1).optional(),
    startDate: isoDate.nullable().optional(),
    order: order.nullable().optional(),
  })
  .strict();

const plannerUpdateInputSchema = z
  .object({
    id: uuid,
    startTime: localTime.nullable().optional(),
    minutes: z.number().int().positive().optional(),
    recurrenceRule: recurrenceRuleSchema.nullable().optional(),
    name: z.string().min(1).optional(),
    startDate: isoDate.nullable().optional(),
    order: z.never().optional(),
  })
  .strict();

const idInputSchema = z
  .object({
    id: uuid,
  })
  .strict();

const reorderInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid,
            order,
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const itemOutputSchema = {
  item: z.unknown(),
};

const actionOutputSchema = {
  result: z.unknown(),
};

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

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function parseDateTime(value: string): Date {
  return new Date(value);
}

function parseMaybeDate(value: string | null): Date | null {
  return value === null ? null : parseDate(value);
}

function parseMaybeDateTime(value: string | null): Date | null {
  return value === null ? null : parseDateTime(value);
}

function setIfPresent<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function toRecurrenceRule(
  value: z.infer<typeof recurrenceRuleSchema> | null | undefined
): RecurrenceRuleSchema | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const input: RecurrenceRuleSchema = {
    frequency: value.frequency as RecurrenceRuleSchema["frequency"],
  };
  setIfPresent(input, "byWeekday", value.byWeekday as RecurrenceRuleSchema["byWeekday"]);
  setIfPresent(input, "interval", value.interval);
  setIfPresent(input, "count", value.count);
  setIfPresent(input, "until", value.until === undefined ? undefined : parseMaybeDate(value.until));
  setIfPresent(input, "byMonth", value.byMonth);
  setIfPresent(input, "byWeekNumber", value.byWeekNumber);
  setIfPresent(input, "byYearDay", value.byYearDay);
  setIfPresent(input, "byMonthDay", value.byMonthDay);
  setIfPresent(input, "byDay", value.byDay);
  setIfPresent(input, "byHour", value.byHour);
  setIfPresent(input, "byMinute", value.byMinute);
  return input;
}

function toProjectIn(args: z.infer<typeof projectCreateInputSchema>): ProjectIn {
  const input: ProjectIn = { name: args.name };
  setIfPresent(input, "id", args.id);
  setIfPresent(input, "planner", args.timeWindow);
  setIfPresent(input, "area", args.area);
  setIfPresent(input, "order", args.order);
  setIfPresent(
    input,
    "dueDate",
    args.dueDate === undefined ? undefined : parseMaybeDate(args.dueDate)
  );
  setIfPresent(
    input,
    "completedAt",
    args.completedAt === undefined ? undefined : parseMaybeDateTime(args.completedAt)
  );
  return input;
}

function toProjectUpdateIn(args: z.infer<typeof projectUpdateInputSchema>): {
  id: string;
  input: ProjectUpdateIn;
} {
  const input: ProjectUpdateIn = {};
  setIfPresent(input, "planner", args.timeWindow);
  setIfPresent(input, "area", args.area);
  setIfPresent(input, "name", args.name);
  setIfPresent(input, "order", args.order);
  setIfPresent(
    input,
    "dueDate",
    args.dueDate === undefined ? undefined : parseMaybeDate(args.dueDate)
  );
  setIfPresent(
    input,
    "completedAt",
    args.completedAt === undefined ? undefined : parseMaybeDateTime(args.completedAt)
  );
  return { id: args.id, input };
}

function toAreaIn(args: z.infer<typeof areaCreateInputSchema>): AreaIn {
  const input: AreaIn = { name: args.name };
  setIfPresent(input, "id", args.id);
  setIfPresent(input, "planner", args.timeWindow);
  setIfPresent(input, "color", args.color);
  setIfPresent(input, "order", args.order);
  setIfPresent(
    input,
    "completedAt",
    args.completedAt === undefined ? undefined : parseMaybeDateTime(args.completedAt)
  );
  return input;
}

function toAreaUpdateIn(args: z.infer<typeof areaUpdateInputSchema>): {
  id: string;
  input: AreaUpdateIn;
} {
  const input: AreaUpdateIn = {};
  setIfPresent(input, "name", args.name);
  setIfPresent(input, "planner", args.timeWindow);
  setIfPresent(input, "color", args.color);
  setIfPresent(input, "order", args.order);
  setIfPresent(
    input,
    "completedAt",
    args.completedAt === undefined ? undefined : parseMaybeDateTime(args.completedAt)
  );
  return { id: args.id, input };
}

function toPlannerIn(args: z.infer<typeof plannerCreateInputSchema>): PlannerIn {
  const input: PlannerIn = {
    startTime: args.startTime,
    minutes: args.minutes,
    recurrenceRule: toRecurrenceRule(args.recurrenceRule) as RecurrenceRuleSchema,
  };
  setIfPresent(input, "name", args.name);
  setIfPresent(
    input,
    "startDate",
    args.startDate === undefined ? undefined : parseMaybeDate(args.startDate)
  );
  setIfPresent(input, "order", args.order);
  return input;
}

function toPlannerUpdateIn(args: z.infer<typeof plannerUpdateInputSchema>): {
  id: string;
  input: PlannerUpdateIn;
} {
  const input: PlannerUpdateIn = {};
  setIfPresent(input, "startTime", args.startTime);
  setIfPresent(input, "minutes", args.minutes);
  setIfPresent(input, "recurrenceRule", toRecurrenceRule(args.recurrenceRule));
  setIfPresent(input, "name", args.name);
  setIfPresent(
    input,
    "startDate",
    args.startDate === undefined ? undefined : parseMaybeDate(args.startDate)
  );
  return { id: args.id, input };
}

function toBulkReorderSchema(args: z.infer<typeof reorderInputSchema>): BulkReorderSchema {
  return { items: args.items };
}

function registerCreateUpdateDeleteTools(server: McpServer, client: AgendaApiClient): void {
  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create an AgendaCraft project. Requires agenda:write.",
      inputSchema: projectCreateInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => itemResult(await client.createProject(toProjectIn(args))))
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description: "Patch an AgendaCraft project by id. Requires agenda:write.",
      inputSchema: projectUpdateInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => {
      const { id, input } = toProjectUpdateIn(args);
      return withApiErrors(async () => itemResult(await client.updateProject(id, input)));
    }
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete project",
      description: "Delete an AgendaCraft project by id. Requires agenda:write.",
      inputSchema: idInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => {
        await client.deleteProject(args.id);
        return actionResult({ ok: true, id: args.id });
      })
  );

  server.registerTool(
    "create_area",
    {
      title: "Create area",
      description: "Create an AgendaCraft area. Requires agenda:write.",
      inputSchema: areaCreateInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => withApiErrors(async () => itemResult(await client.createArea(toAreaIn(args))))
  );

  server.registerTool(
    "update_area",
    {
      title: "Update area",
      description: "Patch an AgendaCraft area by id. Requires agenda:write.",
      inputSchema: areaUpdateInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => {
      const { id, input } = toAreaUpdateIn(args);
      return withApiErrors(async () => itemResult(await client.updateArea(id, input)));
    }
  );

  server.registerTool(
    "delete_area",
    {
      title: "Delete area",
      description: "Delete an AgendaCraft area by id. Requires agenda:write.",
      inputSchema: idInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => {
        await client.deleteArea(args.id);
        return actionResult({ ok: true, id: args.id });
      })
  );
}

function registerTimeWindowTools(server: McpServer, client: AgendaApiClient): void {
  const createTimeWindowHandler = async (args: z.infer<typeof plannerCreateInputSchema>) =>
    withApiErrors(async () => itemResult(await client.createPlanner(toPlannerIn(args))));
  const updateTimeWindowHandler = async (args: z.infer<typeof plannerUpdateInputSchema>) => {
    const { id, input } = toPlannerUpdateIn(args);
    return withApiErrors(async () => itemResult(await client.updatePlanner(id, input)));
  };
  const deleteTimeWindowHandler = async (args: z.infer<typeof idInputSchema>) =>
    withApiErrors(async () => {
      await client.deletePlanner(args.id);
      return actionResult({ ok: true, id: args.id });
    });
  const completeTimeWindowHandler = async (args: z.infer<typeof idInputSchema>) =>
    withApiErrors(async () => itemResult(await client.completePlanner(args.id)));
  const uncompleteTimeWindowHandler = async (args: z.infer<typeof idInputSchema>) =>
    withApiErrors(async () => itemResult(await client.uncompletePlanner(args.id)));

  server.registerTool(
    "create_time_window",
    {
      title: "Create time window",
      description: "Create an AgendaCraft Time Window. Requires agenda:write.",
      inputSchema: plannerCreateInputSchema,
      outputSchema: itemOutputSchema,
    },
    createTimeWindowHandler
  );

  server.registerTool(
    "update_time_window",
    {
      title: "Update time window",
      description:
        "Patch an AgendaCraft Time Window by id. Requires agenda:write. " +
        "System Time Window restrictions are enforced by agenda-service.",
      inputSchema: plannerUpdateInputSchema,
      outputSchema: itemOutputSchema,
    },
    updateTimeWindowHandler
  );

  server.registerTool(
    "delete_time_window",
    {
      title: "Delete time window",
      description:
        "Delete an AgendaCraft Time Window by id. Requires agenda:write. " +
        "System Time Window restrictions are enforced by agenda-service.",
      inputSchema: idInputSchema,
      outputSchema: actionOutputSchema,
    },
    deleteTimeWindowHandler
  );

  server.registerTool(
    "complete_time_window",
    {
      title: "Complete time window",
      description:
        "Mark an AgendaCraft Time Window complete. Requires agenda:write. " +
        "System Time Window restrictions are enforced by agenda-service.",
      inputSchema: idInputSchema,
      outputSchema: itemOutputSchema,
    },
    completeTimeWindowHandler
  );

  server.registerTool(
    "uncomplete_time_window",
    {
      title: "Uncomplete time window",
      description:
        "Mark an AgendaCraft Time Window incomplete. Requires agenda:write. " +
        "System Time Window restrictions are enforced by agenda-service.",
      inputSchema: idInputSchema,
      outputSchema: itemOutputSchema,
    },
    uncompleteTimeWindowHandler
  );
}

function registerReorderTools(server: McpServer, client: AgendaApiClient): void {
  server.registerTool(
    "reorder_projects",
    {
      title: "Reorder projects",
      description: "Bulk reorder AgendaCraft projects by id/order pairs. Requires agenda:write.",
      inputSchema: reorderInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () =>
        actionResult(await client.reorderProjects(toBulkReorderSchema(args)))
      )
  );

  server.registerTool(
    "reorder_areas",
    {
      title: "Reorder areas",
      description: "Bulk reorder AgendaCraft areas by id/order pairs. Requires agenda:write.",
      inputSchema: reorderInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => actionResult(await client.reorderAreas(toBulkReorderSchema(args))))
  );

  server.registerTool(
    "reorder_time_windows",
    {
      title: "Reorder time windows",
      description:
        "Bulk reorder AgendaCraft Time Windows by id/order pairs. Requires agenda:write.",
      inputSchema: reorderInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () =>
        actionResult(await client.reorderPlanners(toBulkReorderSchema(args)))
      )
  );
}

export function registerStructureWriteTools(server: McpServer, client: AgendaApiClient): void {
  registerCreateUpdateDeleteTools(server, client);
  registerTimeWindowTools(server, client);
  registerReorderTools(server, client);
}
