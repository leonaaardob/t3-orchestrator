/** Default GitHub Releases feed for packaged T3 Orchestrator desktop builds. */
export const DEFAULT_DESKTOP_UPDATE_REPOSITORY = "leonaaardob/t3-orchestrator";

/** Upstream T3 Code desktop update repository; fork builds must never default to this. */
export const UPSTREAM_DESKTOP_UPDATE_REPOSITORY = "pingdotgg/t3code";

/** Fork release tags used by the desktop release workflow. */
export function getDesktopReleaseTag(version: string | null): string | null {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) return null;
  return `orchestrator-v${normalizedVersion}`;
}

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

/** Direct installer URL used by unsigned macOS builds for manual updates. */
export function getDesktopUpdateDmgUrl(
  version: string | null,
  architecture: "arm64" | "x64" | "other",
  repository: string = DEFAULT_DESKTOP_UPDATE_REPOSITORY,
): string | null {
  const normalizedVersion = version?.trim();
  const parsed = parseDesktopUpdateRepository(repository);
  if (!normalizedVersion || !parsed || architecture === "other") return null;
  const tag = getDesktopReleaseTag(normalizedVersion);
  if (!tag) return null;
  const asset = `T3-Orchestrator-${normalizedVersion}-${architecture}.dmg`;
  return `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

export function getDesktopUpdateReleaseTagUrl(version: string | null): string | null {
  const tag = getDesktopReleaseTag(version);
  if (!tag) return null;
  return `${getDesktopUpdateReleaseTagUrlBase()}/${encodeURIComponent(tag)}`;
}
