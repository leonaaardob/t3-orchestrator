/** Default GitHub Releases feed for packaged T3 Orchestrator desktop builds. */
export const DEFAULT_DESKTOP_UPDATE_REPOSITORY = "leonaaardob/t3-orchestrator";

/** Upstream T3 Code desktop update repository; fork builds must never default to this. */
export const UPSTREAM_DESKTOP_UPDATE_REPOSITORY = "pingdotgg/t3code";

/** Published desktop artifact product stem (`T3-Orchestrator-<version>-<arch>.<ext>`). */
export const DESKTOP_UPDATE_ARTIFACT_PRODUCT = "T3-Orchestrator";

/** Release-tag prefix used for fork desktop GitHub Releases (`orchestrator-vX.Y.Z`). */
export const DESKTOP_UPDATE_RELEASE_TAG_PREFIX = "orchestrator-v";

export type DesktopUpdateDmgArch = "arm64" | "x64";

/**
 * Resolves the effective desktop update repository slug (`owner/repo`).
 * Explicit `T3CODE_DESKTOP_UPDATE_REPOSITORY` wins; otherwise the fork default applies.
 */
export function resolveDesktopUpdateRepository(updateRepositoryOverride?: string | null): string {
  const trimmedOverride = updateRepositoryOverride?.trim();
  if (trimmedOverride) {
    return trimmedOverride;
  }
  return DEFAULT_DESKTOP_UPDATE_REPOSITORY;
}

export function parseDesktopUpdateRepository(
  repository: string,
): { owner: string; repo: string } | undefined {
  const [owner, repo, ...rest] = repository.trim().split("/");
  if (!owner || !repo || rest.length > 0) {
    return undefined;
  }
  return { owner, repo };
}

/** Stable GitHub release tag for a desktop version (`orchestrator-v0.0.36`). */
export function getDesktopUpdateReleaseTag(version: string): string {
  const normalizedVersion = version.trim().replace(/^v/i, "");
  if (normalizedVersion.startsWith(DESKTOP_UPDATE_RELEASE_TAG_PREFIX)) {
    return normalizedVersion;
  }
  return `${DESKTOP_UPDATE_RELEASE_TAG_PREFIX}${normalizedVersion}`;
}

/** Base URL for release-tag links shown in the desktop update UI. */
export function getDesktopUpdateReleaseTagUrlBase(
  repository: string = DEFAULT_DESKTOP_UPDATE_REPOSITORY,
): string {
  const parsed = parseDesktopUpdateRepository(repository);
  if (!parsed) {
    return `https://github.com/${DEFAULT_DESKTOP_UPDATE_REPOSITORY}/releases/tag`;
  }
  return `https://github.com/${parsed.owner}/${parsed.repo}/releases/tag`;
}

/** Exact release-tag URL for a desktop version. */
export function getDesktopUpdateReleaseTagUrl(
  version: string,
  repository: string = DEFAULT_DESKTOP_UPDATE_REPOSITORY,
): string {
  return `${getDesktopUpdateReleaseTagUrlBase(repository)}/${encodeURIComponent(getDesktopUpdateReleaseTag(version))}`;
}

/**
 * Chooses the macOS DMG arch for manual download.
 * Prefer the host arch so Apple Silicon machines running under Rosetta get the native DMG.
 */
export function resolveDesktopUpdateManualDmgArch(input: {
  readonly hostArch: string;
  readonly appArch: string;
}): DesktopUpdateDmgArch | null {
  if (input.hostArch === "arm64" || input.hostArch === "x64") {
    return input.hostArch;
  }
  if (input.appArch === "arm64" || input.appArch === "x64") {
    return input.appArch;
  }
  return null;
}

/** Architecture-correct public macOS DMG filename for a release. */
export function getDesktopUpdateManualDmgFileName(
  version: string,
  arch: DesktopUpdateDmgArch,
): string {
  const normalizedVersion = version.trim().replace(/^v/i, "");
  return `${DESKTOP_UPDATE_ARTIFACT_PRODUCT}-${normalizedVersion}-${arch}.dmg`;
}

/** Direct download URL for the architecture-correct public macOS DMG. */
export function getDesktopUpdateManualDmgUrl(input: {
  readonly version: string;
  readonly arch: DesktopUpdateDmgArch;
  readonly repository?: string;
}): string {
  const repository = resolveDesktopUpdateRepository(input.repository);
  const parsed = parseDesktopUpdateRepository(repository) ?? {
    owner: "leonaaardob",
    repo: "t3-orchestrator",
  };
  const tag = getDesktopUpdateReleaseTag(input.version);
  const fileName = getDesktopUpdateManualDmgFileName(input.version, input.arch);
  return `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}
