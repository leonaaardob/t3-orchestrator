import * as Encoding from "effect/Encoding";
import { CheckpointRef, ProjectId, type ThreadId } from "@t3tools/contracts";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";

export const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}): string | undefined {
  const projectRoot = input.projects.find(
    (project) => project.id === input.thread.projectId,
  )?.workspaceRoot;
  if (input.thread.worktreePath) {
    return projectRoot
      ? projectScriptCwd({
          project: { cwd: projectRoot },
          worktreePath: input.thread.worktreePath,
        })
      : input.thread.worktreePath;
  }

  return projectRoot;
}
