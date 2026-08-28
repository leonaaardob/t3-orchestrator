import * as NodePath from "node:path";
import { readFileSync, readdirSync } from "node:fs";

import { assert, it } from "@effect/vitest";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

const FORK_RELEASE_WORKFLOWS = [
  ".github/workflows/desktop-release.yml",
  ".github/workflows/desktop-macos-preview.yml",
] as const;

/** Matches stale server workspace filters after the t3 → t3-orchestrator rename. */
const STALE_SERVER_FILTER = /--filter(?:=|\s+)t3(?:\.\.\.|["'\s]|$)/;

function readRepoFile(relativePath: string): string {
  return readFileSync(NodePath.join(repoRoot, relativePath), "utf8");
}

it("fork release workflows target t3-orchestrator, not the retired t3 workspace", () => {
  for (const workflowPath of FORK_RELEASE_WORKFLOWS) {
    const contents = readRepoFile(workflowPath);
    assert.match(
      contents,
      /--filter=t3-orchestrator\.\.\./,
      `${workflowPath} must install the t3-orchestrator workspace graph`,
    );
    assert.notMatch(
      contents,
      STALE_SERVER_FILTER,
      `${workflowPath} still references the retired t3 workspace filter`,
    );
  }
});

it("active dev runner modes target t3-orchestrator", () => {
  const devRunner = readRepoFile("scripts/dev-runner.ts");
  assert.match(devRunner, /--filter=t3-orchestrator/);
  assert.notMatch(devRunner, STALE_SERVER_FILTER);
});

it("build-desktop staging keeps production install for the staged server graph", () => {
  const buildDesktopArtifact = readRepoFile("scripts/build-desktop-artifact.ts");
  assert.match(buildDesktopArtifact, /STAGE_INSTALL_ARGS = \["install", "--prod"\]/);
});

it("no fork workflow reintroduces a bare t3 workspace filter", () => {
  const workflowDir = NodePath.join(repoRoot, ".github/workflows");
  for (const fileName of readdirSync(workflowDir)) {
    if (!fileName.endsWith(".yml") && !fileName.endsWith(".yaml")) {
      continue;
    }
    const contents = readFileSync(NodePath.join(workflowDir, fileName), "utf8");
    assert.notMatch(
      contents,
      /--filter=t3\.\.\./,
      `${fileName} must not use the retired --filter=t3... server install graph`,
    );
  }
});
