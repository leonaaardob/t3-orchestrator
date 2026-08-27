/**
 * Supervisor thread — a normal T3 thread designated as the project
 * supervisor by its durable role. No special runtime or board state.
 */

export const SUPERVISOR_THREAD_TITLE = "Project Supervisor" as const;

/** True when the thread is the designated Project Supervisor. */
export function isSupervisorThread(thread: {
  readonly role?: "standard" | "project-supervisor" | undefined;
}): boolean {
  return thread.role === "project-supervisor";
}
