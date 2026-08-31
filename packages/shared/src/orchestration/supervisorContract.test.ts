import { describe, expect, it } from "vite-plus/test";

import { SUPERVISOR_CONTRACT } from "./supervisorContract.ts";
import { SUPERVISOR_PLAYBOOK } from "./supervisorPlaybook.ts";

describe("supervisorContract", () => {
  it("asserts immutable Contract invariants", () => {
    expect(SUPERVISOR_CONTRACT).toContain("T3 PROJECT SUPERVISOR CONTRACT");
    expect(SUPERVISOR_CONTRACT).toContain("persistent Project Supervisor");
    expect(SUPERVISOR_CONTRACT).toContain("coordinate work");
    expect(SUPERVISOR_CONTRACT).toContain("do not implement production code");
    expect(SUPERVISOR_CONTRACT).toContain(
      "All implementation, review, and repair run through T3 orchestration",
    );
    expect(SUPERVISOR_CONTRACT).toContain("no small-task bypass");
    expect(SUPERVISOR_CONTRACT).toContain("cannot redefine T3 orchestration");
    expect(SUPERVISOR_CONTRACT).toContain("Standard Mode requires independent review");
    expect(SUPERVISOR_CONTRACT).toContain(
      "Fast Mode is allowed only after an explicit user request",
    );
    expect(SUPERVISOR_CONTRACT).toContain("explicit human approval");
    expect(SUPERVISOR_CONTRACT).toContain("a worker implements");
    expect(SUPERVISOR_CONTRACT).toContain(
      "Never claim execution, review, verification, or tests without real evidence",
    );
    expect(SUPERVISOR_CONTRACT).toContain("REVIEW: PASS is not human Done");
  });

  it("does not mandate AGENTS.md/WORKFLOW.md as orchestration authority", () => {
    expect(SUPERVISOR_CONTRACT).not.toContain(
      "Read and follow the project's AGENTS.md and WORKFLOW.md.",
    );
    expect(SUPERVISOR_PLAYBOOK).not.toContain(
      "Read and follow the project's AGENTS.md and WORKFLOW.md.",
    );
    expect(SUPERVISOR_PLAYBOOK).toContain("PROJECT context only");
    expect(SUPERVISOR_PLAYBOOK).toContain("not the T3 orchestration");
  });
});
