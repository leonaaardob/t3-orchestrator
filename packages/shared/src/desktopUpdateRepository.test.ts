import { assert, describe, it } from "@effect/vitest";

import {
  DEFAULT_DESKTOP_UPDATE_REPOSITORY,
  getDesktopUpdateManualDmgFileName,
  getDesktopUpdateManualDmgUrl,
  getDesktopUpdateReleaseTag,
  getDesktopUpdateReleaseTagUrl,
  getDesktopUpdateReleaseTagUrlBase,
  parseDesktopUpdateRepository,
  resolveDesktopUpdateManualDmgArch,
  resolveDesktopUpdateRepository,
  UPSTREAM_DESKTOP_UPDATE_REPOSITORY,
} from "./desktopUpdateRepository.js";

describe("desktopUpdateRepository", () => {
  it("defaults to the fork desktop update repository", () => {
    assert.equal(resolveDesktopUpdateRepository(), DEFAULT_DESKTOP_UPDATE_REPOSITORY);
    assert.equal(resolveDesktopUpdateRepository(undefined), DEFAULT_DESKTOP_UPDATE_REPOSITORY);
    assert.equal(resolveDesktopUpdateRepository("   "), DEFAULT_DESKTOP_UPDATE_REPOSITORY);
  });

  it("honors an explicit T3CODE_DESKTOP_UPDATE_REPOSITORY override", () => {
    assert.equal(resolveDesktopUpdateRepository("example/custom-repo"), "example/custom-repo");
  });

  it("never defaults to the upstream T3 Code repository", () => {
    assert.notEqual(DEFAULT_DESKTOP_UPDATE_REPOSITORY, UPSTREAM_DESKTOP_UPDATE_REPOSITORY);
    assert.notEqual(resolveDesktopUpdateRepository(), UPSTREAM_DESKTOP_UPDATE_REPOSITORY);
  });

  it("parses owner/repo slugs", () => {
    assert.deepStrictEqual(parseDesktopUpdateRepository("leonaaardob/t3-orchestrator"), {
      owner: "leonaaardob",
      repo: "t3-orchestrator",
    });
    assert.equal(parseDesktopUpdateRepository("invalid"), undefined);
    assert.equal(parseDesktopUpdateRepository("too/many/slashes"), undefined);
  });

  it("builds release tag URLs from the resolved repository", () => {
    assert.equal(
      getDesktopUpdateReleaseTagUrlBase(),
      "https://github.com/leonaaardob/t3-orchestrator/releases/tag",
    );
    assert.equal(
      getDesktopUpdateReleaseTagUrlBase("example/custom-repo"),
      "https://github.com/example/custom-repo/releases/tag",
    );
    assert.equal(getDesktopUpdateReleaseTag("0.0.36"), "orchestrator-v0.0.36");
    assert.equal(
      getDesktopUpdateReleaseTagUrl("0.0.36"),
      "https://github.com/leonaaardob/t3-orchestrator/releases/tag/orchestrator-v0.0.36",
    );
  });

  it("selects architecture-correct public macOS DMG URLs", () => {
    assert.equal(resolveDesktopUpdateManualDmgArch({ hostArch: "x64", appArch: "x64" }), "x64");
    assert.equal(resolveDesktopUpdateManualDmgArch({ hostArch: "arm64", appArch: "x64" }), "arm64");
    assert.equal(
      getDesktopUpdateManualDmgFileName("0.0.36", "x64"),
      "T3-Orchestrator-0.0.36-x64.dmg",
    );
    assert.equal(
      getDesktopUpdateManualDmgFileName("0.0.36", "arm64"),
      "T3-Orchestrator-0.0.36-arm64.dmg",
    );
    assert.equal(
      getDesktopUpdateManualDmgUrl({ version: "0.0.36", arch: "x64" }),
      "https://github.com/leonaaardob/t3-orchestrator/releases/download/orchestrator-v0.0.36/T3-Orchestrator-0.0.36-x64.dmg",
    );
    assert.equal(
      getDesktopUpdateManualDmgUrl({ version: "0.0.36", arch: "arm64" }),
      "https://github.com/leonaaardob/t3-orchestrator/releases/download/orchestrator-v0.0.36/T3-Orchestrator-0.0.36-arm64.dmg",
    );
  });
});
