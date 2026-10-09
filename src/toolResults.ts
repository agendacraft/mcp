import { ResponseError } from "./api/index";

import {
  toMcpSurfaceErrorBody,
  toMcpSurfaceErrorStatusText,
  toMcpSurfaceValue,
} from "./mcpSurface";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export type ToolResult =
  | ReturnType<typeof listResult>
  | ReturnType<typeof itemResult>
  | ReturnType<typeof actionResult>
  | Awaited<ReturnType<typeof apiErrorResult>>;

function toJsonValue(value: unknown): JsonValue {
  return toMcpSurfaceValue(JSON.parse(JSON.stringify(value))) as JsonValue;
}

export function toJsonObject(value: unknown): JsonObject {
  const parsed = toJsonValue(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("MCP structured content must be a JSON object");
  }
  return parsed;
}

function jsonText(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

export function listResult(items: unknown[]) {
  const payload = toJsonObject({ count: items.length, items });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

export function itemResult(item: unknown) {
  const payload = toJsonObject({ item });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

export function actionResult(result: unknown = { ok: true }) {
  const payload = toJsonObject({ result });
  return {
    content: [{ type: "text" as const, text: jsonText(payload) }],
    structuredContent: payload,
  };
}

export async function apiErrorResult(error: unknown) {
  const details =
    error instanceof ResponseError
      ? {
          status: error.response.status,
          statusText: toMcpSurfaceErrorStatusText(error.response.statusText),
          body: toMcpSurfaceErrorBody(await error.response.clone().text()),
        }
      : {
          status: null,
          statusText: "Tool error",
          body: toMcpSurfaceErrorBody(error instanceof Error ? error.message : String(error)),
        };
  const payload = toJsonObject({
    error: details,
  });
  return {
    isError: true,
    content: [{ type: "text" as const, text: jsonText(payload) }],
  };
}

export async function withApiErrors(operation: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await operation();
  } catch (error) {
    return apiErrorResult(error);
  }
}
