const runtimeFileLifecycle = require("../../utils/runtimeFileLifecycle");
const fileCache = require("../../utils/fileCache");
const { logToFile } = require("../../utils/logger");

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

class RuntimeFileHandlers {
  getHandlers() {
    return [
      {
        channel: "runtime-files:configure",
        category: "runtime-files",
        handler: this.configureResource.bind(this),
      },
      {
        channel: "runtime-files:releasePath",
        category: "runtime-files",
        handler: this.releasePath.bind(this),
      },
      {
        channel: "runtime-files:clear",
        category: "runtime-files",
        handler: this.clearResource.bind(this),
      },
      {
        channel: "runtime-files:sweep",
        category: "runtime-files",
        handler: this.sweepResource.bind(this),
      },
    ];
  }

  async configureResource(event, resourceName, settings = {}) {
    try {
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
    } catch (error) {
      logToFile(
        `Error configuring runtime file resource: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async releasePath(event, resourceName, targetPath, options = {}) {
    try {
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
    } catch (error) {
      logToFile(`Error releasing runtime file path: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async clearResource(event, resourceName, options = {}) {
    try {
      void event;
      const name = normalizeResourceName(resourceName);
      const cleared = await runtimeFileLifecycle.clearResource(name, {
        ...options,
        reason: options?.reason || "manual",
      });
      return { success: true, cleared };
    } catch (error) {
      logToFile(
        `Error clearing runtime file resource: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async sweepResource(event, resourceName, options = {}) {
    try {
      void event;
      const name = normalizeResourceName(resourceName);
      const result = await runtimeFileLifecycle.sweepResource(name, {
        ...options,
        reason: options?.reason || "manual-sweep",
      });
      return { success: true, result };
    } catch (error) {
      logToFile(
        `Error sweeping runtime file resource: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }
}

module.exports = RuntimeFileHandlers;
