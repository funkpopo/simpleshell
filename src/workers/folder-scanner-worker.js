/**
 * Worker thread for scanning folders asynchronously
 * This worker scans a folder recursively and returns:
 * - Total size of all files
 * - File count
 * - List of all files with metadata
 */

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

/**
 * Scan a directory recursively and collect file information
 * @param {string} rootPath - Root directory path to scan
 * @param {string} relativeBasePath - Relative base path for maintaining folder structure
 * @returns {Object} Scan result with totalSize, fileCount, and files array
 */
function scanDirectorySync(rootPath, relativeBasePath = '') {
  let totalSize = 0;
  let fileCount = 0;
  const files = [];
  const errors = [];

  function scan(dirPath, relativePath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const entryRelativePath = path.join(relativePath, entry.name).replace(/\\/g, '/');

        try {
          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            scan(fullPath, entryRelativePath);
          } else if (entry.isFile()) {
            // Get file stats
            const stats = fs.statSync(fullPath);
            totalSize += stats.size;
            fileCount++;

            files.push({
              localPath: fullPath,
              relativePath: entryRelativePath,
              name: entry.name,
              size: stats.size,
              isDirectory: false,
              mtime: stats.mtime.getTime(),
            });
          }
          // Skip symbolic links and other special file types
        } catch (error) {
          // Skip files that can't be accessed (permission errors, etc.)
          errors.push({
            path: fullPath,
            error: error.message,
          });
        }
      }
    } catch (error) {
      // Skip directories that can't be accessed
      errors.push({
        path: dirPath,
        error: error.message,
      });
    }
  }

  scan(rootPath, relativeBasePath);

  return {
    totalSize,
    fileCount,
    files,
    errors,
  };
}

// Main worker execution
try {
  if (!workerData || !workerData.folderPath) {
    throw new Error('folderPath is required in workerData');
  }

  const { folderPath, relativeBasePath = '' } = workerData;

  // Check if the folder exists
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder does not exist: ${folderPath}`);
  }

  // Perform the scan
  const result = scanDirectorySync(folderPath, relativeBasePath);

  // Send result back to main thread
  parentPort.postMessage({
    success: true,
    data: result,
  });
} catch (error) {
  // Send error back to main thread
  parentPort.postMessage({
    success: false,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
}
