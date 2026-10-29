/**
 * The AgendaCraft MCP server and the `whoami` health tool.
 *
 * The server is intentionally thin: each tool is a pass-through to the
 * agenda-service HTTP API (via the generated client), so the MCP server holds no
 * business logic and inherits the API's principal-scoped, scope-enforced auth
 * boundary.
 */

import packageJson from "../package.json";

import { getEffectiveTimezone } from "./datetime/index";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AgendaApiClient } from "./apiClient";
import {
  registerProfileResource,
  type RegisterReadToolsOptions,
  registerReadTools,
} from "./readTools";
import { registerStructureWriteTools } from "./structureWriteTools";
import { registerTaskWriteTools } from "./taskWriteTools";
import { withApiErrors } from "./toolResults";

export const SERVER_NAME = "AgendaCraft";
export const SERVER_VERSION = packageJson.version;

const PROFILE_READ_SCOPE = "profile:read";
const AGENDA_READ_SCOPE = "agenda:read";
const AGENDA_WRITE_SCOPE = "agenda:write";

export interface CreateMcpServerOptions extends RegisterReadToolsOptions {
  /** OAuth scopes granted to this connection; omit to preserve the full local stdio surface. */
  readonly grantedScopes?: readonly string[];
}

const whoamiOutputSchema = {
  id: z.string(),
  email: z.string(),
  username: z.string(),
  displayName: z.string(),
  timezone: z.string(),
  timeFormat: z.string().nullable(),
};

function hasGrantedScope(options: CreateMcpServerOptions, scope: string): boolean {
  return options.grantedScopes === undefined || options.grantedScopes.includes(scope);
}

/**
 * Build the AgendaCraft MCP server bound to an authenticated API client.
 *
 * When granted scopes are supplied, only the matching profile, agenda read, and agenda write
 * surfaces are registered. Omitting granted scopes preserves the full local stdio surface.
 * Agenda resources require both `agenda:read` and `profile:read`; callers can still explicitly
 * disable them with `includeAgendaResources: false`.
 */
export function createMcpServer(
  client: AgendaApiClient,
  options: CreateMcpServerOptions = {}
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  if (hasGrantedScope(options, PROFILE_READ_SCOPE)) {
    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description:
          "Identify the authenticated AgendaCraft user. Returns the profile from " +
          "GET /api/v1/auth/me (id, email, username, display name, account timezone). " +
          "Use this as a health check that the MCP connection and OAuth login are wired " +
          "up before invoking domain tools.",
        outputSchema: whoamiOutputSchema,
      },
      async () =>
        withApiErrors(async () => {
          const user = await client.getMe();
          const profile = {
            id: user.id,
            email: user.email,
            username: user.username,
            displayName: `${user.givenName} ${user.familyName}`.trim(),
            timezone: getEffectiveTimezone(user.settings.timezone),
            timeFormat: user.settings.timeFormat ?? null,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }],
            structuredContent: profile,
          };
        })
    );
    registerProfileResource(server, client);
  }

  if (hasGrantedScope(options, AGENDA_READ_SCOPE)) {
    registerReadTools(server, client, {
      ...options,
      includeSyncTools: options.includeSyncTools ?? options.grantedScopes === undefined,
      includeAgendaResources:
        hasGrantedScope(options, PROFILE_READ_SCOPE) && options.includeAgendaResources !== false,
    });
  }
  if (hasGrantedScope(options, AGENDA_WRITE_SCOPE)) {
    registerTaskWriteTools(server, client);
    registerStructureWriteTools(server, client);
  }

  return server;
}
