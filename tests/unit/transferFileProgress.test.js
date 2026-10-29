// @vitest-environment jsdom
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderHook } from "../helpers/reactHarness.js";
import TransferItemCard from "../../src/renderer/features/transfers/components/TransferItemCard.jsx";
import {
  applySftpTransferState,
  useTransferActions,
} from "../../src/renderer/features/transfers/state/globalTransferStore.js";

const require = createRequire(import.meta.url);
const {
  normalizeDroppedTransferRelativePath,
  normalizeRemoteTransferPath,
  sanitizeLocalPathSegment,
  createLocalPathAllocator,
} = require("../../src/main/file-transfer/transferShared.js");

const { t } = vi.hoisted(() => ({
  t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

describe("transfer name handling", () => {
  it("keeps leading/trailing spaces in dropped relative path segments", () => {
    expect(normalizeDroppedTransferRelativePath(" dir /./ a.txt ")).toBe(
      " dir / a.txt ",
    );
    expect(normalizeDroppedTransferRelativePath("a\\..\\b.txt")).toBe(
      "a/b.txt",
    );
  });

  it("does not trim or rewrite backslashes in remote paths", () => {
    expect(normalizeRemoteTransferPath("/data/back\\slash.log ")).toBe(
      "/data/back\\slash.log ",
    );
    expect(normalizeRemoteTransferPath("  ")).toBe(".");
    expect(normalizeRemoteTransferPath("~")).toBe(".");
    expect(normalizeRemoteTransferPath("~/uploads")).toBe("./uploads");
  });

  it("maps remote names to valid Windows file names", () => {
    expect(sanitizeLocalPathSegment("12:00:01?.log", "win32")).toBe(
      "12_00_01_.log",
    );
    expect(sanitizeLocalPathSegment('a<b>c"d|e*f\\g', "win32")).toBe(
      "a_b_c_d_e_f_g",
    );
    expect(sanitizeLocalPathSegment("name. ", "win32")).toBe("name__");
    expect(sanitizeLocalPathSegment("CON", "win32")).toBe("_CON");
    expect(sanitizeLocalPathSegment("nul.txt", "win32")).toBe("_nul.txt");
    expect(sanitizeLocalPathSegment("12:00.log", "linux")).toBe("12:00.log");
  });

  it("deduplicates case-insensitive and sanitized collisions per directory", () => {
    const allocator = createLocalPathAllocator("win32");
    expect(allocator.resolveSegments("Dir/A.txt")).toEqual(["Dir", "A.txt"]);
    expect(allocator.resolveSegments("Dir/a.txt")).toEqual([
      "Dir",
      "a (1).txt",
    ]);
    expect(allocator.resolveSegments("dir/a.txt")).toEqual([
      "dir (1)",
      "a.txt",
    ]);
    expect(allocator.resolveSegments("Dir/a?.txt")).toEqual([
      "Dir",
      "a_.txt",
    ]);
    expect(allocator.resolveSegments("Dir/a:.txt")).toEqual([
      "Dir",
      "a_ (1).txt",
    ]);
    // 同一远程路径重复解析得到同一本地路径
    expect(allocator.resolveSegments("Dir/a.txt")).toEqual([
      "Dir",
      "a (1).txt",
    ]);

    const linux = createLocalPathAllocator("linux");
    expect(linux.resolveSegments("A.txt")).toEqual(["A.txt"]);
    expect(linux.resolveSegments("a.txt")).toEqual(["a.txt"]);
  });
});

describe("per-file transfer progress", () => {
  it("merges the initial file list and incremental updates into the transfer", async () => {
    const tabId = "file-progress-tab";
    const transferKey = "file-progress-key";
    const actions = await renderHook(() => useTransferActions(tabId));
    let transferId;
    await act(async () => {
      transferId = actions.current.addTransferProgress({
        type: "upload-multifile",
        progress: 0,
        totalFiles: 2,
        transferKey,
      });
    });

    const fileList = [
      { index: 1, name: "b.txt", size: 10, transferredBytes: 0, status: "pending" },
      { index: 0, name: "a.txt", size: 10, transferredBytes: 0, status: "pending" },
    ];
    await act(async () => {
      applySftpTransferState({
        tabId,
        transferKey,
        progress: 0,
        status: "transferring",
        fileList,
        fileListReset: true,
      });
    });
    let transfer = actions.current
      .getTransferList()
      .find((item) => item.transferId === transferId);
    expect(transfer.fileList.map((item) => item.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);

    await act(async () => {
      applySftpTransferState({
        tabId,
        transferKey,
        progress: 50,
        status: "transferring",
        fileUpdates: [
          {
            index: 1,
            name: "b.txt",
            size: 10,
            transferredBytes: 10,
            status: "completed",
          },
        ],
      });
    });
    transfer = actions.current
      .getTransferList()
      .find((item) => item.transferId === transferId);
    expect(transfer.fileList[0].status).toBe("pending");
    expect(transfer.fileList[1].status).toBe("completed");

    // 渲染进程自身的更新不会覆盖已合并的文件清单
    await act(async () => {
      actions.current.updateTransferProgress(transferId, { fileName: "batch" });
    });
    transfer = actions.current
      .getTransferList()
      .find((item) => item.transferId === transferId);
    expect(transfer.fileList).toHaveLength(2);

    await act(async () => actions.current.clearAllTransfers());
    await actions.unmount();
  });
});

describe("float card for multi-file transfers", () => {
  let root;
  let host;

  const render = async (props) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(TransferItemCard, props));
    });
  };

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    root = null;
    host = null;
    document.body.innerHTML = "";
  });

  const multiFileTransfer = {
    tabId: "tab-1",
    transferId: "t-multi",
    transferKey: "key-multi",
    type: "upload-multifile",
    fileName: "a.txt 等 3 个文件",
    statusText: "fileManager.transfer.status.uploading",
    currentFile: "a.txt 等 3 个文件",
    currentFileIndex: 3,
    progress: 40,
    transferredBytes: 40,
    totalBytes: 100,
    totalFiles: 3,
    fileList: [
      { index: 0, name: "a.txt", size: 20, transferredBytes: 20, status: "completed" },
      { index: 1, name: "b.txt", size: 40, transferredBytes: 20, status: "transferring" },
      { index: 2, name: "c.txt", size: 40, transferredBytes: 0, status: "pending" },
    ],
  };

  it("shows each active file with its own progress and a single count line", async () => {
    await render({ variant: "float", transfer: multiFileTransfer, onCancel: vi.fn() });

    const text = document.body.textContent;
    const rows = document.querySelectorAll('[data-testid="transfer-active-file"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("b.txt");
    expect(rows[0].textContent).toContain("50%");
    // 计数取自逐文件清单（1 个已完成），而非跳动的 currentFileIndex
    expect(text).toContain(
      'fileManager.transfer.completedFiles:{"completed":1,"total":3}',
    );
    expect(text.split("fileManager.transfer.completedFiles")).toHaveLength(2);
    // 显示名只作为标题出现一次
    expect(text.split("a.txt 等 3 个文件")).toHaveLength(2);
    expect(text).toContain('fileManager.transfer.pendingFiles:{"count":1}');
  });

  it("collapses active rows when finished and still allows viewing the file list", async () => {
    await render({
      variant: "float",
      isActive: false,
      onDelete: vi.fn(),
      transfer: {
        ...multiFileTransfer,
        progress: 100,
        fileList: multiFileTransfer.fileList.map((item) => ({
          ...item,
          transferredBytes: item.size,
          status: "completed",
        })),
      },
    });

    expect(
      document.querySelectorAll('[data-testid="transfer-active-file"]'),
    ).toHaveLength(0);
    expect(
      document.querySelector('button[aria-label="fileManager.transfer.deleteRecord"]'),
    ).toBeTruthy();

    const toggle = [...document.querySelectorAll("button")].find((button) =>
      button.textContent.includes("fileManager.transfer.viewFileList"),
    );
    expect(toggle).toBeTruthy();
    expect(document.body.textContent).not.toContain("c.txt");
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("a.txt");
    expect(document.body.textContent).toContain("c.txt");
    expect(document.body.textContent).toContain("fileManager.transfer.hideFileList");
  });
});
