import type { ProjectScript } from "@t3tools/contracts";

import { isWindowsAbsolutePath } from "./path.ts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  if (!input.worktreePath) {
    return input.project.cwd;
  }
  if (isAbsoluteProjectPath(input.worktreePath)) {
    return input.worktreePath;
  }
  return joinProjectPaths(input.project.cwd, input.worktreePath);
}

function isAbsoluteProjectPath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

function joinProjectPaths(left: string, right: string): string {
  const separator = left.includes("\\") ? "\\" : "/";
  const base = left.endsWith(separator) ? left.slice(0, -1) : left;
  const tail = right.startsWith(separator) ? right.slice(1) : right.replace(/^\.[/\\]/, "");
  return `${base}${separator}${tail}`;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}
