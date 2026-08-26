/**
 * Supervisor thread — a normal T3 thread designated as the project
 * supervisor by its title. No special runtime or board state.
 */

export const SUPERVISOR_THREAD_TITLE = "Project Supervisor" as const;

/** True when the thread is the designated Project Supervisor. */
export function isSupervisorThread(thread: { readonly title: string }): boolean {
  return thread.title.trim() === SUPERVISOR_THREAD_TITLE;
}
