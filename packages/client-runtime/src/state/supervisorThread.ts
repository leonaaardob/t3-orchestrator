export const SUPERVISOR_THREAD_TITLE = "Project Supervisor" as const;

export function isSupervisorThread(thread: { readonly title: string }): boolean {
  return thread.title.trim() === SUPERVISOR_THREAD_TITLE;
}
