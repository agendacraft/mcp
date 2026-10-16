/**
 * Authenticated agenda-service client, built on the generated
 * `./api/index`.
 *
 * The generated client supplies the OAuth bearer token and typed camelCase models.
 * Its fetch adapter applies bounded `429`/`Retry-After` backoff and audit logging
 * before the generated response handling, so discarded response bodies can be
 * cancelled without creating unread response clones.
 *
 * This is the adapter boundary for agenda-service names: the generated client
 * still exposes Planner models and endpoint parameters, while the MCP surface
 * maps those fields to Time Window terminology before returning data to hosts.
 */

import {
  AuthApi,
  Configuration,
  PlanningApi,
  SyncApi,
  type AreaOut,
  type AreaIn,
  type AreaUpdateIn,
  type BulkReorderResponseSchema,
  type BulkReorderSchema,
  type ListAreasRequest,
  type ListPlannerBlocksRequest,
  type ListPlannersRequest,
  type ListProjectsRequest,
  type ListTasksRequest,
  type PlannerBlockOut,
  type PlannerIn,
  type PlannerOut,
  type PlannerUpdateIn,
  type ProjectIn,
  type ProjectOut,
  type ProjectUpdateIn,
  type SyncResponse,
  type SyncTasksRequest,
  type TaskIn,
  type TaskOut,
  type TaskUpdateIn,
  type UserOut,
} from "./api/index";

import { parseRetryAfterMs } from "./retryAfter";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

export interface AuditEntry {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly durationMs: number | null;
}

export interface AgendaApiClient {
  /** Return the authenticated user from `GET /api/v1/auth/me`. */
  getMe(): Promise<UserOut>;
  /** Return tasks from `GET /api/v1/tasks/` using agenda-service filters. */
  listTasks(filters: ListTasksRequest): Promise<TaskOut[]>;
  /** Return one task from `GET /api/v1/tasks/{task_id}`. */
  getTask(taskId: string): Promise<TaskOut>;
  /** Return projects from `GET /api/v1/projects/` using agenda-service filters. */
  listProjects(filters: ListProjectsRequest): Promise<ProjectOut[]>;
  /** Return one project from `GET /api/v1/projects/{project_id}`. */
  getProject(projectId: string): Promise<ProjectOut>;
  /** Return areas from `GET /api/v1/areas/` using agenda-service filters. */
  listAreas(filters: ListAreasRequest): Promise<AreaOut[]>;
  /** Return one area from `GET /api/v1/areas/{area_id}`. */
  getArea(areaId: string): Promise<AreaOut>;
  /** Return planners from `GET /api/v1/planners/` using agenda-service filters. */
  listPlanners(filters: ListPlannersRequest): Promise<PlannerOut[]>;
  /** Return one planner from `GET /api/v1/planners/{planner_id}`. */
  getPlanner(plannerId: string): Promise<PlannerOut>;
  /** Return planner blocks from `GET /api/v1/planner-blocks/` for a date range. */
  listPlannerBlocks(filters: ListPlannerBlocksRequest): Promise<PlannerBlockOut[]>;
  /** Return sync invalidation data from `GET /api/v1/sync/`. */
  syncAgenda(filters: SyncTasksRequest): Promise<SyncResponse>;
  /** Create a task via `POST /api/v1/tasks/`. */
  createTask(input: TaskIn): Promise<TaskOut>;
  /** Patch a task via `PATCH /api/v1/tasks/{task_id}`. */
  updateTask(taskId: string, input: TaskUpdateIn): Promise<TaskOut>;
  /** Mark a task complete via the task-completion endpoint. */
  completeTask(taskId: string): Promise<TaskOut>;
  /** Delete a task via `DELETE /api/v1/tasks/{task_id}`. */
  deleteTask(taskId: string): Promise<void>;
  /** Bulk-reorder tasks via `POST /api/v1/tasks/reorder`. */
  reorderTasks(input: BulkReorderSchema): Promise<BulkReorderResponseSchema>;
  createProject(input: ProjectIn): Promise<ProjectOut>;
  updateProject(projectId: string, input: ProjectUpdateIn): Promise<ProjectOut>;
  deleteProject(projectId: string): Promise<void>;
  reorderProjects(input: BulkReorderSchema): Promise<BulkReorderResponseSchema>;
  createArea(input: AreaIn): Promise<AreaOut>;
  updateArea(areaId: string, input: AreaUpdateIn): Promise<AreaOut>;
  deleteArea(areaId: string): Promise<void>;
  reorderAreas(input: BulkReorderSchema): Promise<BulkReorderResponseSchema>;
  createPlanner(input: PlannerIn): Promise<PlannerOut>;
  updatePlanner(plannerId: string, input: PlannerUpdateIn): Promise<PlannerOut>;
  deletePlanner(plannerId: string): Promise<void>;
  reorderPlanners(input: BulkReorderSchema): Promise<BulkReorderResponseSchema>;
  completePlanner(plannerId: string): Promise<PlannerOut>;
  uncompletePlanner(plannerId: string): Promise<PlannerOut>;
}

export interface CreateAgendaClientOptions {
  readonly baseUrl: string;
  readonly accessTokenProvider: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxRetryDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly audit?: (entry: AuditEntry) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function auditUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "[invalid-url]";
  }
}

function defaultAudit(entry: AuditEntry): void {
  const suffix = entry.durationMs === null ? "" : ` (${entry.durationMs}ms)`;
  process.stderr.write(`[agenda-mcp] ${entry.method} ${entry.url} -> ${entry.status}${suffix}\n`);
}

function withTimeout(base: typeof fetch, timeoutMs: number): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return base(input, { ...init, signal });
  }) as typeof fetch;
}

interface RetryAuditDeps {
  readonly fetchImpl: typeof fetch;
  readonly maxRetries: number;
  readonly maxRetryDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly audit: (entry: AuditEntry) => void;
}

function createRetryAuditedFetch(deps: RetryAuditDeps): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const start = deps.now();
    let response = await deps.fetchImpl(input, init);
    let attempt = 0;
    while (response.status === 429 && attempt < deps.maxRetries) {
      const delayMs = Math.min(
        parseRetryAfterMs(response.headers.get("retry-after"), deps.maxRetryDelayMs, deps.now()),
        deps.maxRetryDelayMs
      );
      void response.body?.cancel().catch(() => undefined);
      await deps.sleep(delayMs);
      attempt += 1;
      response = await deps.fetchImpl(input, init);
    }
    deps.audit({
      method: init?.method ?? "GET",
      url: auditUrl(String(input)),
      status: response.status,
      durationMs: deps.now() - start,
    });
    return response;
  }) as typeof fetch;
}

/** Build an {@link AgendaApiClient} bound to an OAuth access-token provider. */
export function createAgendaClient(options: CreateAgendaClientOptions): AgendaApiClient {
  const baseFetch = options.fetchImpl ?? fetch;
  const effectiveFetch =
    options.requestTimeoutMs !== undefined
      ? withTimeout(baseFetch, options.requestTimeoutMs)
      : baseFetch;

  const auditedFetch = createRetryAuditedFetch({
    fetchImpl: effectiveFetch,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    maxRetryDelayMs: options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    sleep: options.sleep ?? defaultSleep,
    now: options.now ?? Date.now,
    audit: options.audit ?? defaultAudit,
  });

  const configuration = new Configuration({
    basePath: options.baseUrl,
    accessToken: async () => options.accessTokenProvider(),
    fetchApi: auditedFetch,
  });

  const authApi = new AuthApi(configuration);
  const planningApi = new PlanningApi(configuration);
  const syncApi = new SyncApi(configuration);
  return {
    getMe: () => authApi.getMyUser(),
    listTasks: (filters) => planningApi.listTasks(filters),
    getTask: (taskId) => planningApi.getTask({ taskId }),
    listProjects: (filters) => planningApi.listProjects(filters),
    getProject: (projectId) => planningApi.getProject({ projectId }),
    listAreas: (filters) => planningApi.listAreas(filters),
    getArea: (areaId) => planningApi.getArea({ areaId }),
    listPlanners: (filters) => planningApi.listPlanners(filters),
    getPlanner: (plannerId) => planningApi.getPlanner({ plannerId }),
    listPlannerBlocks: (filters) => planningApi.listPlannerBlocks(filters),
    syncAgenda: (filters) => syncApi.syncTasks(filters),
    createTask: (taskIn) => planningApi.createTask({ taskIn }),
    updateTask: (taskId, taskUpdateIn) => planningApi.updateTask({ taskId, taskUpdateIn }),
    completeTask: (taskId) => planningApi.completeTask({ taskId }),
    deleteTask: (taskId) => planningApi.deleteTask({ taskId }),
    reorderTasks: (bulkReorderSchema) => planningApi.reorderTasks({ bulkReorderSchema }),
    createProject: (projectIn) => planningApi.createProject({ projectIn }),
    updateProject: (projectId, projectUpdateIn) =>
      planningApi.updateProject({ projectId, projectUpdateIn }),
    deleteProject: (projectId) => planningApi.deleteProject({ projectId }),
    reorderProjects: (bulkReorderSchema) => planningApi.reorderProjects({ bulkReorderSchema }),
    createArea: (areaIn) => planningApi.createArea({ areaIn }),
    updateArea: (areaId, areaUpdateIn) => planningApi.updateArea({ areaId, areaUpdateIn }),
    deleteArea: (areaId) => planningApi.deleteArea({ areaId }),
    reorderAreas: (bulkReorderSchema) => planningApi.reorderAreas({ bulkReorderSchema }),
    createPlanner: (plannerIn) => planningApi.createPlanner({ plannerIn }),
    updatePlanner: (plannerId, plannerUpdateIn) =>
      planningApi.updatePlanner({ plannerId, plannerUpdateIn }),
    deletePlanner: (plannerId) => planningApi.deletePlanner({ plannerId }),
    reorderPlanners: (bulkReorderSchema) => planningApi.reorderPlanners({ bulkReorderSchema }),
    completePlanner: (plannerId) => planningApi.completePlanner({ plannerId }),
    uncompletePlanner: (plannerId) => planningApi.uncompletePlanner({ plannerId }),
  };
}
