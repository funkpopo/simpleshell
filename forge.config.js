const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { WebpackPlugin } = require("@electron-forge/plugin-webpack");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const fsExtra = require("fs-extra");
const webpack = require("webpack");

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_DEV_SERVER_PORT = 3001;
const DEFAULT_LOGGER_PORT = 19001;
const PRODUCT_NAME = "SimpleShell";
const PACKAGE_NAME = "simpleshell";
const APP_BUNDLE_ID = "com.funkpopo.simpleshell";
const APP_CATEGORY_TYPE = "public.app-category.developer-tools";
const APP_HOMEPAGE = "https://github.com/funkpopo/simpleshell";
const APP_DESCRIPTION = "A Simple Electron SSH Terminal for Windows";
const AUTHOR = "funkpopo <funkpopoisme@gmail.com>";
const LOCALE_PAKS_TO_KEEP = new Set(["en-US.pak", "zh-CN.pak"]);
const WORKER_UNPACK_DIRS = [
  ".webpack/main/workers",
  ".webpack\\main\\workers",
  "src/workers",
  "src\\workers",
];
const SIDECAR_BASENAME =
  process.platform === "win32" ? "transfer-sidecar.exe" : "transfer-sidecar";
const WINDOWS_ICON_PATH = path.join(__dirname, "src", "assets", "logo.ico");
const LINUX_ICON_PATH = path.join(
  __dirname,
  "src",
  "assets",
  "SimpleShell.png",
);
const MAC_ENTITLEMENTS_PATH = path.join(__dirname, "entitlements.plist");
const WEBPACK_DIR = path.resolve(__dirname, ".webpack");
const WINDOWS_MOVE_RETRY_DELAY_MS = 250;
const WINDOWS_MOVE_RETRIES = 8;
const PACKAGED_SCRIPT_NAMES_TO_REMOVE = new Set([
  "run-checks.js",
  "release-check.js",
  "generate-checksums.js",
  "prepare-rust-sidecar.js",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableWindowsMoveError = (error) =>
  process.platform === "win32" &&
  ["EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code);

const isWebpackPath = (value) => {
  const relativePath = path.relative(WEBPACK_DIR, path.resolve(value));

  return relativePath === "" || !relativePath.startsWith("..");
};

const isWebpackMove = (src, dest) => isWebpackPath(src) && isWebpackPath(dest);

const installWindowsWebpackMoveFallback = () => {
  if (process.platform !== "win32" || fsExtra.__simpleShellWebpackMovePatch) {
    return;
  }

  const originalMove = fsExtra.move.bind(fsExtra);

  const moveWithFallback = async (src, dest, options) => {
    try {
      return await originalMove(src, dest, options);
    } catch (error) {
      if (!isWebpackMove(src, dest) || !isRetryableWindowsMoveError(error)) {
        throw error;
      }

      for (let attempt = 0; attempt < WINDOWS_MOVE_RETRIES; attempt += 1) {
        await sleep(WINDOWS_MOVE_RETRY_DELAY_MS);

        try {
          return await originalMove(src, dest, options);
        } catch (retryError) {
          if (!isRetryableWindowsMoveError(retryError)) {
            throw retryError;
          }
        }
      }

      await fsExtra.copy(src, dest, {
        errorOnExist: true,
        overwrite: false,
      });
      await fsExtra.remove(src);

      return undefined;
    }
  };

  fsExtra.move = (src, dest, options, callback) => {
    if (typeof options === "function") {
      return moveWithFallback(src, dest).then(
        () => options(),
        (error) => options(error),
      );
    }

    if (typeof callback === "function") {
      return moveWithFallback(src, dest, options).then(
        () => callback(),
        (error) => callback(error),
      );
    }

    return moveWithFallback(src, dest, options);
  };

  Object.defineProperty(fsExtra, "__simpleShellWebpackMovePatch", {
    value: true,
  });
};

installWindowsWebpackMoveFallback();

const closeWebpackCompiler = (compiler) =>
  new Promise((resolve, reject) => {
    if (typeof compiler.close !== "function") {
      resolve();
      return;
    }

    compiler.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

class WindowsSafeWebpackPlugin extends WebpackPlugin {
  constructor(config) {
    super(config);

    const compileMain = this.compileMain;

    this.compileMain = async (watch = false, logger) => {
      if (watch) {
        return compileMain.call(this, watch, logger);
      }

      let tab;
      if (logger) {
        tab = logger.createTab("Main Process");
      }

      const mainConfig = await this.configGenerator.getMainConfig();

      await new Promise((resolve, reject) => {
        const compiler = webpack(mainConfig);

        compiler.run(async (err, stats) => {
          let primaryError = err || null;

          try {
            if (tab && stats) {
              tab.log(stats.toString({ colors: true }));
            }

            if (this.config.jsonStats) {
              await this.writeJSONStats(
                "main",
                stats,
                mainConfig.stats,
                "main",
              );
            }

            if (!primaryError && stats?.hasErrors()) {
              primaryError = new Error(
                `Compilation errors in the main process: ${stats.toString()}`,
              );
            }

            await closeWebpackCompiler(compiler);
          } catch (error) {
            primaryError = primaryError || error;
          }

          if (primaryError) {
            reject(primaryError);
            return;
          }

          resolve();
        });
      });
    };

    this.runWebpack = async (options, rendererOptions) =>
      new Promise((resolve, reject) => {
        const compiler = webpack(options);

        compiler.run(async (err, stats) => {
          let primaryError = err || null;

          try {
            if (rendererOptions?.jsonStats) {
              for (const [index, entryStats] of (
                stats?.stats || []
              ).entries()) {
                const name = rendererOptions.entryPoints[index].name;
                const statsOptions = Array.isArray(options)
                  ? options[index].stats
                  : options.stats;

                await this.writeJSONStats(
                  "renderer",
                  entryStats,
                  statsOptions,
                  name,
                );
              }
            }

            await closeWebpackCompiler(compiler);
          } catch (error) {
            primaryError = primaryError || error;
          }

          if (primaryError) {
            reject(primaryError);
            return;
          }

          resolve(stats);
        });
      });
  }
}

const parsePort = (rawValue, fallback) => {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return fallback;
  }

  return parsed;
};

const isPortAvailable = (port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();

    tester.once("error", () => {
      resolve(false);
    });

    tester.once("listening", () => {
      tester.once("close", () => resolve(true));
      tester.close();
    });

    // Don't bind only to 127.0.0.1: Forge's logger binds to all interfaces (often `:::PORT`),
    // and a port can be "free" on 127.0.0.1 but already taken on ::/0.0.0.0.
    tester.listen({ port, exclusive: true });
  });

const findAvailablePort = async (preferredPorts, fallbackStart) => {
  const checked = new Set();

  for (const candidate of preferredPorts) {
    if (
      !Number.isInteger(candidate) ||
      candidate < MIN_PORT ||
      candidate > MAX_PORT
    ) {
      continue;
    }

    if (checked.has(candidate)) {
      continue;
    }

    checked.add(candidate);

    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }

  let port = Math.min(Math.max(fallbackStart, MIN_PORT), MAX_PORT);

  while (port <= MAX_PORT) {
    if (!checked.has(port) && (await isPortAvailable(port))) {
      return port;
    }

    port += 1;
  }

  throw new Error("Unable to locate a free TCP port in the 1024-65535 range");
};

const keepOnlyRequiredLocalePaks = async (buildPath) => {
  const localesDir = path.join(buildPath, "locales");

  let localeEntries = [];

  try {
    localeEntries = await fs.readdir(localesDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const filesToRemove = localeEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".pak") &&
        !LOCALE_PAKS_TO_KEEP.has(entry.name),
    )
    .map((entry) => fs.unlink(path.join(localesDir, entry.name)));

  await Promise.all(filesToRemove);
};

const cleanupLocalesHook = ({ buildPath }) =>
  keepOnlyRequiredLocalePaks(buildPath);

const shouldRemovePackagedScript = (entry) =>
  entry.isFile() &&
  (entry.name.startsWith("check-") ||
    PACKAGED_SCRIPT_NAMES_TO_REMOVE.has(entry.name));

const cleanupPackagedDevelopmentFiles = async (buildPath) => {
  const scriptsDir = path.join(buildPath, "scripts");
  const packageJsonPath = path.join(buildPath, "package.json");

  try {
    const scriptEntries = await fs.readdir(scriptsDir, { withFileTypes: true });
    await Promise.all(
      scriptEntries
        .filter(shouldRemovePackagedScript)
        .map((entry) =>
          fs.rm(path.join(scriptsDir, entry.name), { force: true }),
        ),
    );
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  let packageJson;
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  delete packageJson.scripts;

  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
};

const cleanupPackagedDevelopmentFilesHook = ({ buildPath }) =>
  cleanupPackagedDevelopmentFiles(buildPath);

const buildMacSignConfig = () => {
  if (!process.env.MAC_CODESIGN_IDENTITY) {
    return undefined;
  }

  return {
    identity: process.env.MAC_CODESIGN_IDENTITY,
    hardenedRuntime: true,
    entitlements: MAC_ENTITLEMENTS_PATH,
    optionsForFile: () => ({
      entitlements: MAC_ENTITLEMENTS_PATH,
      hardenedRuntime: true,
    }),
  };
};

const buildMacNotarizeConfig = (macSignConfig) => {
  if (!macSignConfig) {
    return undefined;
  }

  if (process.env.MAC_NOTARIZE_KEYCHAIN_PROFILE) {
    return {
      keychainProfile: process.env.MAC_NOTARIZE_KEYCHAIN_PROFILE,
      ...(process.env.MAC_NOTARIZE_KEYCHAIN
        ? { keychain: process.env.MAC_NOTARIZE_KEYCHAIN }
        : {}),
    };
  }

  if (
    process.env.APPLE_ID &&
    process.env.APPLE_ID_PASSWORD &&
    process.env.APPLE_TEAM_ID
  ) {
    return {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    };
  }

  if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER
  ) {
    return {
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    };
  }

  return undefined;
};

module.exports = async () => {
  const devPortPreference = parsePort(
    process.env.WEBPACK_DEV_PORT,
    DEFAULT_DEV_SERVER_PORT,
  );
  const loggerPortPreference = parsePort(
    process.env.WEBPACK_LOGGER_PORT,
    DEFAULT_LOGGER_PORT,
  );

  const devServerPort = await findAvailablePort(
    [devPortPreference],
    devPortPreference,
  );

  const loggerCandidates = [];

  const addLoggerCandidate = (value) => {
    if (
      Number.isInteger(value) &&
      value >= MIN_PORT &&
      value <= MAX_PORT &&
      value !== devServerPort &&
      !loggerCandidates.includes(value)
    ) {
      loggerCandidates.push(value);
    }
  };

  addLoggerCandidate(loggerPortPreference);
  addLoggerCandidate(DEFAULT_LOGGER_PORT);
  addLoggerCandidate(devServerPort + 1);

  if (loggerPortPreference === devServerPort) {
    addLoggerCandidate(loggerPortPreference + 1);
  }

  if (loggerCandidates.length === 0) {
    addLoggerCandidate(DEFAULT_LOGGER_PORT + 1);
  }

  const loggerPort = await findAvailablePort(
    loggerCandidates,
    Math.max(devServerPort + 1, DEFAULT_LOGGER_PORT),
  );
  const macSignConfig = buildMacSignConfig();
  const macNotarizeConfig = buildMacNotarizeConfig(macSignConfig);

  return {
    packagerConfig: {
      name: PRODUCT_NAME,
      executableName: PRODUCT_NAME,
      appBundleId: APP_BUNDLE_ID,
      appCategoryType: APP_CATEGORY_TYPE,
      appCopyright: `Copyright © ${new Date().getFullYear()} funkpopo`,
      win32metadata: {
        CompanyName: "funkpopo",
        FileDescription: APP_DESCRIPTION,
        OriginalFilename: `${PRODUCT_NAME}.exe`,
        ProductName: PRODUCT_NAME,
        InternalName: PRODUCT_NAME,
      },
      asar: {
        unpackDir: `{${WORKER_UNPACK_DIRS.join(",")}}`,
      },
      icon: "./src/assets/logo",
      ...(macSignConfig ? { osxSign: macSignConfig } : {}),
      ...(macNotarizeConfig ? { osxNotarize: macNotarizeConfig } : {}),
      extraResource: [
        path.join(
          __dirname,
          "transfernative",
          "bin",
          `${process.platform}-${process.arch}`,
          SIDECAR_BASENAME,
        ),
      ],
      afterPrune: [cleanupPackagedDevelopmentFilesHook],
      afterComplete: [cleanupLocalesHook],
      download: {
        unsafelyDisableChecksums: false,
      },
    },
    rebuildConfig: {
      // `cpu-features` is an optional dependency of `ssh2`.
      // Under Electron 40 (Node 24 / new V8), rebuilding it from source may fail on Windows,
      // but `ssh2` works fine without it (it falls back to pure JS).
      ignoreModules: ["cpu-features"],
    },
    makers: [
      {
        name: "@electron-forge/maker-squirrel",
        config: {
          name: PACKAGE_NAME,
          setupExe: `${PRODUCT_NAME}-Setup.exe`,
          setupIcon: WINDOWS_ICON_PATH,
          noMsi: false,
        },
      },
      {
        name: "@electron-forge/maker-zip",
        platforms: ["darwin"],
      },
      {
        name: "@electron-forge/maker-deb",
        config: {
          options: {
            name: PACKAGE_NAME,
            productName: PRODUCT_NAME,
            genericName: "SSH Terminal",
            description: APP_DESCRIPTION,
            productDescription: APP_DESCRIPTION,
            section: "net",
            priority: "optional",
            maintainer: AUTHOR,
            homepage: APP_HOMEPAGE,
            bin: PRODUCT_NAME,
            icon: LINUX_ICON_PATH,
            categories: ["Development", "Network", "Utility"],
          },
        },
      },
      {
        name: "@electron-forge/maker-rpm",
        config: {
          options: {
            name: PACKAGE_NAME,
            productName: PRODUCT_NAME,
            genericName: "SSH Terminal",
            description: APP_DESCRIPTION,
            productDescription: APP_DESCRIPTION,
            license: "Apache-2.0",
            group: "Applications/Internet",
            homepage: APP_HOMEPAGE,
            bin: PRODUCT_NAME,
            icon: LINUX_ICON_PATH,
            categories: ["Development", "Network", "Utility"],
          },
        },
      },
    ],
    plugins: [
      {
        name: "@electron-forge/plugin-auto-unpack-natives",
        config: {},
      },
      new WindowsSafeWebpackPlugin({
        mainConfig: "./webpack.main.config.js",
        renderer: {
          config: "./webpack.renderer.config.js",
          entryPoints: [
            {
              html: "./src/index.html",
              js: "./src/app.jsx",
              name: "main_window",
              preload: {
                js: "./src/preload.js",
              },
            },
          ],
        },
        devContentSecurityPolicy:
          "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self';",
        port: devServerPort,
        loggerPort,
      }),
      // Fuses are used to enable/disable various Electron functionality
      // at package time, before code signing the application
      new FusesPlugin({
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      }),
    ],
  };
};
