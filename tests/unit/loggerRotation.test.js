import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";

// 日志轮转异步化（P2）：轮转全程使用 fs.promises + util.promisify(zlib.gzip)，
// 不再有 readFileSync/zlib.gzipSync/writeFileSync 阻塞主进程事件循环。
// gzip 为异步（libuv 线程池），轮转期间写入队列与轮转互斥。

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-logger-rotation-"));
const userData = path.join(tmpRoot, "userData");
fs.mkdirSync(userData, { recursive: true });

const fakeApp = {
  isPackaged: true,
  getPath: (name) => (name === "userData" ? userData : tmpRoot),
};

// 小阈值便于触发轮转；写入经 config.json 加载
fs.writeFileSync(
  path.join(userData, "config.json"),
  JSON.stringify({
    logSettings: {
      maxFileSize: 2048,
      maxFiles: 3,
      compressOldLogs: true,
      flushIntervalMs: 20,
      batchSize: 1,
    },
  }),
);

const { initLogger, logToFile, getLogFilePath } =
  await import("../../src/main/utils/logger.js");

const logDir = path.join(userData, "log");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(() => {
  initLogger(fakeApp);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("logger async rotation", () => {
  it("第一轮轮转：app.log 移为 app.1.log，app.log 重建为空", { timeout: 10000 }, async () => {
    for (let i = 0; i < 80; i++) {
      logToFile(`ROUND1 ${i} ${"y".repeat(300)}`, "INFO");
    }
    await wait(5500); // 跨过 5s 尺寸检查节流窗口，等待异步轮转完成

    expect(fs.existsSync(path.join(logDir, "app.1.log"))).toBe(true);
    expect(getLogFilePath()).toBe(path.join(logDir, "app.log"));
    // 当前 app.log 应为新一轮内容（不含 ROUND1）
    const current = fs.readFileSync(path.join(logDir, "app.log"), "utf8");
    expect(current).not.toContain("ROUND1");
  });

  it("第二轮轮转：app.1.log 异步 gzip 为 app.2.log.gz，内容完整可解压", { timeout: 10000 }, async () => {
    for (let i = 0; i < 80; i++) {
      logToFile(`ROUND2 ${i} ${"z".repeat(300)}`, "INFO");
    }
    await wait(5500);

    const gzPath = path.join(logDir, "app.2.log.gz");
    expect(fs.existsSync(gzPath)).toBe(true);
    const gz = fs.readFileSync(gzPath);
    const gunzipped = zlib.gunzipSync(gz).toString();
    expect(gunzipped).toContain("ROUND1 0");
    // 新一轮：app.1.log 为第二轮 plain 内容；原 app.1.log 已 gzip 并删除
    expect(fs.existsSync(path.join(logDir, "app.1.log"))).toBe(true);
    expect(fs.existsSync(path.join(logDir, "app.2.log"))).toBe(false);
    expect(fs.existsSync(path.join(logDir, "app.3.log.gz"))).toBe(false);
  });
});
