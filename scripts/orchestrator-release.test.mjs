import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";
import { parse } from "yaml";
import {
  assertPublishedArtifact,
  publishServerRelease,
  verifyPublishedServer,
} from "./publish-server-release.mjs";

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

describe("npm publication propagation", () => {
  const tarball = Buffer.from("tested server artifact");
  const expected = {
    name: "t3-orchestrator",
    version: "0.0.40",
    integrity: `sha512-${NodeCrypto.createHash("sha512").update(tarball).digest("base64")}`,
  };
  const metadata = () =>
    Response.json({
      name: expected.name,
      version: expected.version,
      dist: {
        integrity: expected.integrity,
        tarball: "https://registry.npmjs.org/t3-orchestrator/-/t3-orchestrator-0.0.40.tgz",
      },
    });

  it("waits for metadata and then the tarball to propagate before releasing desktop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(new Response(tarball));
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    try {
      let completed = false;
      const verification = verifyPublishedServer(expected).then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(completed).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(15_000);
      await verification;
      expect(completed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("rejects downloaded bytes that differ from the tested artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(new Response("different bytes")),
    );
    try {
      await expect(verifyPublishedServer(expected)).rejects.toThrow("integrity mismatch");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
