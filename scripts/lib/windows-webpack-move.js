const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Forge 8 moves bundles with node:fs/promises. Limit the Windows workaround to
// generated Webpack directories; preserve normal rename behavior everywhere else.
function installWindowsWebpackMoveFallback(
  webpackDirectory,
  {
    filesystem = require("node:fs/promises"),
    platform = process.platform,
    retries = 8,
    retryDelayMs = 250,
  } = {},
) {
  if (platform !== "win32" || filesystem.__simpleShellWebpackRenamePatch)
    return;
  const root = path.resolve(webpackDirectory);
  const isWithinRoot = (value) => {
    if (typeof value !== "string") return false;
    const relative = path.relative(root, path.resolve(value));
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const retryable = (error) =>
    ["EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code);
  const rename = filesystem.rename.bind(filesystem);
  filesystem.rename = async (source, destination) => {
    try {
      return await rename(source, destination);
    } catch (error) {
      if (
        !isWithinRoot(source) ||
        !isWithinRoot(destination) ||
        !retryable(error)
      )
        throw error;
      // Resolve once before copy/remove so every destructive operation stays
      // under the exact generated directory, including on multi-drive Windows.
      const src = path.resolve(source);
      const dest = path.resolve(destination);
      if (src === dest) throw error;
      if (!(await filesystem.lstat(src)).isDirectory()) throw error;
      for (let attempt = 0; attempt < retries; attempt += 1) {
        await sleep(retryDelayMs);
        try {
          return await rename(src, dest);
        } catch (retryError) {
          if (!retryable(retryError)) throw retryError;
        }
      }
      // A fallback must never merge into an existing destination directory.
      let destinationExists = false;
      try {
        await filesystem.lstat(dest);
        destinationExists = true;
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      if (destinationExists) throw error;
      await filesystem.cp(src, dest, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await filesystem.rm(src, {
        recursive: true,
        force: true,
        maxRetries: retries,
        retryDelay: retryDelayMs,
      });
    }
  };
  Object.defineProperty(filesystem, "__simpleShellWebpackRenamePatch", {
    value: true,
  });
}

module.exports = { installWindowsWebpackMoveFallback };
