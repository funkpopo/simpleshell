// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const require = createRequire(import.meta.url);
const TERMINAL_HANDLERS_PATH = path.resolve(
  process.cwd(),
  "src/main/ipc/handlers/terminalHandlers.js",
);

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({ t: (key) => key, i18n: { language: "en-US" } }),
  };
});

vi.mock("../../src/renderer/app/ReconnectMenuSection.jsx", () => ({
  default: () => null,
}));

import {
  buildScrollbackExportFilename,
  extractBufferLogicalLines,
  extractTerminalScrollback,
  formatScrollbackHeader,
} from "../../src/renderer/features/terminal/lib/terminalBufferExport.js";
import WebTerminalContextMenu from "../../src/renderer/features/terminal/components/WebTerminalContextMenu.jsx";
import SessionContextMenu from "../../src/renderer/app/components/SessionContextMenu.jsx";

function createFakeTerminal(rows) {
  return {
    buffer: {
      active: {
        length: rows.length,
        getLine(index) {
          const entry = rows[index];
          if (!entry) return null;
          return {
            isWrapped: Boolean(entry.isWrapped),
            translateToString(trimRight = false) {
              const text = String(entry.text ?? "");
              return trimRight ? text.replace(/[ \t]+$/g, "") : text;
            },
          };
        },
      },
    },
  };
}

describe("terminalBufferExport pure utilities", () => {
  it("reconstructs wrapped logical lines, preserves internal spaces at wrap boundaries, and trims trailing blanks", () => {
    const term = createFakeTerminal([
      { text: "echo 'hello ", isWrapped: false },
      { text: "world'     ", isWrapped: true },
      { text: "line 2   ", isWrapped: false },
      { text: "   ", isWrapped: false },
      { text: "line 4", isWrapped: false },
      { text: "", isWrapped: false },
      { text: "    ", isWrapped: false },
    ]);

    expect(extractBufferLogicalLines(term)).toEqual([
      "echo 'hello world'",
      "line 2",
      "",
      "line 4",
    ]);
  });

  it("handles empty or missing terminal buffers safely", () => {
    expect(extractTerminalScrollback(null)).toMatchObject({
      text: "",
      body: "",
      lineCount: 0,
      isEmpty: true,
    });

    const blankOnly = createFakeTerminal([
      { text: "", isWrapped: false },
      { text: "   \t  ", isWrapped: false },
    ]);
    expect(
      extractTerminalScrollback(blankOnly, {
        includeHeader: true,
        metadata: { host: "prod-01" },
      }),
    ).toMatchObject({
      text: "",
      body: "",
      lineCount: 0,
      isEmpty: true,
    });
  });

  it("preserves CJK, Unicode, and emoji fidelity across wrapped rows", () => {
    const term = createFakeTerminal([
      { text: "部署日志：", isWrapped: false },
      { text: "节点 web-01 🚀 启动成功", isWrapped: true },
      { text: "状态：正常 ✓", isWrapped: false },
    ]);

    const result = extractTerminalScrollback(term, { includeHeader: false });
    expect(result.isEmpty).toBe(false);
    expect(result.lineCount).toBe(2);
    expect(result.text).toBe("部署日志：节点 web-01 🚀 启动成功\n状态：正常 ✓");
  });

  it("formats metadata header and sanitized export filenames", () => {
    const fixedDate = new Date("2026-11-24T01:02:03.000Z");
    const header = formatScrollbackHeader(
      {
        host: "prod.example.com",
        username: "ops",
        port: 2222,
        protocol: "ssh",
      },
      fixedDate,
    );
    expect(header).toContain("# SimpleShell Terminal Scrollback");
    expect(header).toContain("# Host: ops@prod.example.com:2222 (SSH)");
    expect(header).toContain("# Timestamp: 2026-11-24T01:02:03.000Z");

    const term = createFakeTerminal([{ text: "uptime", isWrapped: false }]);
    const exported = extractTerminalScrollback(term, {
      includeHeader: true,
      metadata: { host: "prod.example.com", protocol: "ssh" },
      timestamp: fixedDate,
    });
    expect(exported.text.startsWith("# SimpleShell Terminal Scrollback")).toBe(
      true,
    );
    expect(exported.text).toContain("\nuptime\n");

    const filename = buildScrollbackExportFilename(
      { host: "prod/web:01*?test" },
      fixedDate,
    );
    expect(filename).toBe("simpleshell-prod-web-01-test-20261124-010203.log");
  });
});

describe("TerminalHandlers.exportScrollback IPC handler", () => {
  let tempDir = null;

  function createIsolatedTerminalHandlers(mockDialog) {
    const originalLoad = Module._load;
    const mockElectron = {
      app: { getPath: () => os.tmpdir() },
      BrowserWindow: {
        fromWebContents: () => null,
        getFocusedWindow: () => null,
      },
      dialog: mockDialog,
    };
    Module._load = function load(request, parent, isMain) {
      const normalized = String(request).replaceAll("\\", "/");
      if (normalized === "electron") {
        return mockElectron;
      }
      if (normalized.endsWith("utils/logger")) {
        return { logToFile: vi.fn() };
      }
      if (normalized.endsWith("window/windowManager")) {
        return { broadcastToAllWindows: vi.fn() };
      }
      if (normalized.endsWith("settings/configService")) {
        return {};
      }
      if (normalized.endsWith("file-transfer/filemanagementService")) {
        return {};
      }
      if (normalized.endsWith("terminal/zmodemTransferService")) {
        return { zmodemTransferService: {} };
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[TERMINAL_HANDLERS_PATH];
    try {
      const TerminalHandlers = require(TERMINAL_HANDLERS_PATH);
      return new TerminalHandlers();
    } finally {
      Module._load = originalLoad;
      delete require.cache[TERMINAL_HANDLERS_PATH];
    }
  }

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = null;
  });

  it("validates payload, sanitizes default filenames, handles cancellation, and writes file on save", async () => {
    const mockDialog = {
      showSaveDialog: vi.fn(),
    };
    const handlers = createIsolatedTerminalHandlers(mockDialog);

    expect(handlers._sanitizeExportFilename("../../evil<>:name.txt")).toBe(
      "evil---name.txt",
    );
    expect(handlers._sanitizeExportFilename("my-session")).toBe(
      "my-session.log",
    );
    expect(handlers._sanitizeExportFilename("")).toBe(
      "terminal-scrollback.log",
    );

    await expect(handlers.exportScrollback({}, null)).rejects.toThrow(
      "Invalid scrollback export payload",
    );
    await expect(
      handlers.exportScrollback({}, { content: 123 }),
    ).rejects.toThrow("Scrollback content must be a string");

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simpleshell-export-"));
    const targetPath = path.join(tempDir, "session.log");

    mockDialog.showSaveDialog.mockResolvedValueOnce({
      canceled: true,
      filePath: "",
    });
    const cancelledRes = await handlers.exportScrollback(
      {},
      { content: "hello", defaultFilename: "test.log" },
    );
    expect(cancelledRes).toEqual({ success: false, cancelled: true });

    mockDialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: targetPath,
    });
    const savedRes = await handlers.exportScrollback(
      {},
      { content: "中文输出\nline 2\n", defaultFilename: "prod.log" },
    );
    expect(savedRes).toEqual({ success: true, filePath: targetPath });
    expect(fs.readFileSync(targetPath, "utf8")).toBe("中文输出\nline 2\n");
  });
});

describe("Context menus expose Copy All Output & Export Scrollback", () => {
  let root = null;
  let host = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    host?.remove();
    root = null;
    host = null;
    document.body.innerHTML = "";
  });

  it("renders and triggers WebTerminalContextMenu and SessionContextMenu actions", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const onCopyAllOutput = vi.fn();
    const onExportScrollback = vi.fn();

    host = document.createElement("div");
    const focusAnchor = document.createElement("button");
    focusAnchor.textContent = "anchor";
    document.body.appendChild(focusAnchor);
    focusAnchor.focus();
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(WebTerminalContextMenu, {
          contextMenu: { mouseX: 10, mouseY: 10 },
          isActive: true,
          selectedText: "",
          onClose: vi.fn(),
          onCopy: vi.fn(),
          onCopyAllOutput,
          onExportScrollback,
          onPaste: vi.fn(),
          onSendToAI: vi.fn(),
          onSearch: vi.fn(),
          onClear: vi.fn(),
        }),
      );
    });

    const copyAllBtn = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent.includes("terminal.copyAllOutput"),
    );
    const exportBtn = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent.includes("terminal.exportScrollback"),
    );
    expect(copyAllBtn).toBeTruthy();
    expect(exportBtn).toBeTruthy();

    await act(async () => copyAllBtn.click());
    await act(async () => exportBtn.click());
    expect(onCopyAllOutput).toHaveBeenCalledTimes(1);
    expect(onExportScrollback).toHaveBeenCalledTimes(1);

    // SessionContextMenu dispatches simpleshell:exportScrollback for the tab's focused pane
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener("simpleshell:exportScrollback", listener);
    try {
      await act(async () => {
        root.render(
          createElement(SessionContextMenu, {
            tabContextMenu: {
              mouseX: 20,
              mouseY: 20,
              tabIndex: 1,
              tabId: "tab-1",
            },
            handleTabContextMenuClose: vi.fn(),
            handleRefreshTerminal: vi.fn(),
            t: (key) => key,
            handleCloseConnection: vi.fn(),
            contextMenuTab: { id: "tab-1", type: "ssh" },
            splitLayouts: {
              "tab-1": {
                panes: ["tab-1", "tab-1::p2"],
                focusedPaneId: "tab-1::p2",
              },
            },
            handleUnsplitTab: vi.fn(),
            handlePauseReconnect: vi.fn(),
            handleResumeReconnect: vi.fn(),
            syncGroups: [],
            handleJoinGroup: vi.fn(),
            handleRemoveFromGroup: vi.fn(),
            handleCreateGroup: vi.fn(),
          }),
        );
      });

      const tabExportItem = [
        ...document.querySelectorAll('[role="menuitem"]'),
      ].find((el) => el.textContent.includes("terminal.exportScrollback"));
      expect(tabExportItem).toBeTruthy();
      await act(async () => tabExportItem.click());
      expect(events).toEqual([{ sessionKey: "tab-1::p2", action: "export" }]);
    } finally {
      window.removeEventListener("simpleshell:exportScrollback", listener);
    }
  });
});
