import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import {
  getDesktopUpdateDmgUrl,
  getDesktopUpdateReleaseTagUrlBase,
} from "@t3tools/shared/desktopUpdateRepository";

import { APP_BASE_NAME } from "../branding";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

const DESKTOP_RELEASE_TAG_URL = getDesktopUpdateReleaseTagUrlBase();

/**
 * The main process fills `downloadedVersion` from the updater's `update-downloaded`
 * event, which is dispatched on its own fiber. A download RPC can therefore resolve
 * before that write lands, so fall back to the version the download was started for.
 */
export function getDesktopUpdateDownloadedVersion(state: DesktopUpdateState): string | null {
  return state.downloadedVersion ?? state.availableVersion;
}

/** Release notes for an exact downloaded build; nightly suffixes are part of the tag. */
export function getDesktopUpdateReleaseUrl(version: string | null): string | null {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) return null;
  return `${DESKTOP_RELEASE_TAG_URL}/v${encodeURIComponent(normalizedVersion)}`;
}

export function getDesktopUpdateManualDownloadUrl(state: DesktopUpdateState): string | null {
  return (
    getDesktopUpdateDmgUrl(state.availableVersion, state.appArch) ??
    getDesktopUpdateReleaseUrl(state.availableVersion)
  );
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (
    !state.automaticInstallAvailable &&
    state.downloadedVersion &&
    (state.status === "downloaded" || state.status === "error")
  ) {
    return "download";
  }
  if (
    state.automaticInstallAvailable &&
    state.downloadedVersion &&
    (state.status === "downloaded" ||
      (state.status === "error" &&
        (state.errorContext === null || state.errorContext === "install")))
  ) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return `This Mac has Apple Silicon, but ${APP_BASE_NAME} is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.`;
  }
  if (action === "install") {
    return `This Mac has Apple Silicon, but ${APP_BASE_NAME} is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.`;
  }
  return `This Mac has Apple Silicon, but ${APP_BASE_NAME} is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.`;
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return state.automaticInstallAvailable
      ? `Update ${state.availableVersion ?? "available"} ready to download`
      : `Download T3 Orchestrator ${state.availableVersion ?? "update"} to install manually. Automatic installation is unavailable on unsigned macOS builds.`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return state.automaticInstallAvailable
      ? `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`
      : `Download T3 Orchestrator ${state.availableVersion ?? "update"} to install manually.`;
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    if (state.downloadedVersion) {
      return state.automaticInstallAvailable
        ? `Update ${state.downloadedVersion} downloaded. Click to restart and install.`
        : `Download T3 Orchestrator ${state.availableVersion ?? state.downloadedVersion} to install manually.`;
    }
    return state.message ?? "Update failed";
  }
  return "Up to date";
}

export function getDesktopUpdateInstallConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  return `Install update${version ? ` ${version}` : ""} and restart ${APP_BASE_NAME}?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.`;
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return getDesktopUpdateActionError(result) !== null;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return (
    state.status !== "checking" && state.status !== "downloading" && state.status !== "disabled"
  );
}
