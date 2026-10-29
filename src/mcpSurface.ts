/**
 * Translate agenda-service's internal Planner terminology to the public MCP
 * Time Window surface for result bodies and API error payloads.
 */
const plannerFieldMap: Readonly<Record<string, string>> = {
  planner: "timeWindow",
  plannerId: "timeWindowId",
  planner_id: "timeWindowId",
  plannerName: "timeWindowName",
  planner_name: "timeWindowName",
  plannerType: "timeWindowType",
  planner_type: "timeWindowType",
  effectivePlanner: "effectiveTimeWindow",
  effective_planner: "effectiveTimeWindow",
};

const plannerTextReplacements: readonly [RegExp, string][] = [
  [/\beffectivePlanner\b/g, "effectiveTimeWindow"],
  [/\beffective_planner\b/g, "effectiveTimeWindow"],
  [/\bplannerId\b/g, "timeWindowId"],
  [/\bplanner_id\b/g, "timeWindowId"],
  [/\bplannerName\b/g, "timeWindowName"],
  [/\bplanner_name\b/g, "timeWindowName"],
  [/\bplannerType\b/g, "timeWindowType"],
  [/\bplanner_type\b/g, "timeWindowType"],
  [/\bPlanners\b/g, "Time Windows"],
  [/\bplanners\b/g, "Time Windows"],
  [/\bPlanner\b/g, "Time Window"],
  [/\bplanner\b/g, "Time Window"],
];

export function toMcpSurfaceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toMcpSurfaceValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      plannerFieldMap[key] ?? key,
      toMcpSurfaceValue(entry),
    ])
  );
}

function toMcpSurfaceErrorText(value: string): string {
  return plannerTextReplacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}

function toMcpSurfaceErrorValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toMcpSurfaceErrorValue);
  }
  if (typeof value === "string") {
    return toMcpSurfaceErrorText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      plannerFieldMap[key] ?? key,
      toMcpSurfaceErrorValue(entry),
    ])
  );
}

export function toMcpSurfaceErrorBody(body: string): string {
  try {
    return JSON.stringify(toMcpSurfaceErrorValue(JSON.parse(body)));
  } catch {
    return toMcpSurfaceErrorText(body);
  }
}

export function toMcpSurfaceErrorStatusText(statusText: string): string {
  return toMcpSurfaceErrorText(statusText);
}
