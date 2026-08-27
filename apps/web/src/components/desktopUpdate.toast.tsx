import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateManualDownloadUrl,
  getDesktopUpdateReleaseUrl,
} from "./desktopUpdate.logic";
import { toastManager } from "./ui/toast";

type DesktopUpdateShell = Pick<DesktopBridge, "openExternal">;

function ReleaseNotesLink({
  shell,
  releaseUrl,
}: {
  shell: DesktopUpdateShell;
  releaseUrl: string;
}) {
  return (
    <button
      className="ml-2 inline cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      onClick={() => {
        void (async () => {
          try {
            if (await shell.openExternal(releaseUrl)) return;
          } catch {
            // Surface rejected IPC calls through the same user-visible fallback.
          }
          toastManager.add({ type: "error", title: "Unable to open release notes" });
        })();
      }}
      type="button"
    >
      Read more
      <ArrowRightIcon
        aria-hidden
        className="ml-1 inline size-3 -rotate-45 align-[-0.125em]"
        strokeWidth={2.25}
      />
    </button>
  );
}

export function showDesktopUpdateDownloadedToast(
  shell: DesktopUpdateShell,
  state: DesktopUpdateState,
): void {
  if (!state.automaticInstallAvailable) {
    const downloadUrl = getDesktopUpdateManualDownloadUrl(state);
    toastManager.add({
      type: "success",
      title: `Download T3 Orchestrator ${state.availableVersion ?? "update"}`,
      description: downloadUrl ? (
        <>
          Automatic installation is unavailable on unsigned macOS builds. Download and install the
          update manually.
          <ReleaseNotesLink releaseUrl={downloadUrl} shell={shell} />
        </>
      ) : (
        "Automatic installation is unavailable on unsigned macOS builds. Download and install the update manually."
      ),
    });
    return;
  }
  const releaseUrl = getDesktopUpdateReleaseUrl(getDesktopUpdateDownloadedVersion(state));
  toastManager.add({
    type: "success",
    title: "Update downloaded",
    description: (
      <>
        Restart the app from the update button to install it.
        {releaseUrl ? <ReleaseNotesLink releaseUrl={releaseUrl} shell={shell} /> : null}
      </>
    ),
  });
}
