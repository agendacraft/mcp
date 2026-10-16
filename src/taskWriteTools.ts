import type { BulkReorderSchema, RecurrenceRuleIn, TaskIn, TaskUpdateIn } from "./api/index";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AgendaApiClient } from "./apiClient";
import { actionResult, itemResult, withApiErrors } from "./toolResults";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().refine(isIsoDate, "Expected a valid YYYY-MM-DD date");
const localTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected HH:MM or HH:MM:SS");
const recurrenceRuleSchema = z
  .object({
    frequency: z.string().min(1),
    interval: z.number().int().positive().optional(),
    byWeekday: z.array(z.string()).nullable().optional(),
    until: isoDate.nullable().optional(),
    count: z.number().int().positive().nullable().optional(),
    byMonth: z.string().nullable().optional(),
    byWeekNumber: z.string().nullable().optional(),
    byYearDay: z.string().nullable().optional(),
    byMonthDay: z.string().nullable().optional(),
    byDay: z.string().nullable().optional(),
    byHour: z.string().nullable().optional(),
    byMinute: z.string().nullable().optional(),
  })
  .strict();

const taskCreateInputSchema = z
  .object({
    id: nullableUuid.optional(),
    summary: z.string().min(1),
    description: z.string().nullable().optional(),
    domain: nullableUuid.optional(),
    projectId: nullableUuid.optional(),
    areaId: nullableUuid.optional(),
    targetAlias: z.literal("inbox").nullable().optional(),
    timeWindow: nullableUuid.describe("Assign the task to a Time Window.").optional(),
    priority: z.number().int().optional(),
    order: z.number().int().nullable().optional(),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    dueTime: localTime.nullable().optional(),
    startTime: isoDateTime.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    endTime: isoDateTime.nullable().optional(),
    timezone: z.string().min(1).nullable().optional(),
    recurrenceRule: recurrenceRuleSchema.nullable().optional(),
    minutes: z.number().int().nonnegative().optional(),
    completedAt: isoDateTime.nullable().optional(),
    localStartTime: localTime.nullable().optional(),
  })
  .strict();

const taskUpdateInputSchema = z
  .object({
    id: uuid,
    summary: z.string().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    domain: nullableUuid.optional(),
    timeWindow: nullableUuid.describe("Assign the task to a Time Window.").optional(),
    priority: z.number().int().nullable().optional(),
    minutes: z.number().int().nonnegative().nullable().optional(),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    dueTime: localTime.nullable().optional(),
    startTime: isoDateTime.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    endTime: isoDateTime.nullable().optional(),
    timezone: z.string().min(1).nullable().optional(),
    recurrenceRule: recurrenceRuleSchema.nullable().optional(),
    clearStartTime: z.boolean().optional(),
  })
  .strict();

const taskIdInputSchema = z
  .object({
    id: uuid,
  })
  .strict();

const reorderTasksInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: uuid,
            order: z.number().int().nonnegative(),
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

function setIfPresent<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function toTaskIn(args: z.infer<typeof taskCreateInputSchema>): TaskIn {
  const input: TaskIn = { summary: args.summary };
  setIfPresent(input, "id", args.id);
  setIfPresent(input, "description", args.description);
  setIfPresent(input, "domain", args.domain);
  setIfPresent(input, "projectId", args.projectId);
  setIfPresent(input, "areaId", args.areaId);
  setIfPresent(input, "targetAlias", args.targetAlias);
  setIfPresent(input, "planner", args.timeWindow);
  setIfPresent(input, "priority", args.priority);
  setIfPresent(input, "order", args.order);
  setIfPresent(
    input,
    "startDate",
    args.startDate === undefined ? undefined : parseMaybeDate(args.startDate)
  );
  setIfPresent(
    input,
    "dueDate",
    args.dueDate === undefined ? undefined : parseMaybeDate(args.dueDate)
  );
  setIfPresent(input, "dueTime", args.dueTime);
  setIfPresent(
    input,
    "startTime",
    args.startTime === undefined ? undefined : parseMaybeDateTime(args.startTime)
  );
  setIfPresent(
    input,
    "endDate",
    args.endDate === undefined ? undefined : parseMaybeDate(args.endDate)
  );
  setIfPresent(
    input,
    "endTime",
    args.endTime === undefined ? undefined : parseMaybeDateTime(args.endTime)
  );
  setIfPresent(input, "timezone", args.timezone);
  setIfPresent(input, "recurrenceRule", toRecurrenceRule(args.recurrenceRule));
  setIfPresent(input, "minutes", args.minutes);
  setIfPresent(
    input,
    "completedAt",
    args.completedAt === undefined ? undefined : parseMaybeDateTime(args.completedAt)
  );
  setIfPresent(input, "localStartTime", args.localStartTime);
  return input;
}

function toTaskUpdateIn(args: z.infer<typeof taskUpdateInputSchema>): {
  taskId: string;
  input: TaskUpdateIn;
} {
  const input: TaskUpdateIn = {};
  setIfPresent(input, "summary", args.summary);
  setIfPresent(input, "description", args.description);
  setIfPresent(input, "domain", args.domain);
  setIfPresent(input, "planner", args.timeWindow);
  setIfPresent(input, "priority", args.priority);
  setIfPresent(input, "minutes", args.minutes);
  setIfPresent(
    input,
    "startDate",
    args.startDate === undefined ? undefined : parseMaybeDate(args.startDate)
  );
  setIfPresent(
    input,
    "dueDate",
    args.dueDate === undefined ? undefined : parseMaybeDate(args.dueDate)
  );
  setIfPresent(input, "dueTime", args.dueTime);
  setIfPresent(
    input,
    "startTime",
    args.startTime === undefined ? undefined : parseMaybeDateTime(args.startTime)
  );
  setIfPresent(
    input,
    "endDate",
    args.endDate === undefined ? undefined : parseMaybeDate(args.endDate)
  );
  setIfPresent(
    input,
    "endTime",
    args.endTime === undefined ? undefined : parseMaybeDateTime(args.endTime)
  );
  setIfPresent(input, "timezone", args.timezone);
  setIfPresent(input, "recurrenceRule", toRecurrenceRule(args.recurrenceRule));
  setIfPresent(input, "clearStartTime", args.clearStartTime);
  return { taskId: args.id, input };
}

function parseMaybeDate(value: string | null): Date | null {
  return value === null ? null : parseDate(value);
}

function parseMaybeDateTime(value: string | null): Date | null {
  return value === null ? null : parseDateTime(value);
}

function toRecurrenceRule(
  value: z.infer<typeof recurrenceRuleSchema> | null | undefined
): RecurrenceRuleIn | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const input: RecurrenceRuleIn = { frequency: value.frequency };
  setIfPresent(input, "interval", value.interval);
  setIfPresent(input, "byWeekday", value.byWeekday);
  setIfPresent(input, "until", value.until === undefined ? undefined : parseMaybeDate(value.until));
  setIfPresent(input, "count", value.count);
  setIfPresent(input, "byMonth", value.byMonth);
  setIfPresent(input, "byWeekNumber", value.byWeekNumber);
  setIfPresent(input, "byYearDay", value.byYearDay);
  setIfPresent(input, "byMonthDay", value.byMonthDay);
  setIfPresent(input, "byDay", value.byDay);
  setIfPresent(input, "byHour", value.byHour);
  setIfPresent(input, "byMinute", value.byMinute);
  return input;
}

function toBulkReorderSchema(args: z.infer<typeof reorderTasksInputSchema>): BulkReorderSchema {
  return { items: args.items };
}

export function registerTaskWriteTools(server: McpServer, client: AgendaApiClient): void {
  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create an AgendaCraft task. Requires an OAuth token with agenda:write. " +
        "Task writes may trigger backend auto-scheduling; explicit plan preview/commit is not part of this tool.",
      inputSchema: taskCreateInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => withApiErrors(async () => itemResult(await client.createTask(toTaskIn(args))))
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Patch an AgendaCraft task by id. Requires agenda:write. Send explicit nulls only for fields " +
        "the backend supports clearing; omit fields to leave them unchanged.",
      inputSchema: taskUpdateInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => {
      return withApiErrors(async () => {
        const { taskId, input } = toTaskUpdateIn(args);
        return itemResult(await client.updateTask(taskId, input));
      });
    }
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description: "Mark an AgendaCraft task complete. Requires agenda:write.",
      inputSchema: taskIdInputSchema,
      outputSchema: itemOutputSchema,
    },
    async (args) => withApiErrors(async () => itemResult(await client.completeTask(args.id)))
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description: "Delete an AgendaCraft task by id. Requires agenda:write.",
      inputSchema: taskIdInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => {
        await client.deleteTask(args.id);
        return actionResult({ ok: true, id: args.id });
      })
  );

  server.registerTool(
    "reorder_tasks",
    {
      title: "Reorder tasks",
      description:
        "Bulk reorder AgendaCraft tasks by id/order pairs. Requires agenda:write. " +
        "Pass backend-valid sparse in-range order values; the tool does not renumber them.",
      inputSchema: reorderTasksInputSchema,
      outputSchema: actionOutputSchema,
    },
    async (args) =>
      withApiErrors(async () => actionResult(await client.reorderTasks(toBulkReorderSchema(args))))
  );
}
