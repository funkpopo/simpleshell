import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processManager = { getProcess: vi.fn() };
const nativeSftpClient = {
  getFilePermissionsBatch: vi.fn(),
  requireNativeSuccess: vi.fn(),
};

// Load the real CommonJS handler with isolated boundary doubles. Avoid global
// require/cache patches and Electron services starting during a unit test.
const filename = fileURLToPath(
  new URL("../../src/core/ipc/handlers/fileHandlers.js", import.meta.url),
);
const requireFromHandler = createRequire(filename);
const doubles = new Map([
  ["../../../modules/filemanagement/filemanagementService", {}],
  ["../../utils/nativeSftpClient", nativeSftpClient],
  ["../../utils/logger", { logToFile() {} }],
  ["../../process/processManager", processManager],
  ["electron", { shell: {} }],
  ["../../../services/configService", {}],
  ["../../terminal/zmodemTransferService", { zmodemTransferService: {} }],
]);
const handlerModule = { exports: {} };
compileFunction(
  readFileSync(filename, "utf8"),
  ["require", "module", "exports", "__filename", "__dirname"],
  { filename },
)(
  (request) =>
    doubles.has(request) ? doubles.get(request) : requireFromHandler(request),
  handlerModule,
  handlerModule.exports,
  filename,
  dirname(filename),
);
const FileHandlers = handlerModule.exports;
const tabId = "ssh-drop-session";
const missing = {
  success: false,
  errorCode: "NATIVE_SFTP_NOT_FOUND",
  error: "No such file",
};
const file = (relativePath) => ({ relativePath });
let handlers;

beforeEach(() => {
  vi.resetAllMocks();
  processManager.getProcess.mockReturnValue({
    type: "ssh2",
    config: { host: "example.test" },
    process: {},
  });
  nativeSftpClient.getFilePermissionsBatch.mockResolvedValue({
    success: true,
    results: [],
  });
  handlers = new FileHandlers();
});

describe("dropped upload overwrite preflight", () => {
  it("deduplicates normalized paths and associates mixed results with files and folders", async () => {
    nativeSftpClient.getFilePermissionsBatch.mockResolvedValue({
      success: true,
      results: [
        { success: true, mode: 420, permissions: "rw-r--r--" },
        missing,
        {
          success: true,
          mode: 493,
          permissions: "rwxr-xr-x",
          stats: { isDirectory: true },
        },
      ],
    });

    const result = await handlers.checkDroppedUploadConflicts(
      null,
      tabId,
      "~/uploads",
      {
        files: [
          file("docs\\report.txt"),
          file("new.txt"),
          file("docs/report.txt"),
        ],
        folders: [file("assets")],
      },
    );

    expect(
      nativeSftpClient.getFilePermissionsBatch,
    ).toHaveBeenCalledExactlyOnceWith(tabId, [
      "uploads/docs/report.txt",
      "uploads/new.txt",
      "uploads/assets",
    ]);
    expect(result).toEqual({
      success: true,
      hasConflicts: true,
      conflicts: [
        {
          type: "file",
          name: "report.txt",
          relativePath: "docs/report.txt",
          remotePath: "uploads/docs/report.txt",
          mode: 420,
          permissions: "rw-r--r--",
          isDirectory: false,
        },
        {
          type: "directory",
          name: "assets",
          relativePath: "assets",
          remotePath: "uploads/assets",
          mode: 493,
          permissions: "rwxr-xr-x",
          isDirectory: true,
        },
      ],
    });
    expect(nativeSftpClient.requireNativeSuccess).not.toHaveBeenCalled();
  });

  it("accepts only explicit not-found responses as absent paths", async () => {
    nativeSftpClient.getFilePermissionsBatch.mockResolvedValue({
      success: true,
      results: [missing, missing],
    });
    await expect(
      handlers.checkDroppedUploadConflicts(null, tabId, "/target", {
        files: [file("new.txt")],
        folders: [file("new-folder")],
      }),
    ).resolves.toEqual({ success: true, hasConflicts: false, conflicts: [] });
    expect(nativeSftpClient.requireNativeSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["permission denied", "NATIVE_SFTP_PERMISSION_DENIED"],
    ["disconnected", "NATIVE_SFTP_CONNECTION_LOST"],
    ["timeout", "NATIVE_SFTP_TIMEOUT"],
    ["unknown failure", "UNRECOGNIZED_ERROR"],
    ["No such file", undefined],
  ])(
    "propagates %s instead of clearing the overwrite check",
    async (message, errorCode) => {
      const failedResult = { success: false, error: message, errorCode };
      const failure = Object.assign(new Error(message), { errorCode });
      nativeSftpClient.getFilePermissionsBatch.mockResolvedValue({
        success: true,
        results: [{ success: true }, failedResult],
      });
      nativeSftpClient.requireNativeSuccess.mockImplementation(() => {
        throw failure;
      });

      await expect(
        handlers.checkDroppedUploadConflicts(null, tabId, "/target", {
          files: [file("existing.txt"), file("unreadable.txt")],
        }),
      ).rejects.toBe(failure);
      expect(
        nativeSftpClient.requireNativeSuccess,
      ).toHaveBeenCalledExactlyOnceWith(failedResult);
    },
  );

  it("propagates batch request failure", async () => {
    const failure = new Error("SFTP session unavailable");
    nativeSftpClient.getFilePermissionsBatch.mockRejectedValue(failure);
    await expect(
      handlers.checkDroppedUploadConflicts(null, tabId, "/target", {
        files: [file("file.txt")],
      }),
    ).rejects.toBe(failure);
  });

  it("returns no conflicts for an empty drop", async () => {
    await expect(
      handlers.checkDroppedUploadConflicts(null, tabId, "/target", {}),
    ).resolves.toEqual({ success: true, hasConflicts: false, conflicts: [] });
    expect(
      nativeSftpClient.getFilePermissionsBatch,
    ).toHaveBeenCalledExactlyOnceWith(tabId, []);
  });

  it("rejects an unavailable SSH session before probing paths", async () => {
    processManager.getProcess.mockReturnValue(undefined);
    await expect(
      handlers.checkDroppedUploadConflicts(null, tabId, "/target", {
        files: [file("file.txt")],
      }),
    ).rejects.toThrow();
    expect(nativeSftpClient.getFilePermissionsBatch).not.toHaveBeenCalled();
  });
});
