import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = readFileSync(".github/workflows/publish.yml", "utf8");
const gate = workflow
  .match(/        run: \|\n((?:          .*\n|\n)+)/)![1]!
  .replace(/^          /gm, "");

function authorize(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-release-gate-"));
  writeFileSync(
    join(directory, "gh"),
    `#!/bin/sh
case "$*" in
  "api repos/agendacraft/mcp --jq .private") printf '%s' "$FIXTURE_REPOSITORY_PRIVATE" ;;
  *collaborators/original/permission*) printf '%s' "$FIXTURE_ACTOR_PERMISSION" ;;
  *collaborators/rerunner/permission*) printf '%s' "$FIXTURE_TRIGGERING_PERMISSION" ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o700 }
  );
  try {
    return spawnSync("bash", ["-e", "-c", gate], {
      encoding: "utf8",
      env: {
        PATH: `${directory}:${process.env["PATH"]}`,
        RELEASE_EVENT: "workflow_dispatch",
        RELEASE_REF: "refs/heads/main",
        RELEASE_CONFIRMATION: "@agendacraft/mcp",
        FIXTURE_REPOSITORY_PRIVATE: "false",
        RELEASE_ACTOR: "original",
        RELEASE_TRIGGERING_ACTOR: "rerunner",
        GITHUB_REPOSITORY: "agendacraft/mcp",
        FIXTURE_ACTOR_PERMISSION: "admin",
        FIXTURE_TRIGGERING_PERMISSION: "admin",
        ...overrides,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("manual npm release authorization", () => {
  it("rechecks the full authorization gate immediately before an isolated publish-job rerun", () => {
    const publishJob = workflow.split("\n  publish:\n")[1]!;

    expect(workflow).toMatch(
      /- &release-authorization\n\s+name: Require explicit maintainer release/
    );
    expect(publishJob).toMatch(
      /- \*release-authorization\n\s+- run: npm publish --provenance --access public/
    );
  });

  it("accepts an explicitly confirmed public release initiated and rerun by admins", () => {
    const result = authorize();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.each([
    { RELEASE_EVENT: "push" },
    { RELEASE_EVENT: "pull_request" },
    { RELEASE_REF: "refs/heads/review" },
    { RELEASE_CONFIRMATION: "" },
    { RELEASE_CONFIRMATION: "another-package" },
    { FIXTURE_REPOSITORY_PRIVATE: "true" },
    { FIXTURE_REPOSITORY_PRIVATE: "" },
    { FIXTURE_ACTOR_PERMISSION: "write" },
    { FIXTURE_ACTOR_PERMISSION: "maintain" },
    { FIXTURE_TRIGGERING_PERMISSION: "write" },
    { FIXTURE_TRIGGERING_PERMISSION: "" },
    { RELEASE_ACTOR: "unknown" },
    { RELEASE_TRIGGERING_ACTOR: "unknown" },
  ])("refuses a release with $0", (overrides) => {
    const result = authorize(overrides);

    expect(result.status).not.toBe(0);
  });
});
