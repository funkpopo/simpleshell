const fs = require("node:fs");
const path = require("node:path");

/**
 * SFTP Rust 边界守卫（方向 C：目录浏览读写热路径全量下沉 Rust，JS 只留任务编排）
 *
 * 断言三件事：
 * 1. JS 主进程 SFTP 相关模块不再 require("ssh2")，也不存在 ssh2 风格的
 *    callback SFTP shim（历史混血路径已于 2026-09 移除）。
 * 2. nativeSftpClient.js 发起的每一个 operation 都在 file_management sidecar
 *    的 SftpOperation 枚举（Rust 侧）中有对应实现，防止两侧漂移。
 * 3. fileHandlers/sftpHandlers 的目录读写入口只经过 nativeSftpClient，
 *    没有绕过 sidecar 的本地 SFTP 实现。
 */

const repoRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertNotContains(source, pattern, message) {
  if (pattern.test(source)) {
    throw new Error(`check-sftp-native-boundary: ${message}`);
  }
}

function rustSftpOperations() {
  const modRs = fs.readFileSync(
    path.join(
      repoRoot,
      "native-services/desktop-host/src/sidecars/file_management/mod.rs",
    ),
    "utf8",
  );
  const enumStart = modRs.indexOf("enum SftpOperation");
  if (enumStart === -1) {
    throw new Error(
      "check-sftp-native-boundary: SftpOperation enum missing from sidecar",
    );
  }
  const enumBody = modRs.slice(
    enumStart,
    modRs.indexOf("impl SftpOperation", enumStart),
  );
  const operations = [
    ...enumBody.matchAll(/#\[serde\(rename = "([a-zA-Z]+)"\)\]/g),
  ].map((match) => match[1]);
  if (operations.length === 0) {
    throw new Error(
      "check-sftp-native-boundary: no SftpOperation variants parsed from mod.rs",
    );
  }
  return new Set(operations);
}

function jsNativeOperations() {
  const clientSource = readSource("src/core/utils/nativeSftpClient.js");
  const operations = [
    ...clientSource.matchAll(/operation:\s*"([a-zA-Z]+)"/g),
  ].map((match) => match[1]);
  if (operations.length === 0) {
    throw new Error(
      "check-sftp-native-boundary: no native operations found in nativeSftpClient.js",
    );
  }
  return new Set(operations);
}

function main() {
  const guardedModules = [
    "src/core/utils/nativeSftpClient.js",
    "src/workers/sftp-transfer-worker.js",
    "src/modules/filemanagement/filemanagementService.js",
    "src/modules/filemanagement/transferProcessPool.js",
    "src/modules/filemanagement/resumableTransfer.js",
    "src/core/ipc/handlers/fileHandlers.js",
    "src/core/ipc/handlers/sftpHandlers.js",
  ];

  for (const relativePath of guardedModules) {
    const source = readSource(relativePath);
    assertNotContains(
      source,
      /require\(["']ssh2["']\)|from\s+["']ssh2["']/,
      `${relativePath} must not depend on the ssh2 JS SFTP data plane`,
    );
    assertNotContains(
      source,
      /_createNativeSftpShim|_withBorrowedSftp|_toShimStats|_toShimDirEntry/,
      `${relativePath} must not reintroduce the ssh2-style SFTP shim`,
    );
    assertNotContains(
      source,
      /client\.sftp\(|sftp\.readdir\(|sftp\.fastGet\(|sftp\.fastPut\(/,
      `${relativePath} must not open JS-side SFTP channels; all SFTP I/O goes through the Rust sidecar`,
    );
  }

  const rustOps = rustSftpOperations();
  // closeSession 是 Rust 会话循环（run_sftp_session）直接处理的会话控制指令，
  // 不在 SftpOperation 枚举里，单独放行。
  const sessionControlOps = new Set(["closeSession"]);
  const jsOps = jsNativeOperations();
  for (const operation of jsOps) {
    if (!rustOps.has(operation) && !sessionControlOps.has(operation)) {
      throw new Error(
        `check-sftp-native-boundary: nativeSftpClient.js requests operation "${operation}" but the file_management sidecar does not implement it (Rust ops: ${[...rustOps].sort().join(", ")})`,
      );
    }
  }

  const rustOpList = [...rustOps].sort().join(", ");
  const jsOpList = [...jsOps].sort().join(", ");
  console.log(
    `[sftp-native-boundary] PASS: ${guardedModules.length} JS modules free of ssh2 data plane; ${jsOps.size} JS operations all implemented in Rust sidecar.`,
  );
  console.log(`[sftp-native-boundary] JS ops: ${jsOpList}`);
  console.log(`[sftp-native-boundary] Rust ops: ${rustOpList}`);
}

main();
