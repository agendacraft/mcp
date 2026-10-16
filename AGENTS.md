# AgendaCraft MCP agent guidance

Standalone TypeScript MCP CLI over AgendaCraft's HTTP API. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for commands, test style, contract regeneration, and DCO. [README.md](README.md) owns user setup;
[SECURITY.md](SECURITY.md) owns vulnerability reporting.

- Use the generated client in `src/api/`, never backend internals or handwritten model mirrors.
  Its source is the approved `openapi/schema.json`; regenerate with `pnpm generate:api`.
- Keep each tool a thin API adapter. API `Planner` names map to Time Window MCP names.
- OAuth is Authorization Code + PKCE. Stdio uses the public client; HTTP introspection is
  operator-only. Never broaden granular scopes or expose introspection credentials.
- Preserve startup configuration validation, explicit request timeouts, bounded 429 backoff, and
  shared `withApiErrors` error envelopes. Stdout belongs to stdio protocol traffic; logs use stderr.
- Keep only the three date-helper dependency closures in `src/datetime/`.
- Tests use synthetic HTTP fixtures and the official SDK. Public CI needs no production account.
- The bundle must run with Node 24 and no installed runtime npm dependencies. Source maps are off;
  `scripts/test-pack.mjs` verifies the package allowlist and isolated stdio/HTTP flows.
- This repository owns the MCP runtime and approved public contract. Private deployment and real
  backend integration tests remain outside this repository.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
