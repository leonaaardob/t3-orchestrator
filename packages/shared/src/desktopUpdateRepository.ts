/** Default GitHub Releases feed for packaged T3 Planning desktop builds. */
export const DEFAULT_DESKTOP_UPDATE_REPOSITORY = "leonaaardob/t3-orchestrator";

/** Upstream T3 Code desktop update repository; fork builds must never default to this. */
export const UPSTREAM_DESKTOP_UPDATE_REPOSITORY = "pingdotgg/t3code";

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
