const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const ROOT = path.resolve(__dirname, "..", "..");
const UPDATE_SERVICE_PATH = path.join(
  ROOT,
  "src",
  "core",
  "update",
  "updateService.js",
);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installElectronMock(tempRoot) {
  const electronPath = require.resolve("electron");
  const previous = require.cache[electronPath];
  const app = {
    isPackaged: false,
    getVersion() {
      return "1.0.0";
    },
    getName() {
      return "SimpleShell";
    },
    setName() {},
    getPath(name) {
      if (name === "exe") {
        return path.join(tempRoot, "SimpleShell.exe");
      }
      return tempRoot;
    },
    exit() {},
    quit() {},
  };
  const session = {
    defaultSession: {
      async resolveProxy() {
        return "DIRECT";
      },
    },
  };
  const net = {
    request() {
      throw new Error("Fake net routes were not installed");
    },
  };

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app,
      dialog: { async showMessageBox() {} },
      shell: { showItemInFolder() {} },
      net,
      session,
    },
  };

  return {
    app,
    session,
    net,
    restore() {
      if (previous) {
        require.cache[electronPath] = previous;
      } else {
        delete require.cache[electronPath];
      }
    },
  };
}

function clearUpdateServiceModule() {
  delete require.cache[require.resolve(UPDATE_SERVICE_PATH)];
}

function createFakeNet(routes) {
  const resolveRoute = (url) => {
    const route =
      typeof routes.get === "function" ? routes.get(url) : routes[url];
    if (typeof route === "function") {
      return route(url);
    }
    return route;
  };

  return {
    request(options) {
      const url = typeof options === "string" ? options : options.url;
      const request = new EventEmitter();
      request.headers = {};
      request.aborted = false;
      request.setHeader = (key, value) => {
        request.headers[key] = value;
      };
      request.abort = () => {
        if (request.aborted) {
          return;
        }
        request.aborted = true;
        setImmediate(() => request.emit("error", new Error("request aborted")));
      };
      request.end = () => {
        setImmediate(() => {
          if (request.aborted) {
            return;
          }

          const route = resolveRoute(url);
          if (!route) {
            request.emit("error", new Error(`No fake route for ${url}`));
            return;
          }

          if (route.error) {
            request.emit("error", route.error);
            return;
          }

          const response = new EventEmitter();
          response.statusCode = route.statusCode || 200;
          response.statusMessage = route.statusMessage || "OK";
          response.headers = route.headers || {};
          request.emit("response", response);

          const chunks =
            route.chunks ||
            (route.body === undefined || route.body === null
              ? []
              : [route.body]);
          const delayMs = Number(route.chunkDelayMs) || 0;
          let index = 0;

          const emitNextChunk = () => {
            if (request.aborted) {
              return;
            }

            if (index >= chunks.length) {
              response.emit("end");
              return;
            }

            response.emit("data", Buffer.from(chunks[index]));
            index += 1;
            setTimeout(emitNextChunk, delayMs);
          };

          setTimeout(emitNextChunk, delayMs);
        });
      };
      return request;
    },
  };
}

function createRelease(version, assetOverrides = {}) {
  const assetName = assetOverrides.name || "SimpleShell-Setup.exe";
  return {
    tag_name: `v${version}`,
    name: `SimpleShell v${version}`,
    body: assetOverrides.body || "Regular release",
    published_at: "2026-05-27T00:00:00.000Z",
    html_url: `https://github.com/funkpopo/simpleshell/releases/tag/v${version}`,
    assets: [
      {
        name: assetName,
        browser_download_url:
          assetOverrides.url ||
          `https://github.com/funkpopo/simpleshell/releases/download/v${version}/${assetName}`,
        size: assetOverrides.size || 1024,
        digest: assetOverrides.digest || undefined,
      },
    ],
  };
}

function withUpdateService({ platform = "win32", routes = new Map() } = {}) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "simpleshell-update-"),
  );
  const electronMock = installElectronMock(tempRoot);
  clearUpdateServiceModule();
  const { UpdateService } = require(UPDATE_SERVICE_PATH);
  const service = new UpdateService({
    app: electronMock.app,
    session: electronMock.session,
    net: createFakeNet(routes),
    platform,
    currentVersion: "1.0.0",
    tempDir: path.join(tempRoot, "updates"),
    spawn() {
      throw new Error("spawn should not be called by update regression tests");
    },
    execFile() {
      throw new Error(
        "execFile should not be called by update regression tests",
      );
    },
    dialog: { async showMessageBox() {} },
    shell: { showItemInFolder() {} },
  });

  return {
    service,
    tempRoot,
    restore() {
      clearUpdateServiceModule();
      electronMock.restore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

async function testVersionComparison() {
  const context = withUpdateService();
  try {
    const { service } = context;
    assert.equal(service.compareVersions("1.0.1", "1.0.0"), 1);
    assert.equal(service.compareVersions("1.10.0", "1.2.0"), 1);
    assert.equal(service.compareVersions("v1.0.0", "1.0.0+build.1"), 0);
    assert.equal(service.compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
    assert.equal(service.compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  } finally {
    context.restore();
  }
}

async function testAssetSelection() {
  const assets = [
    {
      name: "SimpleShell-portable.exe",
      browser_download_url:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell-portable.exe",
    },
    {
      name: "SimpleShell-Setup.exe",
      browser_download_url:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell-Setup.exe",
    },
    {
      name: "SimpleShell.dmg",
      browser_download_url:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell.dmg",
    },
    {
      name: "SimpleShell.AppImage",
      browser_download_url:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell.AppImage",
    },
    {
      name: "simpleshell.deb",
      browser_download_url:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/simpleshell.deb",
    },
  ];

  const win = withUpdateService({ platform: "win32" });
  const mac = withUpdateService({ platform: "darwin" });
  const linux = withUpdateService({ platform: "linux" });
  try {
    assert.equal(
      win.service.getDownloadAsset(assets).name,
      "SimpleShell-Setup.exe",
    );
    assert.equal(mac.service.getDownloadAsset(assets).name, "SimpleShell.dmg");
    assert.equal(
      linux.service.getDownloadAsset(assets).name,
      "SimpleShell.AppImage",
    );
  } finally {
    win.restore();
    mac.restore();
    linux.restore();
  }
}

async function testHashMismatchKeepsPreviousInstaller() {
  const badUrl =
    "https://github.com/funkpopo/simpleshell/releases/download/v1.0.2/SimpleShell-Setup.exe";
  const routes = new Map([
    [
      badUrl,
      {
        body: "new broken installer",
        headers: { "content-length": "20" },
      },
    ],
  ]);
  const context = withUpdateService({ routes });
  try {
    const { service } = context;
    await service.ensureTempDir();

    const oldBuffer = Buffer.from("old valid installer");
    const oldPath = path.join(service.tempDir, "old-SimpleShell-Setup.exe");
    fs.writeFileSync(oldPath, oldBuffer);
    await service.saveInstallerMeta({
      filePath: oldPath,
      sha256: sha256(oldBuffer),
      expectedSha256: sha256(oldBuffer),
      version: "1.0.1",
      downloadedAt: new Date().toISOString(),
      sourceUrl:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell-Setup.exe",
      size: oldBuffer.length,
    });

    service.latestReleaseAsset = {
      name: "SimpleShell-Setup.exe",
      downloadUrl: badUrl,
      expectedSha256: "0".repeat(64),
      version: "1.0.2",
      size: 20,
    };

    await assert.rejects(
      () => service.downloadUpdate(),
      /hash mismatch/i,
      "hash mismatch should reject the download",
    );

    assert.equal(fs.existsSync(oldPath), true, "old installer should be kept");
    const installerState = await service.hasDownloadedInstaller();
    assert.equal(installerState.available, true);
    assert.equal(installerState.installerVersion, "1.0.1");
    assert.equal(installerState.lastError.stage, "download");
  } finally {
    context.restore();
  }
}

async function testUntrustedDomainRejected() {
  const context = withUpdateService();
  try {
    assert.throws(
      () =>
        context.service.validateAndNormalizeDownloadUrl(
          "https://downloads.example.com/SimpleShell-Setup.exe",
        ),
      /Untrusted update host/,
    );
  } finally {
    context.restore();
  }
}

async function testTrustedRedirectDownload() {
  const startUrl =
    "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell-Setup.exe";
  const finalUrl =
    "https://objects.githubusercontent.com/github-production-release-asset/SimpleShell-Setup.exe";
  const body = Buffer.from("redirected installer");
  const routes = new Map([
    [
      startUrl,
      {
        statusCode: 302,
        statusMessage: "Found",
        headers: { location: finalUrl },
      },
    ],
    [
      finalUrl,
      {
        body,
        headers: { "content-length": String(body.length) },
      },
    ],
  ]);
  const context = withUpdateService({ routes });
  try {
    context.service.latestReleaseAsset = {
      name: "SimpleShell-Setup.exe",
      downloadUrl: startUrl,
      expectedSha256: sha256(body),
      version: "1.0.1",
      size: body.length,
      publishedAt: "2026-05-27T00:00:00.000Z",
    };

    const installer = await context.service.downloadUpdate();
    assert.equal(installer.sourceUrl, finalUrl);
    assert.equal(installer.sha256, sha256(body));
    assert.equal(fs.existsSync(installer.filePath), true);
  } finally {
    context.restore();
  }
}

async function testCancelDownload() {
  const downloadUrl =
    "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell-Setup.exe";
  const routes = new Map([
    [
      downloadUrl,
      {
        chunks: ["first", "second", "third"],
        chunkDelayMs: 20,
        headers: { "content-length": "16" },
      },
    ],
  ]);
  const context = withUpdateService({ routes });
  try {
    const { service } = context;
    service.latestReleaseAsset = {
      name: "SimpleShell-Setup.exe",
      downloadUrl,
      expectedSha256: null,
      version: "1.0.1",
      size: 16,
    };

    let cancelled = false;
    const downloadPromise = service.downloadUpdate((progress) => {
      if (!cancelled && progress.downloaded > 0) {
        cancelled = true;
        service.cancelDownload();
      }
    });

    await assert.rejects(() => downloadPromise, /Download cancelled/);
    await delay(30);
    assert.equal(service.getDownloadProgress().isDownloading, false);
    const errorInfo = await service.loadUpdateError();
    assert.equal(errorInfo.stage, "download-cancelled");
  } finally {
    context.restore();
  }
}

async function testOfflineRecovery() {
  const releaseUrl =
    "https://api.github.com/repos/funkpopo/simpleshell/releases/latest";
  const routes = new Map([
    [
      releaseUrl,
      {
        error: Object.assign(new Error("net::ERR_INTERNET_DISCONNECTED"), {
          code: "ERR_INTERNET_DISCONNECTED",
        }),
      },
    ],
  ]);
  const context = withUpdateService({ routes });
  try {
    const firstResult = await context.service.checkForUpdate();
    assert.equal(firstResult.success, false);
    assert.match(firstResult.error, /ERR_INTERNET_DISCONNECTED/);

    routes.set(releaseUrl, {
      body: JSON.stringify(
        createRelease("1.0.1", {
          body: "Security fix",
          size: 1234,
        }),
      ),
      headers: { "content-length": "512" },
    });

    const secondResult = await context.service.checkForUpdate();
    assert.equal(secondResult.success, true);
    assert.equal(secondResult.updateInfo.hasUpdate, true);
    assert.equal(secondResult.updateInfo.latestVersion, "1.0.1");
    assert.equal(secondResult.updateInfo.downloadSize, 1234);
    assert.equal(secondResult.updateInfo.isSecurityUpdate, true);
  } finally {
    context.restore();
  }
}

async function testWindowsInstallerSchedulesTrustedPackageWithRelaunch() {
  const context = withUpdateService();
  try {
    const { service } = context;
    const installerPath = path.join(service.tempDir, "SimpleShell-Setup.exe");
    fs.mkdirSync(service.tempDir, { recursive: true });
    fs.writeFileSync(installerPath, "installer");

    let relaunchOptions = null;
    let quitScheduled = false;
    service.app.relaunch = (options) => {
      relaunchOptions = options;
    };
    service.scheduleQuitForUpdateInstallation = () => {
      quitScheduled = true;
    };

    await service.installWindowsUpdate(installerPath);

    assert.deepEqual(relaunchOptions, {
      execPath: installerPath,
      args: ["/S"],
    });
    assert.equal(quitScheduled, true);
    assert.equal(
      fs.existsSync(path.join(service.tempDir, "install-and-restart.ps1")),
      false,
      "Windows update must not generate a PowerShell helper script",
    );
  } finally {
    context.restore();
  }
}

async function testWindowsInstallerFallbackSpawnsPackageDirectly() {
  const context = withUpdateService();
  try {
    const { service } = context;
    const installerPath = path.join(service.tempDir, "SimpleShell-Setup.exe");
    fs.mkdirSync(service.tempDir, { recursive: true });
    fs.writeFileSync(installerPath, "installer");

    let spawnCall = null;
    let quitScheduled = false;
    const child = new EventEmitter();
    child.unref = () => {};
    service.app.relaunch = undefined;
    service.spawn = (command, args, options) => {
      spawnCall = { command, args, options };
      return child;
    };
    service.scheduleQuitForUpdateInstallation = () => {
      quitScheduled = true;
    };

    await service.installWindowsUpdate(installerPath);

    assert.equal(spawnCall.command, installerPath);
    assert.notEqual(path.basename(spawnCall.command).toLowerCase(), "cmd.exe");
    assert.notEqual(
      path.basename(spawnCall.command).toLowerCase(),
      "powershell.exe",
    );
    assert.deepEqual(spawnCall.args, ["/S"]);
    assert.equal(spawnCall.options.windowsHide, true);
    assert.equal(spawnCall.options.detached, true);
    assert.equal(spawnCall.options.stdio, "ignore");
    assert.equal(quitScheduled, true);
  } finally {
    context.restore();
  }
}

async function testConsumedInstallerIsCleanedAfterUpdate() {
  const context = withUpdateService();
  try {
    const { service } = context;
    service.currentVersion = "1.0.1";
    await service.ensureTempDir();

    const installerBuffer = Buffer.from("installed update package");
    const installerPath = path.join(
      service.tempDir,
      "SimpleShell-Setup-1.0.1.exe",
    );
    const legacyScriptPath = path.join(
      service.tempDir,
      "install-and-restart.ps1",
    );
    fs.writeFileSync(installerPath, installerBuffer);
    fs.writeFileSync(service.installerLogPath, "install log");
    fs.writeFileSync(legacyScriptPath, "legacy helper");

    await service.saveInstallerMeta({
      filePath: installerPath,
      sha256: sha256(installerBuffer),
      expectedSha256: sha256(installerBuffer),
      version: "1.0.1",
      downloadedAt: new Date().toISOString(),
      sourceUrl:
        "https://github.com/funkpopo/simpleshell/releases/download/v1.0.1/SimpleShell-Setup.exe",
      size: installerBuffer.length,
      status: "install-launched",
    });
    await service.recordUpdateError("install", new Error("previous failure"));

    await service.cleanupConsumedInstaller();

    assert.equal(fs.existsSync(installerPath), false);
    assert.equal(fs.existsSync(service.installerMetaPath), false);
    assert.equal(fs.existsSync(service.updateErrorPath), false);
    assert.equal(fs.existsSync(service.installerLogPath), false);
    assert.equal(fs.existsSync(legacyScriptPath), false);
  } finally {
    context.restore();
  }
}

async function run() {
  const tests = [
    ["version comparison", testVersionComparison],
    ["asset selection", testAssetSelection],
    [
      "hash mismatch keeps previous installer",
      testHashMismatchKeepsPreviousInstaller,
    ],
    ["untrusted domain rejected", testUntrustedDomainRejected],
    ["trusted redirect download", testTrustedRedirectDownload],
    ["cancel download", testCancelDownload],
    ["offline recovery", testOfflineRecovery],
    [
      "Windows installer schedules trusted package with relaunch",
      testWindowsInstallerSchedulesTrustedPackageWithRelaunch,
    ],
    [
      "Windows installer fallback spawns package directly",
      testWindowsInstallerFallbackSpawnsPackageDirectly,
    ],
    [
      "consumed installer is cleaned after update",
      testConsumedInstallerIsCleanedAfterUpdate,
    ],
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS update service - ${name}`);
  }

  console.log(`\n${tests.length} update service regression checks passed.`);
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
