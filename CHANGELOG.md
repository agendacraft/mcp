# Changelog

## 0.1.0 (unreleased)

- Initial standalone MCP server, approved API contract, and minimal date helpers.
- Local OAuth stdio and operator-managed hosted HTTP transports.
- Reject credential-bearing base URLs during startup and preserve registered introspection credentials exactly.
- Coordinate logout with token refresh so an in-flight refresh cannot restore cleared credentials.
