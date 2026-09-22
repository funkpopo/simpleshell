const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * checksum-file sidecar 行为契约检查（Phase 1）。
 *
 * 验证真实进程交互：
 * 1. MD5/SHA-256 与独立参考摘要一致：空文件、完整文件、非零偏移、末尾零长度、跨缓冲区区间。
 * 2. 错误路径：不存在文件、目录、非法算法、非法/溢出区间。
 * 3. JS 桥接：协议校验、取消、并发排队、二进制定位。
 */

const repoRoot = path.resolve(__dirname, "..");
const os_platform = process.platform;

function nativeHostPath() {
  const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    path.join(
      repoRoot,
      "native-services",
      "bin",
      `${os_platform}-${process.arch}`,
      os_platform === "win32"
        ? "simpleshell-native-services.exe"
        : "simpleshell-native-services",
    ),
    path.join(
      repoRoot,
      "native-services",
      "desktop-host",
      "target",
      os_platform === "win32" ? "" : "release",
    ),
  ];
  for (const dir of candidates.slice(0, 1)) {
    if (fs.existsSync(dir)) return dir;
  }
  const release = path.join(
    repoRoot,
    "native-services",
    "desktop-host",
    "target",
    "release",
    os_platform === "win32"
      ? "simpleshell-native-services.exe"
      : "simpleshell-native-services",
  );
  if (fs.existsSync(release)) return release;
  throw new Error("native services host binary not found; build it first");
}

function referenceDigest(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest("hex");
}

async function main() {
  const native = require(
    path.join(repoRoot, "src/main/native/nativeChecksumClient"),
  );
  const hostPath = nativeHostPath();
  process.stdout.write(`[checksum-sidecar] binary: ${hostPath}\n`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-checksum-"));
  const failed = [];
  const run = async (name, fn) => {
    try {
      await fn();
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      failed.push(name);
      process.stdout.write(`FAIL ${name}: ${error.message}\n`);
    }
  };

  // 1. 空文件（md5 与 sha256）
  await run("empty file digests", async () => {
    const empty = path.join(root, "empty.bin");
    fs.writeFileSync(empty, "");
    for (const algorithm of ["md5", "sha256"]) {
      const result = await native.invokeLocalChecksum({
        localPath: empty,
        algorithm,
      });
      assert.equal(result.digest, referenceDigest(algorithm, Buffer.alloc(0)));
      assert.equal(result.bytesHashed, 0);
    }
  });

  // 2. 完整文件与跨缓冲区区间（> 256 KiB）
  await run("full file and cross-buffer segment", async () => {
    const bytes = crypto.randomBytes(700 * 1024);
    const file = path.join(root, "big.bin");
    fs.writeFileSync(file, bytes);
    for (const algorithm of ["md5", "sha256"]) {
      const full = await native.invokeLocalChecksum({
        localPath: file,
        algorithm,
      });
      assert.equal(full.digest, referenceDigest(algorithm, bytes));
      const segment = await native.invokeLocalChecksum({
        localPath: file,
        algorithm,
        segmentOffset: 100,
        segmentLength: bytes.length - 200,
      });
      assert.equal(
        segment.digest,
        referenceDigest(algorithm, bytes.subarray(100, bytes.length - 100)),
      );
    }
  });

  // 3. 中文/空格路径
  await run("unicode and space paths", async () => {
    const file = path.join(root, "文件 名称.txt");
    fs.writeFileSync(file, "内容");
    const result = await native.invokeLocalChecksum({
      localPath: file,
      algorithm: "md5",
    });
    assert.equal(result.digest, referenceDigest("md5", Buffer.from("内容")));
  });

  // 4. 末尾零长度区间
  await run("tail zero-length segment", async () => {
    const file = path.join(root, "tail.bin");
    fs.writeFileSync(file, "abc");
    const result = await native.invokeLocalChecksum({
      localPath: file,
      algorithm: "sha256",
      segmentOffset: 3,
      segmentLength: 0,
    });
    assert.equal(result.digest, referenceDigest("sha256", Buffer.alloc(0)));
  });

  // 5. 不存在文件 / 目录
  await run("missing file and directory rejection", async () => {
    await assert.rejects(
      () =>
        native.invokeLocalChecksum({
          localPath: path.join(root, "missing.bin"),
          algorithm: "md5",
        }),
      (error) => error.errorCode === "CHECKSUM_SOURCE_UNAVAILABLE",
    );
    await assert.rejects(
      () => native.invokeLocalChecksum({ localPath: root, algorithm: "md5" }),
      (error) => error.errorCode === "CHECKSUM_INVALID_REQUEST",
    );
  });

  // 6. 非法算法 / 非法区间（JS 预校验）
  await run("invalid algorithm and range", async () => {
    const file = path.join(root, "alg.bin");
    fs.writeFileSync(file, "abc");
    await assert.rejects(
      () => native.invokeLocalChecksum({ localPath: file, algorithm: "sha1" }),
      (error) => error.errorKind === "validation",
    );
    await assert.rejects(
      () =>
        native.invokeLocalChecksum({
          localPath: file,
          algorithm: "md5",
          segmentOffset: 10,
        }),
      (error) => error.errorKind === "validation",
    );
    await assert.rejects(
      () =>
        native.invokeLocalChecksum({
          localPath: file,
          algorithm: "md5",
          segmentOffset: 1.5,
        }),
      (error) => error.errorKind === "validation",
    );
    await assert.rejects(
      () =>
        native.invokeLocalChecksum({
          localPath: file,
          algorithm: "md5",
          segmentOffset: -1,
        }),
      (error) => error.errorKind === "validation",
    );
  });

  // 7. 运行中取消：Digest 大文件时中途 AbortSignal
  await run("cancel while running", async () => {
    const bytes = crypto.randomBytes(256 * 1024 * 1024);
    const file = path.join(root, "cancel.bin");
    fs.writeFileSync(file, bytes);
    const controller = new AbortController();
    const promise = native.invokeLocalChecksum({
      localPath: file,
      algorithm: "sha256",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 1);
    await assert.rejects(promise, (error) => error.errorKind === "cancelled");
  });

  // 8. 启动前取消
  await run("cancel before start", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        native.invokeLocalChecksum({
          localPath: path.join(root, "empty.bin"),
          algorithm: "md5",
          signal: controller.signal,
        }),
      (error) => error.errorKind === "cancelled",
    );
  });

  // 9. 并发排队（超过并发上限 2 依然全部完成，不留悬挂 Promise）
  await run("concurrency queue", async () => {
    const file = path.join(root, "queue.bin");
    const bytes = crypto.randomBytes(4 * 1024 * 1024);
    fs.writeFileSync(file, bytes);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        native.invokeLocalChecksum({ localPath: file, algorithm: "md5" }),
      ),
    );
    for (const result of results) {
      assert.equal(result.digest, referenceDigest("md5", bytes));
    }
  });

  // 10. transferIntegrity.hashLocalFile 委托桥接并返回摘要字符串
  await run("transferIntegrity delegation", async () => {
    const { hashLocalFile, verifyTransfer } = require(
      path.join(repoRoot, "src/main/file-transfer/transferIntegrity"),
    );
    const file = path.join(root, "delegation.bin");
    const bytes = crypto.randomBytes(1024);
    fs.writeFileSync(file, bytes);
    const digest = await hashLocalFile(file, "sha256");
    assert.equal(digest, referenceDigest("sha256", bytes));
    assert.equal(typeof verifyTransfer, "function");
  });

  fs.rmSync(root, { recursive: true, force: true });

  if (failed.length) {
    throw new Error(
      `${failed.length} checksum sidecar checks failed: ${failed.join(", ")}`,
    );
  }
  process.stdout.write("All checksum sidecar checks passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
