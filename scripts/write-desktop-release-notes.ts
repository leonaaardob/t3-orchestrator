#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone synchronous release-note writer.

/**
 * Writes the fork desktop GitHub Release body for desktop-release.yml.
 *
 * Usage:
 *   node scripts/write-desktop-release-notes.ts --out release-notes.md
 *   node scripts/write-desktop-release-notes.ts --macos-signed --out release-notes.md
 */

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

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

NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(outPath)), { recursive: true });
NodeFS.writeFileSync(outPath, body, "utf8");
console.log(
  `Wrote desktop release notes (${readFlag("--macos-signed") ? "signed" : "unsigned"} macOS) to ${outPath}`,
);
