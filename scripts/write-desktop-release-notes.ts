#!/usr/bin/env node

/**
 * Writes the fork desktop GitHub Release body for desktop-release.yml.
 *
 * Usage:
 *   node scripts/write-desktop-release-notes.ts --out release-notes.md
 *   node scripts/write-desktop-release-notes.ts --macos-signed --out release-notes.md
 */

import * as Fs from "node:fs";
import * as Path from "node:path";

import { buildDesktopReleaseNotes } from "./lib/desktop-release-notes.ts";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const outPath = readOption("--out");
if (!outPath) {
  console.error("Usage: node scripts/write-desktop-release-notes.ts [--macos-signed] --out <path>");
  process.exit(1);
}

const body = buildDesktopReleaseNotes({
  macosSigned: readFlag("--macos-signed"),
});

Fs.mkdirSync(Path.dirname(Path.resolve(outPath)), { recursive: true });
Fs.writeFileSync(outPath, body, "utf8");
console.log(
  `Wrote desktop release notes (${readFlag("--macos-signed") ? "signed" : "unsigned"} macOS) to ${outPath}`,
);
