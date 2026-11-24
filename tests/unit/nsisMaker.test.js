import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const {
  buildNsisBuilderConfig,
  buildNsisInstaller,
  formatInstallerFilename,
  normalizeAppVersion,
  normalizeArch,
  prepareStagingLicenseFile,
} = require("../../scripts/lib/nsis-builder");
const MakerNsis = require("../../scripts/makers/maker-nsis");

describe("nsis-builder configuration and naming", () => {
  it("normalizes architectures and rejects unsupported values", () => {
    expect(normalizeArch("x64")).toBe("x64");
    expect(normalizeArch(" ARM64 ")).toBe("arm64");
    expect(normalizeArch("ia32")).toBe("ia32");
    expect(() => normalizeArch("mips")).toThrow(/unsupported/i);
  });

  it("formats installer filenames as SimpleShell-v<version>-Setup-<arch>.exe", () => {
    expect(
      formatInstallerFilename({
        appName: "SimpleShell",
        version: "0.6.0",
        arch: "x64",
      }),
    ).toBe("SimpleShell-v0.6.0-Setup-x64.exe");
    expect(
      formatInstallerFilename({
        appName: "SimpleShell",
        version: "0.6.1",
        arch: "arm64",
      }),
    ).toBe("SimpleShell-v0.6.1-Setup-arm64.exe");
    expect(() => normalizeAppVersion("")).toThrow(/required/i);
  });

  it("builds NSIS electron-builder config with wizard, multi-language, and Forge exe preservation", () => {
    const config = buildNsisBuilderConfig({
      appId: "com.funkpopo.simpleshell",
      appName: "SimpleShell",
      executableName: "SimpleShell",
      appVersion: "0.6.0",
      appArch: "x64",
      appCopyright: "Copyright (C) 2026 funkpopo",
      outputDir: "C:\\repo\\out\\make\\nsis\\x64",
      appIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      licenseFile: "C:\\repo\\out\\make\\nsis\\x64\\LICENSE.txt",
      electronVersion: "40.4.1",
    });

    expect(config.appId).toBe("com.funkpopo.simpleshell");
    expect(config.productName).toBe("SimpleShell");
    expect(config.publish).toBeNull();
    expect(config.extraMetadata).toEqual({ version: "0.6.0" });
    expect(config.electronVersion).toBe("40.4.1");
    expect(config.win).toEqual({
      executableName: "SimpleShell",
      icon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      signAndEditExecutable: false,
      target: [{ target: "nsis", arch: ["x64"] }],
    });
    expect(config.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "SimpleShell",
      installerIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      uninstallerIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      installerHeaderIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      license: "C:\\repo\\out\\make\\nsis\\x64\\LICENSE.txt",
      deleteAppDataOnUninstall: false,
      runAfterFinish: true,
      unicode: true,
      multiLanguageInstaller: true,
      installerLanguages: ["zh_CN", "en_US"],
      displayLanguageSelector: true,
      differentialPackage: false,
      artifactName: "SimpleShell-v0.6.0-Setup-x64.exe",
    });
  });

  it("stages LICENSE as UTF-8 BOM LICENSE.txt without altering the source LICENSE file", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "simpleshell-nsis-lic-"),
    );
    try {
      const sourceLicense = path.join(tempRoot, "LICENSE");
      const stagingDir = path.join(tempRoot, "staging");
      fs.writeFileSync(sourceLicense, "Apache License 2.0\n", "utf8");

      const staged = await prepareStagingLicenseFile(sourceLicense, stagingDir);
      expect(staged).toBe(path.join(stagingDir, "LICENSE.txt"));
      const buf = fs.readFileSync(staged);
      expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(
        true,
      );
      expect(buf.subarray(3).toString("utf8")).toBe("Apache License 2.0\n");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("invokes electron-builder.build with prepackaged directory and Windows NSIS target", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "simpleshell-nsis-build-"),
    );
    try {
      const prepackagedDir = path.join(tempRoot, "app");
      fs.mkdirSync(prepackagedDir, { recursive: true });

      let receivedArgs = null;
      const fakeBuilder = {
        Arch: { x64: 1, arm64: 3, ia32: 0 },
        Platform: {
          WINDOWS: {
            createTarget: (target, arch) => ({ target, arch }),
          },
        },
        build: async (opts) => {
          receivedArgs = opts;
          return [path.join(opts.config.directories.output, "installer.exe")];
        },
      };

      const config = buildNsisBuilderConfig({
        appVersion: "0.6.0",
        appArch: "x64",
        outputDir: path.join(tempRoot, "out"),
      });

      const result = await buildNsisInstaller({
        prepackagedDir,
        targetArch: "x64",
        config,
        electronBuilder: fakeBuilder,
      });

      expect(receivedArgs.prepackaged).toBe(path.resolve(prepackagedDir));
      expect(receivedArgs.targets).toEqual({ target: "nsis", arch: 1 });
      expect(receivedArgs.config).toBe(config);
      expect(result).toHaveLength(1);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("MakerNsis and forge.config.js registration", () => {
  it("stages NSIS build artifacts and writes only the installer exe into installer/", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "simpleshell-nsis-maker-"),
    );
    try {
      const packagedDir = path.join(tempRoot, "out", "SimpleShell-win32-x64");
      const makeDir = path.join(tempRoot, "out", "make");
      const outputDir = path.join(tempRoot, "installer");
      const iconPath = path.join(tempRoot, "logo.ico");
      const licensePath = path.join(tempRoot, "LICENSE");

      fs.mkdirSync(packagedDir, { recursive: true });
      fs.writeFileSync(iconPath, "ico", "utf8");
      fs.writeFileSync(licensePath, "Apache-2.0", "utf8");

      let capturedBuildOptions = null;
      const fakeBuilder = {
        Arch: { x64: 1 },
        Platform: {
          WINDOWS: {
            createTarget: (target, arch) => ({ target, arch }),
          },
        },
        build: async (opts) => {
          capturedBuildOptions = opts;
          const exePath = path.join(
            opts.config.directories.output,
            opts.config.nsis.artifactName,
          );
          fs.writeFileSync(exePath, "MZ-nsis-installer-payload", "utf8");
          fs.writeFileSync(
            path.join(
              opts.config.directories.output,
              "builder-effective-config.yaml",
            ),
            "appId: test\n",
            "utf8",
          );
          return [exePath];
        },
      };

      const maker = new MakerNsis({
        projectRoot: tempRoot,
        appName: "SimpleShell",
        outputDir,
        appIcon: iconPath,
        licenseFile: licensePath,
        electronBuilder: fakeBuilder,
      });
      await maker.prepareConfig("x64");

      const produced = await maker.make({
        dir: packagedDir,
        makeDir,
        appName: "SimpleShell",
        targetPlatform: "win32",
        targetArch: "x64",
        forgeConfig: { packagerConfig: { appBundleId: "com.test.app" } },
        packageJSON: {
          name: "simpleshell",
          productName: "SimpleShell",
          version: "0.6.0",
          devDependencies: { electron: "^40.4.1" },
        },
      });

      const expectedExe = path.join(
        outputDir,
        "SimpleShell-v0.6.0-Setup-x64.exe",
      );
      expect(produced).toEqual([expectedExe]);
      expect(fs.existsSync(expectedExe)).toBe(true);
      expect(fs.readdirSync(outputDir)).toEqual([
        "SimpleShell-v0.6.0-Setup-x64.exe",
      ]);
      expect(capturedBuildOptions.config.electronVersion).toBe("40.4.1");
      expect(capturedBuildOptions.config.win.signAndEditExecutable).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-win32 targets and missing packaged directory", async () => {
    const maker = new MakerNsis({ projectRoot: repoRoot });
    await maker.prepareConfig("x64");

    await expect(
      maker.make({
        dir: repoRoot,
        targetPlatform: "linux",
        targetArch: "x64",
        packageJSON: { version: "0.6.0" },
      }),
    ).rejects.toThrow(/only supports win32/i);

    await expect(
      maker.make({
        dir: path.join(repoRoot, "__missing_dir__"),
        targetPlatform: "win32",
        targetArch: "x64",
        packageJSON: { version: "0.6.0" },
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("registers MakerNsis for win32 in forge.config.js without Inno Setup references", async () => {
    const forgeConfigFactory = require(path.join(repoRoot, "forge.config.js"));
    const forgeConfig = await forgeConfigFactory();
    const makerNames = forgeConfig.makers.map((maker) => maker.name);

    expect(makerNames).toContain("./scripts/makers/maker-nsis.js");
    expect(makerNames).not.toContain("./scripts/makers/maker-inno-setup.js");
    expect(makerNames).toContain("@electron-forge/maker-zip");
    expect(makerNames).toContain("@electron-forge/maker-deb");
    expect(makerNames).toContain("@electron-forge/maker-rpm");

    const nsisMakerEntry = forgeConfig.makers.find(
      (maker) => maker.name === "./scripts/makers/maker-nsis.js",
    );
    expect(nsisMakerEntry.platforms).toEqual(["win32"]);
    expect(nsisMakerEntry.config.appName).toBe("SimpleShell");
    expect(nsisMakerEntry.config.appId).toBe("com.funkpopo.simpleshell");
    expect(path.resolve(nsisMakerEntry.config.outputDir)).toBe(
      path.join(repoRoot, "installer"),
    );
    expect(fs.existsSync(nsisMakerEntry.config.appIcon)).toBe(true);
    expect(fs.existsSync(nsisMakerEntry.config.licenseFile)).toBe(true);
    expect(
      fs.existsSync(path.join(repoRoot, "installer", "simpleshell.iss")),
    ).toBe(false);
  });
});
