import { assert, describe, it } from "@effect/vitest";

import {
  DEFAULT_DESKTOP_UPDATE_REPOSITORY,
  getDesktopReleaseTag,
  getDesktopUpdateReleaseTagUrlBase,
  getDesktopUpdateDmgUrl,
  parseDesktopUpdateRepository,
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
  });

  it("derives the fork release tag", () => {
    assert.equal(getDesktopReleaseTag("0.0.36"), "orchestrator-v0.0.36");
  });

  it.each([
    ["x64", "T3-Orchestrator-0.0.36-x64.dmg"],
    ["arm64", "T3-Orchestrator-0.0.36-arm64.dmg"],
  ] as const)("selects the %s DMG asset", (architecture, asset) => {
    assert.equal(
      getDesktopUpdateDmgUrl("0.0.36", architecture),
      `https://github.com/leonaaardob/t3-orchestrator/releases/download/orchestrator-v0.0.36/${asset}`,
    );
  });
});
