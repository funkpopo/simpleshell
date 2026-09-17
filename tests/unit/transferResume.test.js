import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TransferResumeStore,
  connectionIdentity,
  fingerprint,
  sameFingerprint,
  probeResumeState,
  resumeError,
} from "../../src/modules/filemanagement/transferResume.js";

// 真实文件系统上的临时目录，每个用例独立
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ssx-resume-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const makeConnection = () =>
  connectionIdentity({ host: "h1", port: 22, username: "u" });

const buildRecord = (store, overrides = {}) => {
  const described = store.describe({
    direction: "upload",
    localPath: path.join(root, "a.txt"),
    remotePath: "/root/a.txt",
    connection: makeConnection(),
    ...overrides,
  });
  return { ...described, id: described.id };
};

const buildManifest = (record, overrides = {}) => ({
  version: 1,
  id: record.id,
  localPath: record.localPath,
  remotePath: record.remotePath,
  direction: "upload",
  connection: record.connection,
  totalSize: 10,
  segments: [{ offset: 0, length: 10, done: false }],
  phase: "transferring",
  source: { size: 10, mtime: 1234.5 },
  algorithm: null,
  integrityRetries: 0,
  dirty: false,
  ...overrides,
});

describe("connectionIdentity", () => {
  it("归一化主机名大小写并补充默认端口与指纹", () => {
    expect(
      connectionIdentity({
        host: "Example.COM",
        port: "2222",
        username: "root",
      }),
    ).toEqual({
      host: "example.com",
      port: 2222,
      username: "root",
      hostFingerprint: null,
    });
  });

  it("expectedHostFingerprint 参与连接身份", () => {
    const withFingerprint = connectionIdentity({
      host: "h",
      expectedHostFingerprint: "aa:bb",
    });
    expect(withFingerprint.hostFingerprint).toBe("aa:bb");
  });
});

describe("TransferResumeStore.describe", () => {
  it("同一传输四元组生成稳定 id 与固定路径", () => {
    const store = new TransferResumeStore(root);
    const input = {
      direction: "upload",
      localPath: path.join(root, "a.txt"),
      remotePath: "/root/a.txt",
      connection: makeConnection(),
    };
    const first = store.describe(input);
    const second = store.describe({ ...input, id: "ignored" });
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(first.manifestPath).toBe(
      path.join(root, `${first.id}.ssx-progress.json`),
    );
    expect(first.partPath).toContain("/root/a.txt.");
  });

  it("download 的 manifest 与 part 路径跟随本地文件", () => {
    const store = new TransferResumeStore(root);
    const localPath = path.join(root, "b.txt");
    const described = store.describe({
      direction: "download",
      localPath,
      remotePath: "/var/b.txt",
      connection: makeConnection(),
    });
    expect(described.manifestPath).toBe(`${localPath}.ssx-progress.json`);
    expect(described.partPath).toBe(`${localPath}.part`);
  });

  it("localPath 被解析为绝对路径", () => {
    const store = new TransferResumeStore(root);
    const described = store.describe({
      direction: "upload",
      localPath: "a.txt",
      remotePath: "/r",
      connection: makeConnection(),
    });
    expect(path.isAbsolute(described.localPath)).toBe(true);
  });
});

describe("TransferResumeStore 租约", () => {
  it("同一目标不可并发持有，释放后可重新获取", () => {
    const store = new TransferResumeStore(root);
    const record = buildRecord(store);
    const release = store.acquire(record);
    expect(() => store.acquire(record)).toThrowError(
      expect.objectContaining({ errorKind: "transfer-busy" }),
    );
    release();
    const release2 = store.acquire(record);
    expect(() => store.acquire(record)).toThrowError(
      expect.objectContaining({ errorKind: "transfer-busy" }),
    );
    release2();
  });

  it("download 按本地路径持锁", () => {
    const store = new TransferResumeStore(root);
    const download = store.describe({
      direction: "download",
      localPath: path.join(root, "c.txt"),
      remotePath: "/other/c.txt",
      connection: makeConnection(),
    });
    const download2 = store.describe({
      direction: "download",
      localPath: path.join(root, "c.txt"),
      remotePath: "/different.txt",
      connection: makeConnection(),
    });
    expect(download2.id).not.toBe(download.id);
    // 同一本地文件的两次下载互相冲突
    const release = store.acquire({ ...download, id: download.id });
    expect(() =>
      store.acquire({ ...download2, id: download2.id }),
    ).toThrowError(expect.objectContaining({ errorKind: "transfer-busy" }));
    release();
  });

  it("upload 按连接和远端路径持锁", () => {
    const store = new TransferResumeStore(root);
    const first = buildRecord(store);
    const sameTarget = buildRecord(store, {
      localPath: path.join(root, "other.txt"),
    });
    const otherConnection = buildRecord(store, {
      connection: connectionIdentity({ host: "h2", username: "u" }),
    });
    const release = store.acquire(first);
    expect(() => store.acquire(sameTarget)).toThrowError(
      expect.objectContaining({ errorKind: "transfer-busy" }),
    );
    const releaseOther = store.acquire(otherConnection);
    releaseOther();
    release();
  });
});

describe("TransferResumeStore.recordPath", () => {
  it("仅接受 64 位十六进制 id", () => {
    const store = new TransferResumeStore(root);
    expect(() => store.recordPath("../escape")).toThrowError(
      expect.objectContaining({ errorKind: "resume-conflict" }),
    );
    expect(store.recordPath("a".repeat(64))).toBe(
      path.join(root, `${"a".repeat(64)}.json`),
    );
  });
});

describe("TransferResumeStore 持久化往返", () => {
  it("register/write/read/remove 全流程", async () => {
    const store = new TransferResumeStore(root);
    const record = buildRecord(store);
    const manifest = buildManifest(record);

    await store.register(record);
    expect(fs.readdirSync(root)).toContain(`${record.id}.json`);

    await store.write(record, manifest);
    const readBack = await store.read(record);
    expect(readBack.phase).toBe("transferring");
    expect(readBack.dirty).toBe(false);

    await store.remove(record);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("并发 write 串行化，后写不回滚先写", async () => {
    const store = new TransferResumeStore(root);
    const record = buildRecord(store);
    await store.register(record);

    const first = buildManifest(record, { phase: "transferring" });
    const second = buildManifest(record, { phase: "validating" });

    // 同时提交两个版本，验证最后提交的状态最终落盘。
    const writes = Promise.all([
      store.write(record, first),
      store.write(record, second),
    ]);
    await writes;

    const final = await store.read(record);
    // 两次写入都已落盘，最后一次生效
    expect(final.phase).toBe("validating");
  });

  it("manifest 被篡改时抛 resume-manifest-invalid", async () => {
    const store = new TransferResumeStore(root);
    const record = buildRecord(store);
    await store.register(record);
    await store.write(record, buildManifest(record));

    const tampered = JSON.parse(fs.readFileSync(record.manifestPath, "utf8"));
    tampered.totalSize = 999;
    fs.writeFileSync(record.manifestPath, JSON.stringify(tampered));

    await expect(store.read(record)).rejects.toMatchObject({
      errorKind: "resume-manifest-invalid",
    });
  });

  it("list 对损坏 manifest 返回错误信息而非抛出", async () => {
    const store = new TransferResumeStore(root);
    const record = buildRecord(store);
    await store.register(record);
    await store.write(record, buildManifest(record));

    const bad = JSON.parse(fs.readFileSync(record.manifestPath, "utf8"));
    bad.segments = [];
    fs.writeFileSync(record.manifestPath, JSON.stringify(bad));

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].errorKind).toBe("resume-manifest-invalid");
    expect(listed[0].manifest).toBeNull();
  });

  it("list 在根目录不存在时返回空数组", async () => {
    const store = new TransferResumeStore(path.join(root, "missing-dir"));
    expect(await store.list()).toEqual([]);
  });
});

describe("fingerprint / sameFingerprint", () => {
  it("本地文件指纹取 mtimeMs，远端取 modifyTime", () => {
    expect(
      fingerprint({ size: 5, mtimeMs: 10, isFile: () => true }, true),
    ).toEqual({
      size: 5,
      mtime: 10,
    });
    expect(
      fingerprint({ size: 5, modifyTime: 20, mode: 0o100644 }, false),
    ).toEqual({ size: 5, mtime: 20 });
  });

  it("目录或非法 size 拒绝", () => {
    expect(() =>
      fingerprint({ size: 5, mtimeMs: 1, isDirectory: true }, false),
    ).toThrowError(/regular file/);
    expect(() => fingerprint({ size: -1, mtimeMs: 1 }, true)).toThrowError(
      /regular file/,
    );
    expect(() => fingerprint(null, true)).toThrowError(/regular file/);
  });

  it("sameFingerprint 比较大小与修改时间", () => {
    expect(sameFingerprint({ size: 1, mtime: 2 }, { size: 1, mtime: 2 })).toBe(
      true,
    );
    expect(sameFingerprint({ size: 1, mtime: 2 }, { size: 1, mtime: 3 })).toBe(
      false,
    );
    expect(sameFingerprint(null, { size: 1, mtime: 2 })).toBe(false);
  });
});

describe("probeResumeState", () => {
  const baseArgs = () => ({
    manifest: null,
    fileSize: 10,
    source: { size: 10, mtime: 1234.5 },
    destination: { size: 4 },
    verifyRange: async () => {},
  });

  it("无 manifest 不可续传", async () => {
    const result = await probeResumeState(baseArgs());
    expect(result).toEqual({ resumable: false, resumeOffset: 0 });
  });

  it("源文件变化后要求重启传输（source-changed）", async () => {
    const args = baseArgs();
    args.manifest = buildManifest(buildRecord(new TransferResumeStore(root)));
    // 源 mtime 与 manifest.source 不一致 -> source-changed
    args.source = { size: 10, mtime: 999 };
    await expect(probeResumeState(args)).rejects.toMatchObject({
      errorKind: "source-changed",
    });
  });

  it("指纹一致且未 dirty 的单段任务按目标大小续传", async () => {
    const store = new TransferResumeStore(root);
    const record = buildRecord(store);
    const manifest = buildManifest(record, {
      source: { size: 10, mtime: 1234.5 },
      destination: { size: 4, mtime: 1234.5 },
    });
    const result = await probeResumeState({
      ...baseArgs(),
      manifest,
      destination: { size: 4, mtime: 1234.5 },
    });
    expect(result.resumable).toBe(true);
    expect(result.resumeOffset).toBe(4);
  });

  it("目标文件缺失或超长时拒绝续传", async () => {
    const store = new TransferResumeStore(root);
    const manifest = buildManifest(buildRecord(store));
    await expect(
      probeResumeState({ ...baseArgs(), manifest, destination: null }),
    ).rejects.toThrowError(/Partial destination is missing/);
    await expect(
      probeResumeState({
        ...baseArgs(),
        manifest,
        destination: { size: 50 },
      }),
    ).rejects.toThrowError(/oversized/);
  });

  it("dirty 恢复需校验已完成段的字节范围", async () => {
    const store = new TransferResumeStore(root);
    const manifest = buildManifest(buildRecord(store), {
      dirty: true,
      segments: [
        { offset: 0, length: 6, done: true },
        { offset: 6, length: 4, done: false },
      ],
    });
    const verified = [];
    const result = await probeResumeState({
      ...baseArgs(),
      manifest,
      destination: { size: 6 },
      verifyRange: async (range) => {
        verified.push(range);
      },
    });
    expect(result.resumeOffset).toBe(0);
    expect(verified).toEqual([{ offset: 0, length: 6, done: true }]);
  });

  it("dirty 恢复时完成段超出目标大小则拒绝", async () => {
    const store = new TransferResumeStore(root);
    const manifest = buildManifest(buildRecord(store), {
      dirty: true,
      segments: [
        { offset: 0, length: 8, done: true },
        { offset: 8, length: 2, done: false },
      ],
    });
    await expect(
      probeResumeState({
        ...baseArgs(),
        manifest,
        destination: { size: 4 },
      }),
    ).rejects.toThrowError(/Completed segment is missing/);
  });
});

describe("resumeError", () => {
  it("构造不可重试错误并携带 errorKind", () => {
    const error = resumeError("boom", "source-changed");
    expect(error).toBeInstanceOf(Error);
    expect(error.errorKind).toBe("source-changed");
    expect(error.retryable).toBe(false);
    // 默认 errorKind
    expect(resumeError("x").errorKind).toBe("resume-conflict");
  });
});
