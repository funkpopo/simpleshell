/**
 * Folder Scanner Manager
 * Provides an easy-to-use interface for scanning folders asynchronously using worker threads
 */

const { Worker } = require('worker_threads');
const path = require('path');

/**
 * Scan a folder asynchronously using a worker thread
 * @param {string} folderPath - Path to the folder to scan
 * @param {string} relativeBasePath - Optional relative base path for maintaining folder structure
 * @param {Object} options - Additional options
 * @param {number} options.timeout - Timeout in milliseconds (default: 30000ms = 30s)
 * @returns {Promise<Object>} Scan result with totalSize, fileCount, files, and errors
 */
async function scanFolderAsync(folderPath, relativeBasePath = '', options = {}) {
  const { timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'folder-scanner-worker.js');

    // Create worker
    const worker = new Worker(workerPath, {
      workerData: {
        folderPath,
        relativeBasePath,
      },
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Folder scan timeout after ${timeout}ms for: ${folderPath}`));
    }, timeout);

    // Handle messages from worker
    worker.on('message', (message) => {
      clearTimeout(timeoutId);

      if (message.success) {
        resolve(message.data);
      } else {
        reject(new Error(message.error.message));
      }
    });

    // Handle worker errors
    worker.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Worker error: ${error.message}`));
    });

    // Handle worker exit
    worker.on('exit', (code) => {
      clearTimeout(timeoutId);

      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

/**
 * Scan a folder synchronously (fallback for compatibility)
 * This is a synchronous implementation that doesn't use worker threads
 * @param {string} folderPath - Path to the folder to scan
 * @param {string} relativeBasePath - Optional relative base path
 * @returns {Object} Scan result
 */
function scanFolderSync(folderPath, relativeBasePath = '') {
  const fs = require('fs');
  const path = require('path');

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
            scan(fullPath, entryRelativePath);
          } else if (entry.isFile()) {
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
        } catch (error) {
          errors.push({
            path: fullPath,
            error: error.message,
          });
        }
      }
    } catch (error) {
      errors.push({
        path: dirPath,
        error: error.message,
      });
    }
  }

  scan(folderPath, relativeBasePath);

  return {
    totalSize,
    fileCount,
    files,
    errors,
  };
}

/**
 * Calculate folder size (simplified API)
 * @param {string} folderPath - Path to the folder
 * @param {Object} options - Options
 * @param {boolean} options.useWorker - Whether to use worker thread (default: true)
 * @returns {Promise<number>} Total size in bytes
 */
async function calculateFolderSize(folderPath, options = {}) {
  const { useWorker = true } = options;

  if (useWorker) {
    const result = await scanFolderAsync(folderPath);
    return result.totalSize;
  } else {
    const result = scanFolderSync(folderPath);
    return result.totalSize;
  }
}

module.exports = {
  scanFolderAsync,
  scanFolderSync,
  calculateFolderSize,
};
