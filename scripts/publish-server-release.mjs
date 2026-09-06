import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export function assertPublishedArtifact(published, expected) {
  if (
    published.name !== expected.name ||
    published.version !== expected.version ||
    published.dist?.integrity !== expected.integrity
  ) {
    throw new Error(
      "npm already contains different bytes for this version. Choose a new version; never replace a release.",
    );
  }
}

export async function publishServerRelease(directory, version, channel) {
  if (process.env.GITHUB_REPOSITORY !== "leonaaardob/t3-orchestrator") {
    throw new Error("Publishing is restricted to leonaaardob/t3-orchestrator.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version) || channel !== "latest") {
    throw new Error("This release workflow supports stable versions only.");
  }
  const files = NodeFS.readdirSync(directory).filter((file) => file.endsWith(".tgz"));
  if (files.length !== 1) throw new Error("Expected exactly one tested server tarball.");
  const tarball = NodePath.resolve(directory, files[0]);
  const manifest = JSON.parse(
    NodeChildProcess.execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  if (manifest.name !== "t3-orchestrator" || manifest.version !== version) {
    throw new Error("Server artifact does not match the desktop release.");
  }
  const expected = {
    name: manifest.name,
    version,
    integrity: `sha512-${NodeCrypto.createHash("sha512").update(NodeFS.readFileSync(tarball)).digest("base64")}`,
  };
  const endpoint = `https://registry.npmjs.org/t3-orchestrator/${version}`;
  const before = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
  if (before.ok) {
    assertPublishedArtifact(await before.json(), expected);
    console.log(
      `Verified existing identical t3-orchestrator@${version}; resuming desktop publication.`,
    );
  } else {
    if (before.status !== 404) throw new Error(`npm registry returned HTTP ${before.status}.`);
    NodeChildProcess.execFileSync(
      "npm",
      [
        "publish",
        tarball,
        "--access",
        "public",
        "--tag",
        channel,
        "--provenance",
        "--registry",
        "https://registry.npmjs.org",
      ],
      { stdio: "inherit" },
    );
  }
  // Registry propagation can lag a successful publish. Never release desktop
  // clients until the exact server artifact is publicly retrievable.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
    if (response.ok) {
      const published = await response.json();
      assertPublishedArtifact(published, expected);
      const download = await fetch(published.dist.tarball, { signal: AbortSignal.timeout(60_000) });
      if (!download.ok) throw new Error(`npm tarball returned HTTP ${download.status}.`);
      const integrity = `sha512-${NodeCrypto.createHash("sha512")
        .update(Buffer.from(await download.arrayBuffer()))
        .digest("base64")}`;
      if (integrity !== expected.integrity)
        throw new Error("Downloaded npm tarball integrity mismatch.");
      console.log(`Published and downloaded matching t3-orchestrator@${version}.`);
      return;
    }
    if (response.status !== 404) throw new Error(`npm registry returned HTTP ${response.status}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  }
  throw new Error(
    "npm publication is not publicly available yet; desktop publication remains blocked.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  await publishServerRelease(process.argv[2], process.argv[3], process.argv[4]);
}
