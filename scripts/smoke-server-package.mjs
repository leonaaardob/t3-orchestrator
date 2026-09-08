import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const tarball = NodePath.resolve(process.argv[2]);
const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "orchestrator-package-smoke-"));
let child;
try {
  NodeChildProcess.execFileSync(
    "npm",
    ["install", "--prefix", temporary, "--no-audit", "--no-fund", tarball],
    {
      stdio: "inherit",
    },
  );
  const packageRoot = NodePath.join(temporary, "node_modules/t3-orchestrator");
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(packageRoot, "package.json"), "utf8"),
  );
  NodeAssert.equal(manifest.name, "t3-orchestrator");
  NodeAssert.ok(!JSON.stringify(manifest.dependencies).includes("catalog:"));
  const entry = NodePath.join(packageRoot, "dist/bin.mjs");
  const env = { ...process.env, T3CODE_HOME: NodePath.join(temporary, "state") };
  // This standalone child has no launcher IPC, even when the test runs inside T3.
  delete env.T3_SERVICE_LAUNCHER_CONTEXT;
  const version = NodeChildProcess.execFileSync(process.execPath, [entry, "--version"], {
    encoding: "utf8",
    env,
  });
  NodeAssert.ok(version.includes(manifest.version), "Built CLI and package versions must match");
  const preflight = JSON.parse(
    NodeChildProcess.execFileSync(
      process.execPath,
      [
        entry,
        "__service-preflight",
        "--database-path",
        NodePath.join(temporary, "state.sqlite"),
        "--launcher-protocol",
        "2",
      ],
      { encoding: "utf8", env },
    ),
  );
  NodeAssert.equal(preflight.status, "ready");
  NodeAssert.equal(preflight.version, manifest.version);
  NodeFS.readFileSync(NodePath.join(packageRoot, "dist/service-launcher.mjs"));
  NodeFS.readFileSync(NodePath.join(packageRoot, "dist/client/index.html"));
  const listener = NodeNet.createServer();
  listener.listen(0, "127.0.0.1");
  await NodeEvents.once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done, fail) => listener.close((error) => (error ? fail(error) : done())));
  child = NodeChildProcess.spawn(
    process.execPath,
    [
      entry,
      "--base-dir",
      env.T3CODE_HOME,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-browser",
    ],
    { cwd: temporary, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((done, fail) => {
    // Tokens in startup output stay in memory and are never printed.
    let output = "";
    const deadline = setTimeout(
      () => fail(new Error("Packaged server did not become ready within 60 seconds.")),
      60_000,
    );
    const onData = (data) => {
      output = (output + data.toString()).slice(-65_536);
      if (
        output.includes("Authentication required. Open T3 Code") ||
        output.includes("T3 Code server is ready.")
      ) {
        clearTimeout(deadline);
        done();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(deadline);
      fail(error);
    });
    child.once("exit", (code) => {
      clearTimeout(deadline);
      fail(new Error(`Packaged server exited before readiness (${code}).`));
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    signal: AbortSignal.timeout(10_000),
  });
  NodeAssert.equal(response.status, 200);
  NodeAssert.ok(
    (await response.text()).includes("<html"),
    "Standalone server must serve its web client",
  );
  console.log(
    `Installed, preflighted and started t3-orchestrator@${manifest.version}; bundled web client responds.`,
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = NodeEvents.once(child, "exit");
    child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(deadline);
  }
  NodeFS.rmSync(temporary, { recursive: true, force: true });
}
