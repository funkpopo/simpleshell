import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const {
  buildInnoSetupArgs,
  buildInnoSetupDefines,
  extractRegistryInstallCandidates,
  findIsccPath,
  formatInstallerFilename,
  formatOutputBaseFilename,
  normalizeAppVersion,
  normalizeWindowsNumericVersion,
} = require("../../scripts/lib/inno-setup");
const MakerInnoSetup = require("../../scripts/makers/maker-inno-setup");

describe("inno-setup compiler discovery", () => {
  it("resolves ISCC.exe from ISCC_PATH (file or directory, with quotes)", () => {
    const exePath = "D:\\Custom\\Inno Setup 6\\ISCC.exe";
    const resolvedFromFile = findIsccPath({
      env: { ISCC_PATH: `"${exePath}"` },
      platform: "win32",
      existsSync: (target) => target === exePath,
      statSync: () => ({ isDirectory: () => false }),
    });
    expect(resolvedFromFile).toBe(exePath);

    const dirPath = "D:\\Custom\\Inno Setup 6";
    const resolvedFromDir = findIsccPath({
      env: { ISCC_PATH: dirPath },
      platform: "win32",
      existsSync: (target) => target === exePath,
      statSync: (target) => ({ isDirectory: () => target === dirPath }),
    });
    expect(resolvedFromDir).toBe(exePath);
  });

  it("throws an actionable error when ISCC_PATH points to a missing binary", () => {
    expect(() =>
      findIsccPath({
        env: { ISCC_PATH: "Z:\\Missing\\ISCC.exe" },
        platform: "win32",
        existsSync: () => false,
        statSync: () => null,
      }),
    ).toThrow(/ISCC_PATH.*ISCC\.exe/i);
  });

  it("resolves ISCC.exe from PATH via where iscc", () => {
    const whereExe = "C:\\Tools\\Inno Setup 6\\ISCC.exe";
    const resolved = findIsccPath({
      env: {},
      platform: "win32",
      existsSync: (target) => target === whereExe,
      statSync: () => ({ isDirectory: () => false }),
      spawnSyncImpl: (cmd) => {
        if (cmd === "where.exe") {
          return {
            status: 0,
            stdout: `C:\\Tools\\Inno Setup 6\\iscc\r\n${whereExe}\r\n`,
          };
        }
        return { status: 1, stdout: "" };
      },
    });
    expect(resolved).toBe(whereExe);
  });

  it("resolves ISCC.exe from Windows Registry Uninstall keys", () => {
    const regExe = "D:\\Inno Setup 6\\ISCC.exe";
    const resolved = findIsccPath({
      env: {},
      platform: "win32",
      existsSync: (target) => target === regExe,
      statSync: (target) => ({ isDirectory: () => target.endsWith("\\") }),
      spawnSyncImpl: (cmd, args) => {
        if (cmd === "where.exe") {
          return { status: 1, stdout: "" };
        }
        if (
          cmd === "reg.exe" &&
          args[1]?.includes(
            "WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
          )
        ) {
          return {
            status: 0,
            stdout: [
              "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
              "    Inno Setup: App Path    REG_SZ    D:\\Inno Setup 6",
              "    InstallLocation    REG_SZ    D:\\Inno Setup 6\\",
              "    DisplayIcon    REG_SZ    D:\\Inno Setup 6\\Compil32.exe",
            ].join("\r\n"),
          };
        }
        return { status: 1, stdout: "" };
      },
    });
    expect(resolved).toBe(regExe);
  });

  it("extracts candidates from DisplayIcon when InstallLocation is absent", () => {
    const candidates = extractRegistryInstallCandidates(
      '    DisplayIcon    REG_SZ    "E:\\Apps\\Inno Setup 6\\Compil32.exe",0',
    );
    expect(candidates).toEqual(["E:\\Apps\\Inno Setup 6"]);
  });

  it("falls back to common installation paths when PATH and Registry have no match", () => {
    const fallbackExe = "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe";
    const resolved = findIsccPath({
      env: {},
      platform: "win32",
      existsSync: (target) => target === fallbackExe,
      statSync: () => ({ isDirectory: () => false }),
      spawnSyncImpl: () => ({ status: 1, stdout: "" }),
    });
    expect(resolved).toBe(fallbackExe);
  });

  it("throws an actionable error with installation instructions when ISCC.exe is missing", () => {
    expect(() =>
      findIsccPath({
        env: {},
        platform: "win32",
        existsSync: () => false,
        statSync: () => null,
        spawnSyncImpl: () => ({ status: 1, stdout: "" }),
      }),
    ).toThrow(/Inno Setup 6.*ISCC_PATH.*https:\/\/jrsoftware\.org/i);
  });
});

describe("inno-setup naming and preprocessor arguments", () => {
  it("formats installer output filenames as SimpleShell-v<version>-Setup-<arch>.exe", () => {
    expect(
      formatOutputBaseFilename({
        appName: "SimpleShell",
        version: "v0.6.0",
        arch: "x64",
      }),
    ).toBe("SimpleShell-v0.6.0-Setup-x64");

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
        version: "0.6.0",
        arch: "arm64",
      }),
    ).toBe("SimpleShell-v0.6.0-Setup-arm64.exe");
  });

  it("normalizes app versions and 4-part Windows numeric versions", () => {
    expect(normalizeAppVersion("v0.6.0")).toBe("0.6.0");
    expect(normalizeWindowsNumericVersion("0.6.0")).toBe("0.6.0.0");
    expect(normalizeWindowsNumericVersion("0.6.0-beta.1")).toBe("0.6.0.0");
  });

  it("builds complete ISCC preprocessor /D arguments and script path", () => {
    const defines = buildInnoSetupDefines({
      appName: "SimpleShell",
      appVersion: "0.6.0",
      appArch: "x64",
      sourceDir: "C:\\repo\\out\\SimpleShell-win32-x64",
      outputDir: "C:\\repo\\installer",
      appIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      licenseFile: "C:\\repo\\LICENSE",
      appCopyright: "Copyright (C) 2026 funkpopo",
    });

    expect(defines).toEqual({
      AppName: "SimpleShell",
      AppVersion: "0.6.0",
      AppNumericVersion: "0.6.0.0",
      AppArch: "x64",
      SourceDir: "C:\\repo\\out\\SimpleShell-win32-x64",
      OutputDir: "C:\\repo\\installer",
      OutputBaseFilename: "SimpleShell-v0.6.0-Setup-x64",
      AppIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      LicenseFile: "C:\\repo\\LICENSE",
      AppCopyright: "Copyright (C) 2026 funkpopo",
    });

    const args = buildInnoSetupArgs({
      scriptPath: "C:\\repo\\installer\\simpleshell.iss",
      quiet: true,
      appName: "SimpleShell",
      appVersion: "0.6.0",
      appArch: "x64",
      sourceDir: "C:\\repo\\out\\SimpleShell-win32-x64",
      outputDir: "C:\\repo\\installer",
      appIcon: "C:\\repo\\src\\renderer\\assets\\logo.ico",
      licenseFile: "C:\\repo\\LICENSE",
      appCopyright: "Copyright (C) 2026 funkpopo",
    });

    expect(args[0]).toBe("/Qp");
    expect(args).toContain("/DAppName=SimpleShell");
    expect(args).toContain("/DAppVersion=0.6.0");
    expect(args).toContain("/DAppArch=x64");
    expect(args).toContain("/DOutputBaseFilename=SimpleShell-v0.6.0-Setup-x64");
    expect(args).toContain("/DOutputDir=C:\\repo\\installer");
    expect(args.at(-1)).toBe("C:\\repo\\installer\\simpleshell.iss");
  });
});

describe("forge.config.js and installer/simpleshell.iss registration", () => {
  it("registers the Inno Setup maker for win32 and keeps darwin/linux makers intact", async () => {
    const loadForgeConfig = require("../../forge.config.js");
    const forgeConfig = await loadForgeConfig();

    const makerNames = forgeConfig.makers.map((maker) => maker.name);
    expect(makerNames).toContain("./scripts/makers/maker-inno-setup.js");
    expect(makerNames).not.toContain("@electron-forge/maker-squirrel");
    expect(makerNames).toContain("@electron-forge/maker-zip");
    expect(makerNames).toContain("@electron-forge/maker-deb");
    expect(makerNames).toContain("@electron-forge/maker-rpm");

    const innoMakerEntry = forgeConfig.makers.find(
      (maker) => maker.name === "./scripts/makers/maker-inno-setup.js",
    );
    expect(innoMakerEntry.platforms).toEqual(["win32"]);
    expect(innoMakerEntry.config.appName).toBe("SimpleShell");
    expect(path.resolve(innoMakerEntry.config.scriptPath)).toBe(
      path.join(repoRoot, "installer", "simpleshell.iss"),
    );
    expect(path.resolve(innoMakerEntry.config.outputDir)).toBe(
      path.join(repoRoot, "installer"),
    );
    expect(fs.existsSync(innoMakerEntry.config.scriptPath)).toBe(true);
    expect(fs.existsSync(innoMakerEntry.config.appIcon)).toBe(true);
    expect(fs.existsSync(innoMakerEntry.config.licenseFile)).toBe(true);

    const zipMakerEntry = forgeConfig.makers.find(
      (maker) => maker.name === "@electron-forge/maker-zip",
    );
    expect(zipMakerEntry.platforms).toEqual(["darwin"]);
  });

  it("satisfies the Electron Forge Maker contract", async () => {
    const maker = new MakerInnoSetup((arch) => ({ appArch: arch }));
    expect(maker.__isElectronForgeMaker).toBe(true);
    expect(maker.name).toBe("inno-setup");
    expect(maker.platforms).toEqual(["win32"]);

    const cloned = maker.clone();
    expect(cloned).not.toBe(maker);
    await cloned.prepareConfig("arm64");
    expect(cloned.config).toEqual({ appArch: "arm64" });
  });

  it("defines expected directives and safe ChineseSimplified.isl guard in installer/simpleshell.iss", () => {
    const issPath = path.join(repoRoot, "installer", "simpleshell.iss");
    const issContent = fs.readFileSync(issPath, "utf8");

    for (const token of [
      "AppName",
      "AppVersion",
      "AppArch",
      "SourceDir",
      "OutputDir",
      "OutputBaseFilename",
      "AppIcon",
      "LicenseFile",
      "AppCopyright",
      "AppId={{",
      "PrivilegesRequired=lowest",
      "PrivilegesRequiredOverridesAllowed=dialog",
      "DefaultDirName={autopf}\\{#AppName}",
      "CloseApplications=force",
      "RestartApplications=yes",
      "Compression=lzma2",
      "SolidCompression=yes",
      'Name: "desktopicon"',
      'Name: "{autoprograms}\\{#AppName}"',
      "skipifsilent",
      'FileExists(CompilerPath + "Languages\\ChineseSimplified.isl")',
    ]) {
      expect(issContent).toContain(token);
    }
  });
});
