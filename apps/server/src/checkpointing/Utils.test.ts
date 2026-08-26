import { describe, expect, it } from "vitest";
import { ProjectId } from "@t3tools/contracts";

import { resolveThreadWorkspaceCwd } from "./Utils.ts";

describe("resolveThreadWorkspaceCwd", () => {
  const projectId = ProjectId.make("project-1");
  const projects = [{ id: projectId, workspaceRoot: "/repo" }];

  it("returns the project root when the thread has no worktree", () => {
    expect(
      resolveThreadWorkspaceCwd({
        thread: { projectId, worktreePath: null },
        projects,
      }),
    ).toBe("/repo");
  });

  it("resolves a relative worktree path against the project root", () => {
    expect(
      resolveThreadWorkspaceCwd({
        thread: { projectId, worktreePath: ".t3/workspaces/card-1" },
        projects,
      }),
    ).toBe("/repo/.t3/workspaces/card-1");
  });

  it("keeps an absolute worktree path unchanged", () => {
    expect(
      resolveThreadWorkspaceCwd({
        thread: {
          projectId,
          worktreePath: "/repo/.t3/workspaces/card-1",
        },
        projects,
      }),
    ).toBe("/repo/.t3/workspaces/card-1");
  });
});
