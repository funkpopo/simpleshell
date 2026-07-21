const runtimeFileLifecycle = require("../../utils/runtimeFileLifecycle");
const fileCache = require("../../utils/fileCache");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

const RESOURCE_NAMES = new Set([
  "file-cache",
  "file-snapshots",
  "external-editor-temp",
]);

function normalizeResourceName(resourceName) {
  const normalized = String(resourceName || "").trim();
  if (!RESOURCE_NAMES.has(normalized)) {
    throw new Error(`Unsupported runtime file resource: ${normalized}`);
  }
  return normalized;
}

/**
 * 运行时文件资源相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class RuntimeFileHandlers {
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.RUNTIME_FILES_CONFIGURE,
        category: "runtime-files",
        handler: this.configureResource.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.RUNTIME_FILES_RELEASE_PATH,
        category: "runtime-files",
        handler: this.releasePath.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.RUNTIME_FILES_CLEAR,
        category: "runtime-files",
        handler: this.clearResource.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.RUNTIME_FILES_SWEEP,
        category: "runtime-files",
        handler: this.sweepResource.bind(this),
      },
    ];
  }

  async configureResource(event, resourceName, settings = {}) {
    void event;
    const name = normalizeResourceName(resourceName);

    if (name === "file-cache") {
      fileCache.configure(settings);
      if (settings?.enabled === false) {
        await runtimeFileLifecycle.clearResource(name, {
          recreate: true,
          includeActive: true,
          reason: "disabled",
        });
      }
    } else {
      runtimeFileLifecycle.updatePolicy(name, settings);
    }

    return { success: true, policy: runtimeFileLifecycle.getPolicy(name) };
  }

  async releasePath(event, resourceName, targetPath, options = {}) {
    void event;
    const name = normalizeResourceName(resourceName);
    const released = await runtimeFileLifecycle.removeResourcePath(
      name,
      targetPath,
      {
        ...options,
        reason: options?.reason || "release-path",
      },
    );
    return { success: true, released };
  }

  async clearResource(event, resourceName, options = {}) {
    void event;
    const name = normalizeResourceName(resourceName);
    const cleared = await runtimeFileLifecycle.clearResource(name, {
      ...options,
      reason: options?.reason || "manual",
    });
    return { success: true, cleared };
  }

  async sweepResource(event, resourceName, options = {}) {
    void event;
    const name = normalizeResourceName(resourceName);
    const result = await runtimeFileLifecycle.sweepResource(name, {
      ...options,
      reason: options?.reason || "manual-sweep",
    });
    return { success: true, result };
  }
}

module.exports = RuntimeFileHandlers;
