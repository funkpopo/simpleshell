/**
 * 批量 IPC 调用工具函数
 * 用于减少渲染进程与主进程之间的 IPC 调用开销
 */

export async function batchGetFilePermissions(tabId, filePaths) {
  if (!window.terminalAPI?.getFilePermissionsBatch) {
    // 降级方案：逐个调用
    console.warn(
      "batchGetFilePermissions: API 不可用，降级为逐个调用",
    );
    return fallbackBatchGetPermissions(tabId, filePaths);
  }

  try {
    return await window.terminalAPI.getFilePermissionsBatch(tabId, filePaths);
  } catch (error) {
    console.error("batchGetFilePermissions error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * 降级方案：逐个获取文件权限
 */
async function fallbackBatchGetPermissions(tabId, filePaths) {
  if (!window.terminalAPI?.getFilePermissions) {
    return { success: false, error: "getFilePermissions API 不可用" };
  }

  const results = [];
  for (const filePath of filePaths) {
    try {
      const result = await window.terminalAPI.getFilePermissions(
        tabId,
        filePath,
      );
      results.push({
        path: filePath,
        ...result,
      });
    } catch (error) {
      results.push({
        path: filePath,
        success: false,
        error: error.message,
      });
    }
  }

  return { success: true, results };
}

/**
 * 通用批量 IPC 调用
 * 允许在一次 IPC 调用中执行多个不同的操作
 *
 * @param {Array<[string, ...any]>} calls - 调用数组，每个元素是 [channel, ...args]
 * @returns {Promise<{success: boolean, results?: Array<{success: boolean, data?: any, error?: string}>}>}
 *
 * @example
 * const result = await batchInvoke([
 *   ['getFilePermissions', tabId, '/path/to/file1'],
 *   ['getFilePermissions', tabId, '/path/to/file2'],
 *   ['checkPathExists', '/local/path'],
 * ]);
 */
export async function batchInvoke(calls) {
  if (!window.terminalAPI?.batchInvoke) {
    console.warn("batchInvoke: API 不可用");
    return { success: false, error: "batchInvoke API 不可用" };
  }

  try {
    return await window.terminalAPI.batchInvoke(calls);
  } catch (error) {
    console.error("batchInvoke error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * 带并发控制的批量操作执行器
 * 适用于需要限制并发数的批量操作场景
 *
 * @param {Array<T>} items - 要处理的项目数组
 * @param {number} concurrency - 最大并发数
 * @param {(item: T, index: number) => Promise<R>} worker - 处理函数
 * @returns {Promise<{results: Array<{status: 'fulfilled'|'rejected', value?: R, reason?: Error}>, errors: Array<{index: number, error: Error}>}>}
 *
 * @example
 * const { results, errors } = await runWithConcurrency(
 *   files,
 *   5,
 *   async (file) => {
 *     return await window.terminalAPI.getFilePermissions(tabId, file.path);
 *   }
 * );
 */
export async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  const errors = [];
  let index = 0;
  let active = 0;

  return new Promise((resolve) => {
    const tick = () => {
      // 所有任务完成
      if (index >= items.length && active === 0) {
        resolve({ results, errors });
        return;
      }

      // 启动新任务直到达到并发限制
      while (active < concurrency && index < items.length) {
        const current = index++;
        const item = items[current];
        active++;

        Promise.resolve()
          .then(() => worker(item, current))
          .then((res) => {
            results[current] = { status: "fulfilled", value: res };
          })
          .catch((err) => {
            results[current] = { status: "rejected", reason: err };
            errors.push({ index: current, error: err });
          })
          .finally(() => {
            active--;
            tick();
          });
      }
    };

    tick();
  });
}

/**
 * 将数组分块
 *
 * @param {Array<T>} array - 要分块的数组
 * @param {number} chunkSize - 每块的大小
 * @returns {Array<Array<T>>}
 */
export function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * 批量操作辅助类
 * 提供更便捷的链式调用方式
 *
 * @example
 * const batch = new BatchOperations(tabId);
 * batch.addGetPermissions('/path/to/file1');
 * batch.addGetPermissions('/path/to/file2');
 * const results = await batch.execute();
 */
export class BatchOperations {
  constructor(tabId) {
    this.tabId = tabId;
    this.operations = [];
  }

  /**
   * 添加获取文件权限操作
   */
  addGetPermissions(filePath) {
    this.operations.push(["getFilePermissions", this.tabId, filePath]);
    return this;
  }

  /**
   * 添加检查路径存在操作
   */
  addCheckPathExists(path) {
    this.operations.push(["checkPathExists", path]);
    return this;
  }

  /**
   * 执行所有操作
   */
  async execute() {
    if (this.operations.length === 0) {
      return { success: true, results: [] };
    }

    const result = await batchInvoke(this.operations);
    this.operations = []; // 清空操作列表
    return result;
  }

  /**
   * 清空操作列表
   */
  clear() {
    this.operations = [];
    return this;
  }

  /**
   * 获取当前操作数量
   */
  get count() {
    return this.operations.length;
  }
}

export default {
  batchGetFilePermissions,
  batchInvoke,
  runWithConcurrency,
  chunkArray,
  BatchOperations,
};
