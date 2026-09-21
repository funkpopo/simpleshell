const zlib = require("zlib");
/**
 * 压缩命令历史
 * @param {Array} history - 命令历史数组
 * @returns {Object} 压缩后的数据对象
 */
function compressCommandHistory(history, log) {
  try {
    const jsonStr = JSON.stringify(history);
    const compressed = zlib.gzipSync(jsonStr);
    const base64Data = compressed.toString("base64");

    const result = {
      compressed: true,
      data: base64Data,
      originalSize: Buffer.byteLength(jsonStr, "utf8"),
      compressedSize: compressed.length,
      timestamp: Date.now(),
    };

    log(
      `ConfigService: Command history compressed from ${result.originalSize} to ${result.compressedSize} bytes (${((result.compressedSize / result.originalSize) * 100).toFixed(2)}%)`,
      "INFO",
    );

    return result;
  } catch (error) {
    log(
      `ConfigService: Failed to compress command history - ${error.message}`,
      "ERROR",
    );
    return {
      compressed: false,
      data: history,
      timestamp: Date.now(),
    };
  }
}

/**
 * 解压命令历史
 * @param {Object} data - 压缩后的数据对象
 * @returns {Array} 命令历史数组
 */
function decompressCommandHistory(data, log) {
  try {
    if (!data.compressed) {
      return Array.isArray(data.data) ? data.data : [];
    }

    const compressed = Buffer.from(data.data, "base64");
    const decompressed = zlib.gunzipSync(compressed);
    const jsonStr = decompressed.toString("utf8");
    return JSON.parse(jsonStr);
  } catch (error) {
    log(
      `ConfigService: Failed to decompress command history - ${error.message}`,
      "ERROR",
    );
    return [];
  }
}
module.exports = { compressCommandHistory, decompressCommandHistory };
