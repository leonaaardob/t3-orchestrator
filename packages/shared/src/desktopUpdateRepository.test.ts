import { assert, describe, it } from "@effect/vitest";

import {
  DEFAULT_DESKTOP_UPDATE_REPOSITORY,
  getDesktopUpdateReleaseTagUrlBase,
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
    assert.deepStrictEqual(parseDesktopUpdateRepository("leonaaardob/t3code-planning-fork"), {
      owner: "leonaaardob",
      repo: "t3code-planning-fork",
    });
    assert.equal(parseDesktopUpdateRepository("invalid"), undefined);
    assert.equal(parseDesktopUpdateRepository("too/many/slashes"), undefined);
  });

  it("builds release tag URLs from the resolved repository", () => {
    assert.equal(
      getDesktopUpdateReleaseTagUrlBase(),
      "https://github.com/leonaaardob/t3code-planning-fork/releases/tag",
    );
    assert.equal(
      getDesktopUpdateReleaseTagUrlBase("example/custom-repo"),
      "https://github.com/example/custom-repo/releases/tag",
    );
  });
});
