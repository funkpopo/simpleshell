import {
  getDroppedEntryName,
  joinDroppedLocalPath,
} from "../fileManagerUtils.js";

/**
 * Walks native file-system entries from a drop and flattens them into the
 * descriptors sent to main-process validation. Directories are read fully
 * before their children are visited, preserving the original traversal order.
 */
export async function collectDroppedItems(entries) {
  const droppedItems = [];
  const readEntry = async (entry, pathPrefix = "", localPath = "") => {
    if (!entry) return;
    const entryName = getDroppedEntryName(entry);
    if (entry.isFile) {
      if (!entryName) {
        droppedItems.push({
          name: "",
          relativePath: "",
          localPath,
          isFile: true,
        });
        return;
      }
      droppedItems.push({
        name: entryName,
        relativePath: `${pathPrefix}${entryName}`,
        localPath,
        isFile: true,
      });
      return;
    }
    if (!entry.isDirectory || typeof entry.createReader !== "function") {
      droppedItems.push({
        name: entryName,
        relativePath: entryName ? `${pathPrefix}${entryName}` : "",
        localPath: "",
      });
      return;
    }
    if (!entryName) {
      droppedItems.push({
        name: "",
        relativePath: "",
        localPath,
        isDirectory: true,
        directoryReadable: false,
      });
      return;
    }
    const directoryPrefix = `${pathPrefix}${entryName}/`;
    const directoryRelativePath = directoryPrefix.replace(/\/$/, "");
    const directoryLocalPath = localPath;
    const reader = entry.createReader();
    const childEntries = [];
    let directoryReadable = true;
    await new Promise((resolve) => {
      const readEntries = () => {
        reader.readEntries(
          (batch) => {
            if (!batch || batch.length === 0) {
              resolve();
              return;
            }
            childEntries.push(...batch);
            readEntries();
          },
          () => {
            directoryReadable = false;
            resolve();
          },
        );
      };
      readEntries();
    });
    droppedItems.push({
      name: entryName,
      relativePath: directoryRelativePath,
      localPath: directoryLocalPath,
      isDirectory: true,
      directoryReadable,
    });
    for (const childEntry of childEntries) {
      await readEntry(
        childEntry,
        directoryPrefix,
        joinDroppedLocalPath(directoryLocalPath, childEntry?.name),
      );
    }
  };
  for (const rootItem of entries) {
    await readEntry(rootItem.entry, "", rootItem.localPath);
  }
  return droppedItems;
}
