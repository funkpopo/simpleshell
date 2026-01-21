const net = require("node:net");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_DEV_SERVER_PORT = 3001;
const DEFAULT_LOGGER_PORT = 19001;

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

  return {
    packagerConfig: {
      asar: true,
      icon: "./src/assets/logo",
      download: {
        unsafelyDisableChecksums: true,
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
        config: {},
      },
      {
        name: "@electron-forge/maker-zip",
        platforms: ["darwin"],
      },
      {
        name: "@electron-forge/maker-deb",
        config: {},
      },
      {
        name: "@electron-forge/maker-rpm",
        config: {},
      },
    ],
    plugins: [
      {
        name: "@electron-forge/plugin-auto-unpack-natives",
        config: {},
      },
      {
        name: "@electron-forge/plugin-webpack",
        config: {
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
          port: devServerPort,
          loggerPort,
        },
      },
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
