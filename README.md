# AgendaCraft MCP

Connect an MCP host to your AgendaCraft calendar and tasks through the AgendaCraft HTTP API.
The server exposes profile and agenda reads, task writes, and project, area, and Time Window
management. OAuth scopes control the tools and resources available to each connection.

**Pre-release:** `@agendacraft/mcp` is not yet published to npm. Use a source checkout for now.
The `npx` installation commands below will work after the first release.

## Requirements

- Node.js 24 or later.
- An AgendaCraft account with access to the hosted API at `https://api.agendacraft.ai`.
- An MCP host that supports local stdio or the hosted Streamable HTTP connector.

The backend is a hosted service. Its source and deployment infrastructure are not included here.
The MIT software license does not grant hosted-service access or rights to AgendaCraft trademarks.

## Local stdio

From a checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
AGENDA_SERVICE_URL=https://api.agendacraft.ai node dist/index.js login
```

Login opens your browser for Authorization Code + PKCE and explicit consent. No client secret is
needed. Once a package release is available, the equivalent command will be:

```sh
AGENDA_SERVICE_URL=https://api.agendacraft.ai npx -y @agendacraft/mcp login
```

Point your MCP host at the bundled CLI:

```json
{
  "mcpServers": {
    "agendacraft": {
      "command": "node",
      "args": ["/path/to/mcp/dist/index.js"],
      "env": {
        "AGENDA_SERVICE_URL": "https://api.agendacraft.ai"
      }
    }
  }
}
```

After the first npm release, hosts can use `"command": "npx"` with
`"args": ["-y", "@agendacraft/mcp"]`. The branded executable aliases are `agenda-mcp` and
`agendacraft-mcp`; the `mcp` alias is retained for compatibility.

The default command, `serve`, and `stdio` all start stdio transport. Protocol traffic goes to
stdout; CLI messages and audit logs go to stderr. `whoami` verifies the profile connection.
Agenda reads include tasks, projects, areas, Time Windows, and Time Window blocks. Write tools
create, update, delete, reorder, and complete tasks and manage projects, areas, and Time Windows.
Profile and agenda resources are JSON. Time Windows use `time_window` tool names; API `Planner`
names remain inside the adapter. Sync tools are available when explicitly enabled by an operator.

### Consent and credentials

The default scopes are `agenda:read agenda:write profile:read`. For a read-only connection, set
`AGENDA_MCP_OAUTH_SCOPES="agenda:read profile:read"` during login. Reauthenticate when changing
scopes. Personal API keys are not supported by this CLI.

OAuth access and refresh tokens are stored as plaintext in an owner-only (`0600`) file at
`$XDG_CONFIG_HOME/agenda-mcp/token.json`, or `~/.config/agenda-mcp/token.json` when XDG is unset.
Keep this file out of version control, cloud sharing, bug reports, and logs. The token file's
parent directory should also be private to your user. Override its location with
`AGENDA_MCP_TOKEN_PATH` when needed.

```sh
node dist/index.js logout
```

Logout removes the local token cache. To revoke previously granted remote access, use the
account's authorization controls or contact AgendaCraft service support. A token cache from an
older version without recorded scopes requires a fresh login. Expired access tokens refresh
silently when a valid refresh token is available. Discovered stdio OAuth endpoints require HTTPS;
HTTP is permitted only for `localhost`, `127.0.0.1`, and `[::1]` development endpoints.
Refreshes coordinate across CLI processes sharing
the same local token file, and token updates are saved atomically. Keep its adjacent `.lock`
directory in place while any process is running; abandoned locks expire after their heartbeat stops.

### Configuration

| Variable                     | Default / purpose                                                             |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `AGENDA_SERVICE_URL`         | Required API origin. Use `https://api.agendacraft.ai` for the hosted service. |
| `AGENDA_MCP_OAUTH_CLIENT_ID` | Public client identifier `agendacraft-mcp`.                                   |
| `AGENDA_MCP_OAUTH_SCOPES`    | `agenda:read agenda:write profile:read`.                                      |
| `AGENDA_MCP_REQUEST_TIMEOUT` | Request timeout in seconds, default `30`.                                     |
| `AGENDA_MCP_TOKEN_PATH`      | Optional token-file override.                                                 |

Requests have explicit timeouts. The client retries `429` responses with bounded `Retry-After`
backoff; other API errors use the shared MCP error envelope. A missing service URL fails at
startup. Authentication failures usually require login again. Never paste tokens or unredacted
request URLs into an issue.

## Hosted connector

To connect to AgendaCraft's managed HTTP gateway, enter `https://mcp.agendacraft.ai/mcp` in your
MCP host. Follow protected-resource discovery, then the discovered authorization server's
registration endpoint and OAuth consent flow. The CLI itself uses a stable public OAuth client
and does not perform dynamic client registration.

### Operator-only self-hosted HTTP mode

The `http` command is included for approved operators. Running your own gateway against hosted
AgendaCraft requires confidential introspection credentials and backend resource allowlisting.
Public OAuth registration does not supply those credentials or grant that operator access.

Operators configure `AGENDA_MCP_INTROSPECTION_CLIENT_ID` and
`AGENDA_MCP_INTROSPECTION_CLIENT_SECRET` securely, plus `AGENDA_SERVICE_URL`. Additional settings:

| Variable                              | Default / purpose                                                     |
| ------------------------------------- | --------------------------------------------------------------------- |
| `AGENDA_MCP_HOST`                     | Bind address, `127.0.0.1`.                                            |
| `AGENDA_MCP_PORT`                     | Port, `8001`; falls back to `PORT`.                                   |
| `AGENDA_MCP_PUBLIC_URL`               | External HTTPS origin, without `/mcp`.                                |
| `AGENDA_MCP_RESOURCE`                 | Exact external connector URL; defaults to public origin plus `/mcp`.  |
| `AGENDA_MCP_AUTHORIZATION_SERVER_URL` | Discovery base; defaults to service URL.                              |
| `AGENDA_MCP_ALLOWED_HOSTS`            | Comma-separated host allowlist, derived from public URL by default.   |
| `AGENDA_MCP_ALLOWED_ORIGINS`          | Comma-separated origin allowlist, derived from public URL by default. |

The discovery base may use internal HTTP, but advertised issuer and OAuth endpoints must be
HTTPS. `/health` exposes process health; `/mcp` requires a user bearer token. Introspection checks
activity, expiry, client, scopes, and any supplied audience. Tokens without an explicit audience
are accepted for compatibility; mismatched audiences are rejected. Operators must configure the
backend's allowed forwarding resource to match the external connector URL.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for standalone setup, behavioral testing, contract
regeneration, and DCO sign-off. [AGENTS.md](AGENTS.md) describes architectural constraints.
Report vulnerabilities through the private channel in [SECURITY.md](SECURITY.md).

This repository owns the MCP runtime, its approved API contract snapshot, and the minimal date
helpers. Contract changes must preserve wire compatibility and pass the contributor checks.
The private backend integration harness is maintained separately and is not required for public CI.
