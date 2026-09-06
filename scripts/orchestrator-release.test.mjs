import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { assertPublishedArtifact, publishServerRelease } from "./publish-server-release.mjs";

describe("Orchestrator release invariants", () => {
  const workflow = parse(
    NodeFS.readFileSync(
      new URL("../.github/workflows/desktop-release.yml", import.meta.url),
      "utf8",
    ),
  );
  it("gates public desktop downloads on a tested and published standalone server", () => {
    expect(workflow.jobs.aggregate.needs).toEqual(
      expect.arrayContaining(["checks", "server_package", "build"]),
    );
    expect(workflow.jobs.publish_server.needs).toContain("aggregate");
    expect(workflow.jobs.release.needs).toContain("publish_server");
    expect(workflow.jobs.release.if).toContain("publish_release == 'true'");
    expect(workflow.jobs.publish_server.if).toContain("publish_release == 'true'");
    expect(workflow.on.workflow_dispatch.inputs.publish_release.default).toBe(false);
    expect(workflow.jobs.publish_server.permissions["id-token"]).toBe("write");
    expect(
      workflow.jobs.server_package.steps.some((step) =>
        step.run?.includes("smoke-server-package.mjs"),
      ),
    ).toBe(true);
  });
  it("refuses to treat a different existing npm tarball as a successful release", () => {
    const expected = { name: "t3-orchestrator", version: "0.0.40", integrity: "sha512-expected" };
    expect(() =>
      assertPublishedArtifact(
        { name: expected.name, version: expected.version, dist: { integrity: expected.integrity } },
        expected,
      ),
    ).not.toThrow();
    for (const override of [
      { name: "t3" },
      { version: "0.0.39" },
      { dist: { integrity: "sha512-different" } },
    ]) {
      expect(() =>
        assertPublishedArtifact(
          {
            name: expected.name,
            version: expected.version,
            dist: { integrity: expected.integrity },
            ...override,
          },
          expected,
        ),
      ).toThrow("different bytes");
    }
  });
  it("cannot publish from an unrelated repository", async () => {
    const previous = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = "unrelated/repository";
    try {
      await expect(publishServerRelease("unused", "0.0.40", "latest")).rejects.toThrow(
        "restricted",
      );
    } finally {
      if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = previous;
    }
  });
});
