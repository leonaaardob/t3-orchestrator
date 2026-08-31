import { isSupervisorThread } from "./supervisorThread";

/**
 * Project-scoped thread selection: Supervisor is the default fallback when no
 * other valid selection exists for the active project. It is never forced over
 * a valid normal thread or an explicit navigation target.
 */

export type ProjectThreadSelectionCandidate = {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly archivedAt: string | null;
  readonly role?: "standard" | "project-supervisor" | undefined;
};

export type ProjectThreadSelectionResult<T extends ProjectThreadSelectionCandidate> =
  | { readonly status: "pending" }
  | { readonly status: "resolved"; readonly thread: T | null };

export function projectThreadOwnershipKey(thread: {
  readonly environmentId: string;
  readonly projectId: string;
}): string {
  return `${thread.environmentId}:${thread.projectId}`;
}

/** Selectable = owned by the active project and not archived. */
export function isSelectableProjectThread(
  thread: ProjectThreadSelectionCandidate,
  activeProjectKeys: ReadonlySet<string>,
): boolean {
  if (thread.archivedAt !== null) {
    return false;
  }
  return activeProjectKeys.has(projectThreadOwnershipKey(thread));
}

/**
 * Resolve which thread should be selected for an active project.
 *
 * Priority:
 * 1. Explicit requested thread, if valid for the project
 * 2. Current selection, if valid for the project
 * 3. Active Project Supervisor for the project
 * 4. null → caller keeps existing empty-state behavior
 *
 * Pass `threadsReady: false` while the project's thread list is still loading
 * so callers do not treat an incomplete list as "no supervisor / empty".
 */
export function resolveProjectThreadSelection<T extends ProjectThreadSelectionCandidate>(input: {
  readonly activeProjectKeys: ReadonlySet<string>;
  readonly selectedThread: T | null;
  readonly requestedThread?: T | null;
  readonly projectThreads: readonly T[];
  readonly threadsReady?: boolean;
}): ProjectThreadSelectionResult<T> {
  if (input.threadsReady === false) {
    return { status: "pending" };
  }

  const requested = input.requestedThread ?? null;
  if (requested !== null && isSelectableProjectThread(requested, input.activeProjectKeys)) {
    return { status: "resolved", thread: requested };
  }

  if (
    input.selectedThread !== null &&
    isSelectableProjectThread(input.selectedThread, input.activeProjectKeys)
  ) {
    return { status: "resolved", thread: input.selectedThread };
  }

  const supervisor =
    input.projectThreads.find(
      (thread) =>
        isSupervisorThread(thread) && isSelectableProjectThread(thread, input.activeProjectKeys),
    ) ?? null;

  return { status: "resolved", thread: supervisor };
}
