// @effect-diagnostics nodeBuiltinImport:off - one-shot codesign probe at updater configure; keep ChildProcessSpawner out of the updater layer graph.
import type { DesktopUpdateInstallMode } from "@t3tools/contracts";
import { spawnSync } from "node:child_process";

export const MAC_UNSIGNED_MANUAL_UPDATE_MESSAGE =
  "Automatic installation is unavailable on unsigned macOS builds. Download and install the update manually.";

const DEVELOPER_ID_APPLICATION_MARKER = "Authority=Developer ID Application";

/**
 * Resolves the `.app` bundle path from Electron's packaged `app.getAppPath()`.
 * Packaged paths look like `/Applications/T3 Orchestrator.app/Contents/Resources/app.asar`.
 */
export function resolveMacAppBundlePath(appPath: string): string | null {
  const normalized = appPath.replace(/\\/g, "/");
  const marker = ".app/";
  const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(0, markerIndex + ".app".length);
  }
  if (normalized.toLowerCase().endsWith(".app")) {
    return normalized;
  }
  return null;
}

/** True when `codesign -dv` output reports a Developer ID Application signer. */
export function hasMacDeveloperIdApplicationAuthority(codesignOutput: string): boolean {
  return codesignOutput.includes(DEVELOPER_ID_APPLICATION_MARKER);
}

/**
 * One-shot macOS codesign probe for updater install capability.
 * Uses Node spawnSync because this runs once at configure time and must not
 * pull ChildProcessSpawner into the updater layer graph.
 */
export function inspectMacDeveloperIdSignature(appPath: string): boolean | null {
  const bundlePath = resolveMacAppBundlePath(appPath);
  if (!bundlePath) {
    return null;
  }

  try {
    // codesign -dv writes authority details to stderr even on success.
    const result = spawnSync("codesign", ["-dv", "--verbose=4", bundlePath], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
    if (hasMacDeveloperIdApplicationAuthority(combined)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type ResolveDesktopUpdateInstallModeInput = {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  /** Explicit override from env/tests: `automatic` | `manual`. */
  readonly installModeOverride?: DesktopUpdateInstallMode | null;
  /**
   * Result of inspecting the running macOS app signature.
   * `true` means Developer ID Application is present (signed for distribution).
   * `false` means unsigned / ad-hoc / missing.
   * `null` means the check could not run (non-mac, unpackaged, or inspection failed closed).
   */
  readonly hasDeveloperIdApplicationSignature?: boolean | null;
};

/**
 * Deterministic install-mode policy for desktop updates.
 *
 * - Non-macOS: automatic in-app install remains available.
 * - macOS packaged + Developer ID Application: automatic install allowed.
 * - macOS packaged without that signature: manual DMG download only.
 * - Override wins when provided (tests / explicit operator control).
 *
 * Never infers capability from `quitAndInstall` failures.
 */
export function resolveDesktopUpdateInstallMode(
  input: ResolveDesktopUpdateInstallModeInput,
): DesktopUpdateInstallMode {
  const override = input.installModeOverride;
  if (override === "automatic" || override === "manual") {
    return override;
  }

  if (input.platform !== "darwin") {
    return "automatic";
  }

  if (!input.isPackaged) {
    // Updates are disabled for unpackaged builds; default keeps signed-path tests simple.
    return "automatic";
  }

  if (input.hasDeveloperIdApplicationSignature === true) {
    return "automatic";
  }

  return "manual";
}
