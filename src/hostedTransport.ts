import type { Server } from "node:http";

import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, NextFunction, Request, Response } from "express";

import { createAgendaClient, type AgendaApiClient } from "./apiClient";
import { type HostedSettings, metadataUrl } from "./config";
import { createMcpServer } from "./server";
import {
  HostedAuthError,
  introspectBearerToken,
  parseBearerAuthHeader,
  requireScopes,
} from "./hostedAuth";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

const MCP_PATH = "/mcp";
const AGENDA_READ_SCOPE = "agenda:read";
const AGENDA_WRITE_SCOPE = "agenda:write";
const PROFILE_READ_SCOPE = "profile:read";

type FetchLike = typeof fetch;

interface HostedAppDeps {
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  readonly audit?: (message: string) => void;
}

function authChallenge(settings: HostedSettings): string {
  const metadataUrlValue = getOAuthProtectedResourceMetadataUrl(new URL(settings.resource));
  return `Bearer resource_metadata="${metadataUrlValue}"`;
}

function jsonError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code: status === 401 || status === 403 ? -32001 : -32603,
      message,
    },
    id: null,
  });
}

function applyCors(req: Request, res: Response, settings: HostedSettings): boolean {
  const origin = req.header("origin");
  if (origin === undefined) {
    return true;
  }
  if (!settings.allowedOrigins.includes(origin)) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id"
  );
  res.setHeader("Access-Control-Expose-Headers", "Retry-After, WWW-Authenticate, MCP-Session-Id");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  return true;
}

function isOAuthMetadataPath(path: string): boolean {
  return (
    path === "/.well-known/oauth-protected-resource" ||
    path.startsWith("/.well-known/oauth-protected-resource/") ||
    path === "/.well-known/oauth-authorization-server" ||
    path.startsWith("/.well-known/oauth-authorization-server/")
  );
}

async function fetchOAuthMetadata(
  settings: HostedSettings,
  fetchImpl: FetchLike = fetch
): Promise<OAuthMetadata> {
  const response = await fetchImpl(
    metadataUrl({ ...settings, agendaServiceUrl: settings.authorizationServerUrl }),
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
    }
  );
  if (response.status !== 200) {
    throw new Error(`OAuth metadata discovery returned ${response.status}.`);
  }
  return (await response.json()) as OAuthMetadata;
}

function withScopes(client: AgendaApiClient, authInfo: AuthInfo): AgendaApiClient {
  const read = () => requireScopes(authInfo, [AGENDA_READ_SCOPE]);
  const profile = () => requireScopes(authInfo, [PROFILE_READ_SCOPE]);
  const write = () => requireScopes(authInfo, [AGENDA_WRITE_SCOPE]);
  return {
    getMe: () => {
      profile();
      return client.getMe();
    },
    listTasks: (filters) => {
      read();
      return client.listTasks(filters);
    },
    getTask: (id) => {
      read();
      return client.getTask(id);
    },
    listProjects: (filters) => {
      read();
      return client.listProjects(filters);
    },
    getProject: (id) => {
      read();
      return client.getProject(id);
    },
    listAreas: (filters) => {
      read();
      return client.listAreas(filters);
    },
    getArea: (id) => {
      read();
      return client.getArea(id);
    },
    listPlanners: (filters) => {
      read();
      return client.listPlanners(filters);
    },
    getPlanner: (id) => {
      read();
      return client.getPlanner(id);
    },
    listPlannerBlocks: (filters) => {
      read();
      return client.listPlannerBlocks(filters);
    },
    syncAgenda: (filters) => {
      read();
      return client.syncAgenda(filters);
    },
    createTask: (input) => {
      write();
      return client.createTask(input);
    },
    updateTask: (id, input) => {
      write();
      return client.updateTask(id, input);
    },
    completeTask: (id) => {
      write();
      return client.completeTask(id);
    },
    deleteTask: (id) => {
      write();
      return client.deleteTask(id);
    },
    reorderTasks: (input) => {
      write();
      return client.reorderTasks(input);
    },
    createProject: (input) => {
      write();
      return client.createProject(input);
    },
    updateProject: (id, input) => {
      write();
      return client.updateProject(id, input);
    },
    deleteProject: (id) => {
      write();
      return client.deleteProject(id);
    },
    reorderProjects: (input) => {
      write();
      return client.reorderProjects(input);
    },
    createArea: (input) => {
      write();
      return client.createArea(input);
    },
    updateArea: (id, input) => {
      write();
      return client.updateArea(id, input);
    },
    deleteArea: (id) => {
      write();
      return client.deleteArea(id);
    },
    reorderAreas: (input) => {
      write();
      return client.reorderAreas(input);
    },
    createPlanner: (input) => {
      write();
      return client.createPlanner(input);
    },
    updatePlanner: (id, input) => {
      write();
      return client.updatePlanner(id, input);
    },
    deletePlanner: (id) => {
      write();
      return client.deletePlanner(id);
    },
    reorderPlanners: (input) => {
      write();
      return client.reorderPlanners(input);
    },
    completePlanner: (id) => {
      write();
      return client.completePlanner(id);
    },
    uncompletePlanner: (id) => {
      write();
      return client.uncompletePlanner(id);
    },
  };
}

async function authenticateRequest(
  req: Request,
  settings: HostedSettings,
  deps: HostedAppDeps
): Promise<AuthInfo> {
  const token = parseBearerAuthHeader(req.header("authorization"));
  return introspectBearerToken(token, {
    introspectionEndpoint: `${settings.agendaServiceUrl}/o/introspect/`,
    clientId: settings.introspectionClientId,
    clientSecret: settings.introspectionClientSecret,
    resource: settings.resource,
    timeoutMs: settings.requestTimeoutMs,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
}

function auditMessage(message: string, deps: HostedAppDeps): void {
  (deps.audit ?? ((line) => process.stderr.write(`${line}\n`)))(`[agenda-mcp] ${message}`);
}

export async function createHostedApp(
  settings: HostedSettings,
  deps: HostedAppDeps = {}
): Promise<Express> {
  const oauthMetadata = await fetchOAuthMetadata(settings, deps.fetchImpl);
  const app = createMcpExpressApp({
    host: settings.host,
    allowedHosts: [...settings.allowedHosts],
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isOAuthMetadataPath(req.path)) {
      next();
      return;
    }
    if (!applyCors(req, res, settings)) {
      jsonError(res, 403, "Origin is not allowed.");
      return;
    }
    const origin = req.header("origin");
    if (origin !== undefined) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => {
        if (name.toLowerCase() === "access-control-allow-origin") {
          return setHeader(name, origin);
        }
        return setHeader(name, value);
      };
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: new URL(settings.resource),
      scopesSupported: [AGENDA_READ_SCOPE, AGENDA_WRITE_SCOPE, PROFILE_READ_SCOPE],
      resourceName: "AgendaCraft MCP",
    })
  );

  app.options(MCP_PATH, (req, res) => {
    if (!applyCors(req, res, settings)) {
      jsonError(res, 403, "Origin is not allowed.");
      return;
    }
    res.status(204).end();
  });

  app.use(MCP_PATH, async (req: Request, res: Response, next: NextFunction) => {
    if (!applyCors(req, res, settings)) {
      jsonError(res, 403, "Origin is not allowed.");
      return;
    }
    try {
      req.auth = await authenticateRequest(req, settings, deps);
      next();
    } catch (error) {
      const status = error instanceof HostedAuthError ? error.status : 401;
      if (error instanceof HostedAuthError) {
        for (const [header, value] of Object.entries(error.headers)) {
          res.setHeader(header, value);
        }
      }
      if (status === 401 || status === 403) {
        res.setHeader("WWW-Authenticate", authChallenge(settings));
      }
      jsonError(res, status, error instanceof Error ? error.message : "Authentication failed.");
    }
  });

  app.post(MCP_PATH, async (req, res) => {
    const authInfo = req.auth;
    if (authInfo === undefined) {
      res.setHeader("WWW-Authenticate", authChallenge(settings));
      jsonError(res, 401, "Missing bearer token.");
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    const apiClient = createAgendaClient({
      baseUrl: settings.agendaServiceUrl,
      accessTokenProvider: async () => authInfo.token,
      requestTimeoutMs: settings.requestTimeoutMs,
    });
    const server = createMcpServer(withScopes(apiClient, authInfo), {
      grantedScopes: authInfo.scopes,
    });
    try {
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body);
      auditMessage(
        `mcp request client=${authInfo.clientId} scopes=${authInfo.scopes.join(",")}`,
        deps
      );
    } catch (error) {
      auditMessage(
        `mcp request failed: ${error instanceof Error ? error.message : String(error)}`,
        deps
      );
      if (!res.headersSent) {
        jsonError(res, 500, "Internal server error.");
      }
    } finally {
      await Promise.allSettled([transport.close(), server.close()]);
    }
  });

  app.get(MCP_PATH, (_req, res) => {
    res.status(405).json({ error: "Method not allowed." });
  });

  app.delete(MCP_PATH, (_req, res) => {
    res.status(405).json({ error: "Method not allowed." });
  });

  return app;
}

export async function serveHosted(
  settings: HostedSettings,
  deps: HostedAppDeps = {}
): Promise<Server> {
  const app = await createHostedApp(settings, deps);
  return new Promise((resolve, reject) => {
    const server = app.listen(settings.port, settings.host, () => {
      auditMessage(`HTTP MCP server listening on ${settings.host}:${settings.port}`, deps);
      resolve(server);
    });
    server.on("error", reject);
  });
}
