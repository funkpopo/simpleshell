import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runRendererFixture } from "../helpers/runRendererFixture.js";

describe("Electron renderer integration", () => {
  it("keeps the AI surface styled in both themes without global CSS overrides", () =>
    runRendererFixture({
      name: "theme",
      entry: "theme-renderer.jsx",
      main: "theme-electron.js",
    }));
  it("edits port forwarding rules and restores focused sessions", () =>
    runRendererFixture({
      name: "port-forwarding",
      entry: "port-forwarding-renderer.jsx",
      main: "port-forwarding-renderer-electron.js",
    }));
  it("keeps SFTP navigation, transfers and directory following across sessions", () =>
    runRendererFixture({
      name: "sftp",
      entry: "sftp-renderer.jsx",
      main: "sftp-renderer-electron.js",
    }));
  it("preserves split terminal selection, resize, sessions and ZMODEM", () =>
    runRendererFixture({
      name: "screen-split",
      entry: "screen-split-renderer.jsx",
      main: "screen-split-electron.js",
    }));
  it("executes production bundles under the packaged content security policy", async () => {
    const output = await runRendererFixture({
      name: "production-csp",
      entry: "production-csp-renderer.js",
      main: "production-csp-electron.js",
      production: true,
    });
    const html = await fs.readFile(path.join(output, "index.html"), "utf8");
    expect(html).toMatch(/script-src 'self'/);
    expect(html).not.toMatch(/unsafe-eval|<%|ws:\/\//);
  });
});
