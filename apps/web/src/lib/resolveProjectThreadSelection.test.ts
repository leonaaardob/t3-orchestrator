import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isSelectableProjectThread,
  resolveProjectThreadSelection,
  type ProjectThreadSelectionCandidate,
} from "./resolveProjectThreadSelection.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");
const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");

function thread(
  overrides: Partial<ProjectThreadSelectionCandidate> & Pick<ProjectThreadSelectionCandidate, "id">,
): ProjectThreadSelectionCandidate {
  return {
    environmentId: envA,
    projectId: projectA,
    archivedAt: null,
    role: "standard",
    ...overrides,
  };
}

describe("isSelectableProjectThread", () => {
  it("requires ownership of the active project and a non-archived thread", () => {
    const keys = new Set([`${envA}:${projectA}`]);
    expect(isSelectableProjectThread(thread({ id: "ok", projectId: projectA }), keys)).toBe(true);
    expect(isSelectableProjectThread(thread({ id: "foreign", projectId: projectB }), keys)).toBe(
      false,
    );
    expect(
      isSelectableProjectThread(
        thread({ id: "archived", archivedAt: "2026-08-31T00:00:00.000Z" }),
        keys,
      ),
    ).toBe(false);
  });
});

describe("resolveProjectThreadSelection", () => {
  const projectAKeys = new Set([`${envA}:${projectA}`]);
  const projectBKeys = new Set([`${envB}:${projectB}`]);

  const supervisorA = thread({
    id: ThreadId.make("supervisor-a"),
    role: "project-supervisor",
  });
  const normalA1 = thread({ id: ThreadId.make("thread-a1") });
  const normalA2 = thread({ id: ThreadId.make("thread-a2") });
  const supervisorB = thread({
    id: ThreadId.make("supervisor-b"),
    environmentId: envB,
    projectId: projectB,
    role: "project-supervisor",
  });
  const normalB1 = thread({
    id: ThreadId.make("thread-b1"),
    environmentId: envB,
    projectId: projectB,
  });
  const normalB2 = thread({
    id: ThreadId.make("thread-b2"),
    environmentId: envB,
    projectId: projectB,
  });

  it("selects the Supervisor when it is the only thread and nothing valid is selected", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectAKeys,
        selectedThread: null,
        projectThreads: [supervisorA],
      }),
    ).toEqual({ status: "resolved", thread: supervisorA });
  });

  it("falls back to Project B Supervisor after a cross-project switch", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectBKeys,
        selectedThread: normalA1,
        projectThreads: [supervisorB],
      }),
    ).toEqual({ status: "resolved", thread: supervisorB });
  });

  it("keeps a valid normal thread already selected in the active project", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectBKeys,
        selectedThread: normalB2,
        projectThreads: [supervisorB, normalB1, normalB2],
      }),
    ).toEqual({ status: "resolved", thread: normalB2 });
  });

  it("returns null when there is no valid selection and no Supervisor", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectAKeys,
        selectedThread: normalB1,
        projectThreads: [],
      }),
    ).toEqual({ status: "resolved", thread: null });
  });

  it("falls back to Supervisor when the selected normal thread becomes invalid", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectAKeys,
        selectedThread: { ...normalA1, archivedAt: "2026-08-31T12:00:00.000Z" },
        projectThreads: [supervisorA, normalA2],
      }),
    ).toEqual({ status: "resolved", thread: supervisorA });

    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectAKeys,
        selectedThread: null,
        projectThreads: [supervisorA, normalA2],
      }),
    ).toEqual({ status: "resolved", thread: supervisorA });
  });

  it("lets an explicit requested normal thread win over the Supervisor", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectBKeys,
        selectedThread: supervisorB,
        requestedThread: normalB1,
        projectThreads: [supervisorB, normalB1, normalB2],
      }),
    ).toEqual({ status: "resolved", thread: normalB1 });
  });

  it("does not resolve against an incomplete thread list", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectAKeys,
        selectedThread: null,
        projectThreads: [],
        threadsReady: false,
      }),
    ).toEqual({ status: "pending" });
  });

  it("ignores a Supervisor that belongs to another project", () => {
    expect(
      resolveProjectThreadSelection({
        activeProjectKeys: projectAKeys,
        selectedThread: null,
        projectThreads: [supervisorB],
      }),
    ).toEqual({ status: "resolved", thread: null });
  });
});
