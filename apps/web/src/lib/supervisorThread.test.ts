import { describe, expect, it } from "vite-plus/test";

import { isSupervisorThread } from "./supervisorThread.ts";

describe("isSupervisorThread", () => {
  it("uses the durable role rather than the mutable title", () => {
    expect(isSupervisorThread({ role: "project-supervisor" })).toBe(true);
    expect(isSupervisorThread({ role: "standard" })).toBe(false);
  });
});
