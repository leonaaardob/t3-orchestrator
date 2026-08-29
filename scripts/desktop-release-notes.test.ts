import { describe, expect, it } from "vitest";

import {
  buildDesktopReleaseNotes,
  releaseNotesClaimMacosSigned,
  releaseNotesDescribeUnsignedManualInstall,
} from "./lib/desktop-release-notes.ts";

describe("buildDesktopReleaseNotes", () => {
  it("describes unsigned macOS with manual install and never claims notarization", () => {
    const body = buildDesktopReleaseNotes({ macosSigned: false });

    expect(releaseNotesDescribeUnsignedManualInstall(body)).toBe(true);
    expect(releaseNotesClaimMacosSigned(body)).toBe(false);
    expect(body.toLowerCase()).not.toContain("notarized");
    expect(body.toLowerCase()).not.toContain("automatic installation");
    expect(body).toContain("Windows may show a SmartScreen warning");
  });

  it("allows signed/notarized wording only when macosSigned is true", () => {
    const body = buildDesktopReleaseNotes({ macosSigned: true });

    expect(releaseNotesClaimMacosSigned(body)).toBe(true);
    expect(releaseNotesDescribeUnsignedManualInstall(body)).toBe(false);
    expect(body).toContain("Developer ID signed and notarized");
    expect(body).toContain("Automatic installation is available on signed macOS builds");
    expect(body.toLowerCase()).not.toContain("currently unsigned");
  });
});
