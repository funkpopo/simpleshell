import { expect, it, vi } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  installWindowsWebpackMoveFallback,
} = require("../../scripts/lib/windows-webpack-move");
const root = path.resolve(".cache/webpack-move-test");
const source = path.join(root, "renderer");
const destination = path.join(root, "x64/renderer");
const locked = () => Object.assign(new Error("locked"), { code: "EPERM" });

function fixture() {
  const filesystem = {
    rename: vi.fn().mockRejectedValue(locked()),
    lstat: vi.fn(async (filename) => {
      if (filename === destination)
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isDirectory: () => true };
    }),
    cp: vi.fn().mockResolvedValue(),
    rm: vi.fn().mockResolvedValue(),
  };
  const originalRename = filesystem.rename;
  installWindowsWebpackMoveFallback(root, {
    filesystem,
    platform: "win32",
    retries: 1,
    retryDelayMs: 0,
  });
  return { filesystem, originalRename };
}

it("retries transient bundle locks without copying", async () => {
  const { filesystem, originalRename } = fixture();
  originalRename.mockRejectedValueOnce(locked()).mockResolvedValueOnce();
  await filesystem.rename(source, destination);
  expect(originalRename).toHaveBeenCalledTimes(2);
  expect(filesystem.cp).not.toHaveBeenCalled();
  expect(filesystem.rm).not.toHaveBeenCalled();
});

it("copies a locked bundle before removing the source", async () => {
  const { filesystem } = fixture();
  await filesystem.rename(source, destination);
  expect(filesystem.cp).toHaveBeenCalledWith(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  expect(filesystem.rm).toHaveBeenCalledWith(
    source,
    expect.objectContaining({ recursive: true }),
  );
  expect(filesystem.cp.mock.invocationCallOrder[0]).toBeLessThan(
    filesystem.rm.mock.invocationCallOrder[0],
  );
});

it("preserves the source when copying fails or the destination already exists", async () => {
  const { filesystem } = fixture();
  filesystem.cp.mockRejectedValue(new Error("destination exists"));
  await expect(filesystem.rename(source, destination)).rejects.toThrow(
    "destination exists",
  );
  expect(filesystem.rm).not.toHaveBeenCalled();
});

it("does not merge bundles into an existing destination", async () => {
  const { filesystem } = fixture();
  filesystem.lstat.mockResolvedValue({ isDirectory: () => true });
  await expect(filesystem.rename(source, destination)).rejects.toThrow(
    "locked",
  );
  expect(filesystem.cp).not.toHaveBeenCalled();
  expect(filesystem.rm).not.toHaveBeenCalled();
});

it.each([
  [path.resolve("src"), destination],
  [source, path.resolve("out/renderer")],
  [root, destination],
  [source, path.resolve(root, "../webpack-move-test-other/renderer")],
])(
  "does not change rename behavior outside the generated tree: %s -> %s",
  async (from, to) => {
    const { filesystem, originalRename } = fixture();
    await expect(filesystem.rename(from, to)).rejects.toThrow("locked");
    expect(originalRename).toHaveBeenCalledOnce();
    expect(filesystem.lstat).not.toHaveBeenCalled();
    expect(filesystem.cp).not.toHaveBeenCalled();
    expect(filesystem.rm).not.toHaveBeenCalled();
  },
);
