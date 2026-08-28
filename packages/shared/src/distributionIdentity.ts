/**
 * Fork distribution identity for T3 Orchestrator.
 *
 * Single source of truth for npm/CLI/remote-home/service naming so upstream
 * merges do not scatter fork strings across the repo.
 */

export const npmPackageName = "t3-orchestrator" as const;
export const cliBinName = "t3-orchestrator" as const;
export const defaultRemoteHomeName = ".t3-orchestrator" as const;
export const linuxServiceName = "t3-orchestrator.service" as const;
export const macServiceLabel = "com.t3orchestrator.service" as const;
export const macServicePlistFile = `${macServiceLabel}.plist` as const;
export const productName = "T3 Orchestrator" as const;

/** systemd unit basename without the `.service` suffix. */
export const bootServiceName = "t3-orchestrator" as const;

const PUBLISHABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export function defaultRemoteHomeDir(homeDir: string): string {
  const trimmed = homeDir.replace(/[/\\]+$/, "");
  return `${trimmed}/${defaultRemoteHomeName}`;
}

export function remoteSshLaunchDir(homeDir: string): string {
  return `${defaultRemoteHomeDir(homeDir)}/ssh-launch`;
}

/** Shell fragment for remote SSH scripts: `"$HOME/.t3-orchestrator"`. */
export const defaultRemoteHomeShell = `"$HOME/${defaultRemoteHomeName}"` as const;

/** Shell fragment for remote SSH launch state: `"$HOME/.t3-orchestrator/ssh-launch"`. */
export const remoteSshLaunchDirShell = `"$HOME/${defaultRemoteHomeName}/ssh-launch"` as const;

export function formatPackageSpec(version: string): string {
  return `${npmPackageName}@${version}`;
}

export function formatPackageSpecLatest(): string {
  return formatPackageSpec("latest");
}

export function formatPackageSpecNightly(): string {
  return formatPackageSpec("nightly");
}

/**
 * Bare package name for copy/paste suggestions, or `@nightly` channel tag when
 * the running build is a nightly.
 */
export function suggestedPackageSpec(version: string): string {
  return version.includes("-nightly.") ? formatPackageSpecNightly() : npmPackageName;
}

export function pinnedRuntimeEntryPath(
  join: (...segments: string[]) => string,
  versionDir: string,
): string {
  return join(versionDir, "node_modules", npmPackageName, "dist", "bin.mjs");
}

export function resolveRemotePackageSpec(input: {
  readonly appVersion: string;
  readonly updateChannel: "latest" | "nightly";
  readonly isDevelopment?: boolean;
}): string {
  const appVersion = input.appVersion.trim();
  if (!input.isDevelopment && PUBLISHABLE_VERSION_PATTERN.test(appVersion)) {
    return formatPackageSpec(appVersion);
  }

  if (input.isDevelopment) {
    return formatPackageSpecNightly();
  }

  return input.updateChannel === "nightly" ? formatPackageSpecNightly() : formatPackageSpecLatest();
}

export function formatCliInvocation(subcommand: string): string {
  return `${cliBinName} ${subcommand}`;
}

export function formatNpxServiceUpdateCommand(): string {
  return `npx ${formatPackageSpecLatest()} service update`;
}

export function formatManualServerUpdateCommand(targetVersion: string): string {
  return `npx ${formatPackageSpec(targetVersion)}`;
}
