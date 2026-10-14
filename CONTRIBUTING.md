# Contributing

Use Node.js 24 and pnpm 11.2.2. Toolchain versions are pinned in `mise.toml` and `package.json`.
Ordinary development needs no production credentials or private backend checkout.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm type-check
pnpm lint
pnpm format:check
pnpm build
pnpm test:pack
npm pack --dry-run
```

Run `pnpm format` before submitting. Add a failing behavior test before changing runtime logic.
Tests use Vitest, fake HTTP responses, and the official MCP SDK's in-memory transports. Test
observable behavior at the caller boundary, give tests behavior names, and separate Given, When,
and Then with whitespace or short comments. Keep time deterministic and use synthetic accounts,
tokens, and task data. Never require contributors to connect to production.

## API contract

`openapi/operations.json` is the operation allowlist. `openapi/schema.json` contains only those
operations and their recursively referenced components. Prose/examples from the service schema
are excluded. Shared response components may contain nested calendar, placement, or profile data;
do not replace their models with handwritten mirrors or export unrelated endpoints.

A maintainer supplies a reviewed, sanitized snapshot when the backend contract changes. Review
operation and component changes explicitly. Generate the TypeScript client with Java 17 or later:

```sh
pnpm generate:api
pnpm type-check
pnpm test
```

The generator is pinned to 7.25.0, downloaded from Maven Central, and checked by SHA-256. Its
reviewed templates preserve snake_case requests, camelCase responses, explicit nulls, and opaque
JSON payloads. `src/api/` is generated; edit the snapshot/templates and regenerate rather than
editing generated files. CI regenerates and checks for drift.

The three date helpers and their dependency closure live in `src/datetime/`. Keep unrelated
calendar, task, and application logic out of this package.

## Review and releases

Use focused changes and Conventional Commit titles such as `fix(mcp): preserve read-only scopes`.
Explain the caller-visible change, why it is needed, and how it was tested. OAuth, API contract,
license, and publishing changes need maintainer review. Do not include private source paths,
account identifiers, task dumps, or secrets in commits and reports.

During 0.x development, a minor release may change a tool, input, auth, or configuration contract;
document such changes in `CHANGELOG.md`. Patch releases preserve those contracts. Package and MCP
identity versions must match. This repository is the source of truth for the MCP implementation.

Publishing requires a repository admin to manually dispatch `.github/workflows/publish.yml` from
`main` and enter `@agendacraft/mcp` as confirmation. Before verification, the workflow rejects any
other event, branch, or confirmation, and rejects private repositories because npm provenance
requires public source. The same guard runs again immediately before `npm publish`, including when
only the publish job is rerun. Each guard checks current repository visibility and both the original
dispatcher's and the rerunning actor's current permissions through GitHub's API; both must be admins.
API failures or missing permissions refuse the release. Write and maintain access alone cannot
authorize publishing. The publish job also uses the `npm-release` environment. Public visibility does not authorize a release.

Before the first release the captain must verify the [private security reporting channel](SECURITY.md),
public release review, npm scope/package bootstrap and trusted-publisher setup, branch/tag protection,
and release environment approval rules. CI requires no npm token. Configure the npm trusted publisher for this
repository and `.github/workflows/publish.yml`; the release job uses OIDC and provenance.
The repository is a pre-release; do not dispatch publishing until maintainer review is complete.

## Developer Certificate of Origin

Contributions are accepted under the MIT license. Certify the following Developer Certificate of
Origin 1.1 by adding a `Signed-off-by: Your Name <your-email>` trailer to each commit (`git commit -s`).
Use an address you are comfortable making public.

Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this license document, but changing
it is not allowed.

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right to submit it under
the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my knowledge, is covered
under an appropriate open source license and I have the right under that license to submit that
work with modifications, whether created in whole or in part by me, under the same open source
license (unless I am permitted to submit under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person who certified (a), (b) or
(c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public and that a record of
the contribution (including all personal information I submit with it, including my sign-off) is
maintained indefinitely and may be redistributed consistent with this project or the open
source license(s) involved.
