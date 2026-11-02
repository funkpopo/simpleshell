#!/usr/bin/env node
/**
 * Re-vendors russh from crates.io and applies SimpleShell's patches.
 *
 *   node scripts/vendor-russh.js <version>
 *
 * Downloads `russh-<version>.crate` into a scratch directory, removes the parts
 * the workspace does not build (examples, benches, registry metadata), applies
 * `native-services/vendor/patches/*.patch` in order with `git apply`, and only
 * then replaces `native-services/vendor/russh`. A patch that no longer applies
 * aborts the run and leaves the current vendored copy untouched.
 *
 * Afterwards: update the `russh` version pin in native-services/Cargo.toml,
 * then run the vendored and workspace test suites (see vendor/README.md).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const VENDOR = path.join(ROOT, "native-services", "vendor");
const TARGET = path.join(VENDOR, "russh");
const PATCHES = path.join(VENDOR, "patches");
const DROPPED = [
  "benches",
  "examples",
  "README.md",
  "Cargo.toml.orig",
  ".cargo_vcs_info.json",
  ".cargo-ok",
];

async function main() {
  const version = process.argv[2];
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
    throw new Error("usage: node scripts/vendor-russh.js <version>");
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "russh-vendor-"));
  const archive = path.join(scratch, `russh-${version}.crate`);
  const response = await fetch(
    `https://static.crates.io/crates/russh/russh-${version}.crate`,
  );
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync("tar", ["xzf", archive, "-C", scratch]);

  const tree = path.join(scratch, `russh-${version}`);
  for (const entry of DROPPED) {
    fs.rmSync(path.join(tree, entry), { recursive: true, force: true });
  }
  const patches = fs
    .readdirSync(PATCHES)
    .filter((name) => name.endsWith(".patch"))
    .sort();
  for (const name of patches) {
    process.stdout.write(`applying ${name}\n`);
    execFileSync("git", ["apply", "-p1", path.join(PATCHES, name)], {
      cwd: tree,
      stdio: "inherit",
    });
  }

  // Keep the existing lockfile; cargo refreshes it on the next build.
  const lockfile = path.join(TARGET, "Cargo.lock");
  if (fs.existsSync(lockfile)) {
    fs.copyFileSync(lockfile, path.join(tree, "Cargo.lock"));
  }
  fs.rmSync(TARGET, { recursive: true, force: true });
  fs.cpSync(tree, TARGET, { recursive: true });
  fs.rmSync(scratch, { recursive: true, force: true });
  process.stdout.write(
    `vendored russh ${version} with ${patches.length} patch(es)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[vendor-russh] ${error.message}\n`);
  process.exit(1);
});
