const path = require("node:path");

// Isolate logging and crash reporting from the real application profile. The
// production native client, protocol, pool, resume store and transfer engine run unchanged.
function loadTransferRuntime() {
  const children = new Set();
  const logs = [];
  for (const [name, exports] of [
    ["logger", { logToFile: (message) => logs.push(message) }],
    ["crashReporter", { recordCrashMarker: () => {} }],
  ]) {
    const filename = require.resolve(`../../src/main/utils/${name}`);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  const native = require("../../src/main/native/nativeSftpClient");
  const invoke = native.invokeNativeRequestWithConfig;
  native.invokeNativeRequestWithConfig = (config, request, options = {}) =>
    invoke(config, request, {
      ...options,
      onSpawn: (child) => {
        children.add(child);
        options.onSpawn?.(child);
      },
    });
  const Pool = require("../../src/main/file-transfer/transferProcessPool");
  const Runner = require("../../src/main/file-transfer/resumableTransfer");
  const resume = require("../../src/main/file-transfer/transferResume");
  const integrity = require("../../src/main/file-transfer/transferIntegrity");
  const createRunner = ({
    root,
    config,
    direction,
    localPath,
    remotePath,
    segmentSize,
    ...options
  }) => {
    const store =
      options.store ||
      new resume.TransferResumeStore(path.join(root, "registry"));
    const record = store.describe({
      direction,
      localPath,
      remotePath,
      connection: resume.connectionIdentity(config),
    });
    const pool = options.pool || new Pool({ maxWorkers: 4 });
    const controller = options.controller || new AbortController();
    const transferKey = options.transferKey || record.id;
    const runner = new Runner({
      store,
      pool,
      record,
      sshConfig: config,
      tabId: "fixture",
      transferKey,
      signal: controller.signal,
      segments: (size) => {
        if (!segmentSize || size === 0) return [{ offset: 0, length: size }];
        const segments = [];
        for (let offset = 0; offset < size; offset += segmentSize)
          segments.push({
            offset,
            length: Math.min(segmentSize, size - offset),
          });
        return segments;
      },
      maxConcurrency: 4,
      getAlgorithm: () => options.algorithm || null,
      onProgress: options.onProgress || (() => {}),
      onState: options.onState || (() => {}),
      onRecord: () => {},
      log: (message) => logs.push(message),
    });
    return { runner, record, store, pool, controller, transferKey };
  };
  return {
    native,
    createRunner,
    children,
    logs,
    ...resume,
    ...integrity,
    close: () => {
      for (const child of children) child.kill();
    },
  };
}

module.exports = { loadTransferRuntime };
