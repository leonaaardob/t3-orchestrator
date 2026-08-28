import { assert, describe, it } from "@effect/vitest";
import * as NodePath from "node:path";

import {
  bootServiceName,
  cliBinName,
  defaultRemoteHomeDir,
  defaultRemoteHomeName,
  defaultRemoteHomeShell,
  formatManualServerUpdateCommand,
  formatNpxServiceUpdateCommand,
  formatPackageSpec,
  formatPackageSpecLatest,
  formatPackageSpecNightly,
  linuxServiceName,
  macServiceLabel,
  macServicePlistFile,
  npmPackageName,
  pinnedRuntimeEntryPath,
  productName,
  remoteSshLaunchDir,
  remoteSshLaunchDirShell,
  resolveRemotePackageSpec,
  suggestedPackageSpec,
} from "./distributionIdentity.ts";

describe("distributionIdentity", () => {
  it("defines fork distribution constants", () => {
    assert.equal(npmPackageName, "t3-orchestrator");
    assert.equal(cliBinName, "t3-orchestrator");
    assert.equal(defaultRemoteHomeName, ".t3-orchestrator");
    assert.equal(linuxServiceName, "t3-orchestrator.service");
    assert.equal(macServiceLabel, "com.t3orchestrator.service");
    assert.equal(macServicePlistFile, "com.t3orchestrator.service.plist");
    assert.equal(productName, "T3 Orchestrator");
    assert.equal(bootServiceName, "t3-orchestrator");
  });

  it("derives remote home and ssh launch paths", () => {
    assert.equal(defaultRemoteHomeDir("/home/kyle"), "/home/kyle/.t3-orchestrator");
    assert.equal(remoteSshLaunchDir("/home/kyle"), "/home/kyle/.t3-orchestrator/ssh-launch");
    assert.equal(defaultRemoteHomeShell, '"$HOME/.t3-orchestrator"');
    assert.equal(remoteSshLaunchDirShell, '"$HOME/.t3-orchestrator/ssh-launch"');
  });

  it("formats package specs for orchestrator", () => {
    assert.equal(formatPackageSpec("0.0.36"), "t3-orchestrator@0.0.36");
    assert.equal(formatPackageSpecLatest(), "t3-orchestrator@latest");
    assert.equal(formatPackageSpecNightly(), "t3-orchestrator@nightly");
    assert.equal(suggestedPackageSpec("0.0.36"), "t3-orchestrator");
    assert.equal(suggestedPackageSpec("0.0.36-nightly.20260828.1"), "t3-orchestrator@nightly");
  });

  it("resolves remote package specs from desktop release metadata", () => {
    assert.equal(
      resolveRemotePackageSpec({ appVersion: "0.0.36", updateChannel: "latest" }),
      "t3-orchestrator@0.0.36",
    );
    assert.equal(
      resolveRemotePackageSpec({
        appVersion: "0.0.36-nightly.20260828.1",
        updateChannel: "nightly",
      }),
      "t3-orchestrator@0.0.36-nightly.20260828.1",
    );
    assert.equal(
      resolveRemotePackageSpec({
        appVersion: "0.0.0-dev",
        updateChannel: "latest",
        isDevelopment: true,
      }),
      "t3-orchestrator@nightly",
    );
    assert.equal(
      resolveRemotePackageSpec({ appVersion: "0.0.0-dev", updateChannel: "latest" }),
      "t3-orchestrator@0.0.0-dev",
    );
  });

  it("builds pinned runtime entry paths under node_modules/t3-orchestrator", () => {
    const versionDir = "/home/kyle/.t3-orchestrator/runtime/versions/0.0.36";
    assert.equal(
      pinnedRuntimeEntryPath(NodePath.join, versionDir),
      "/home/kyle/.t3-orchestrator/runtime/versions/0.0.36/node_modules/t3-orchestrator/dist/bin.mjs",
    );
  });

  it("formats user-facing update commands for the fork CLI", () => {
    assert.equal(formatManualServerUpdateCommand("0.0.36"), "npx t3-orchestrator@0.0.36");
    assert.equal(formatNpxServiceUpdateCommand(), "npx t3-orchestrator@latest service update");
  });

  it("keeps same-semver coexistence paths distinct from official T3", () => {
    const version = "0.0.36";
    const orchestratorRuntime = pinnedRuntimeEntryPath(
      NodePath.join,
      defaultRemoteHomeDir("/home/kyle") + `/runtime/versions/${version}`,
    );
    const officialRuntime = NodePath.join(
      "/home/kyle/.t3/runtime/versions",
      version,
      "node_modules",
      "t3",
      "dist",
      "bin.mjs",
    );

    assert.notEqual(orchestratorRuntime, officialRuntime);
    assert.include(orchestratorRuntime, "t3-orchestrator");
    assert.include(officialRuntime, "/.t3/");
    assert.include(officialRuntime, "/node_modules/t3/");
  });
});
