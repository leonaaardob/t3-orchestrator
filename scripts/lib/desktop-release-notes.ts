/**
 * Human-facing GitHub Release body for fork desktop publishes.
 *
 * Signing copy must match the build that actually ran: when Apple credentials
 * are present the workflow builds with `--signed`; otherwise macOS stays
 * unsigned and the updater uses the manual-install path.
 */

export type DesktopReleaseNotesInput = {
  readonly macosSigned: boolean;
};

const SHARED_PREFIX = `T3 Orchestrator desktop release.

Project-level orchestration for T3 Code.

Includes:
- Project Supervisor
- Agent Board
- autonomous scheduler/reconciler
- cross-provider implementation/review/repair presets
- independent review
- bounded repair cycles
- macOS, Windows and Linux desktop builds

Status:
Experimental.`;

const SHARED_SUFFIX = `Windows may show a SmartScreen warning. Do not disable system-wide
protections.

This is not the official T3 Code project.
Upstream lives at https://github.com/pingdotgg/t3code.`;

const UNSIGNED_MACOS = `macOS builds are currently unsigned.
On macOS, updates use the manual install flow.`;

const SIGNED_MACOS = `macOS builds are Developer ID signed and notarized.
Automatic installation is available on signed macOS builds.`;

export function buildDesktopReleaseNotes(input: DesktopReleaseNotesInput): string {
  const macosCopy = input.macosSigned ? SIGNED_MACOS : UNSIGNED_MACOS;
  return `${SHARED_PREFIX}

${macosCopy}
${SHARED_SUFFIX}
`;
}

/** True when the release body claims signed/notarized macOS artifacts. */
export function releaseNotesClaimMacosSigned(body: string): boolean {
  const normalized = body.toLowerCase();
  return (
    normalized.includes("signed and notarized") ||
    normalized.includes("developer id signed") ||
    (normalized.includes("notarized") && normalized.includes("macos"))
  );
}

/** True when the release body describes the unsigned / manual-install path. */
export function releaseNotesDescribeUnsignedManualInstall(body: string): boolean {
  const normalized = body.toLowerCase();
  return normalized.includes("currently unsigned") && normalized.includes("manual install");
}
