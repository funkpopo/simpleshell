// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { deferred, renderHook } from "../helpers/reactHarness.js";
import useFileNav from "../../src/components/filemanager/hooks/useFileNav.js";
import useFileSelection from "../../src/components/filemanager/hooks/useFileSelection.js";
import useConfirmDialog from "../../src/components/filemanager/hooks/useConfirmDialog.js";
import useDragDrop from "../../src/components/filemanager/hooks/useDragDrop.js";
import useTransferTasks from "../../src/components/filemanager/hooks/useTransferTasks.js";
import useFileOps from "../../src/components/filemanager/hooks/useFileOps.js";
import FileManager from "../../src/components/FileManager.jsx";
import CreateFileDialog from "../../src/components/filemanager/dialogs/CreateFileDialog.jsx";
import CreateFolderDialog from "../../src/components/filemanager/dialogs/CreateFolderDialog.jsx";
import RenameDialog from "../../src/components/filemanager/dialogs/RenameDialog.jsx";
import PermissionDialog from "../../src/components/filemanager/dialogs/PermissionDialog.jsx";
import PropertiesDialog from "../../src/components/filemanager/dialogs/PropertiesDialog.jsx";
import PreviewDialog from "../../src/components/filemanager/dialogs/PreviewDialog.jsx";
import {
  useGlobalTransfers,
  useTransferActions,
} from "../../src/store/globalTransferStore.js";

const { translate, notify } = vi.hoisted(() => ({
  translate: (key) => key,
  notify: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en" } }),
}));
vi.mock("../../src/contexts/NotificationContext", () => ({
  useNotification: () => ({ showNotification: notify }),
}));

let mounted = [];
const mount = async (...args) => {
  const result = await renderHook(...args);
  mounted.push(result);
  return result;
};
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {};
  window.__hardwareAccelerationEnabled = false;
  notify.mockClear();
});
afterEach(async () => {
  for (const hook of mounted.reverse()) await hook.unmount();
  mounted = [];
  vi.useRealTimers();
});

const navProps = () => ({
  open: false,
  initialPath: "/",
  tabId: "files-session",
  sshConnection: { host: "example.test" },
  showNotification: notify,
});
const file = (name, size = 1) => ({ name, size, isDirectory: false });

describe("file navigation and selection boundaries", () => {
  it("does not publish a pending directory response after unmount", async () => {
    const pending = deferred();
    window.terminalAPI.listFiles = () => pending.promise;
    const onPathChange = vi.fn();
    const hook = await mount(useFileNav, { ...navProps(), onPathChange });
    let request;
    await act(() => {
      request = hook.current.loadDirectory("/late");
    });
    await hook.unmount();
    mounted.pop();
    await act(async () => {
      pending.resolve({ success: true, data: [file("late")] });
      await request;
    });
    expect(onPathChange).not.toHaveBeenCalled();
  });
  it("commits only the newest directory response and ignores old chunks", async () => {
    const slow = deferred();
    const fast = deferred();
    let receiveChunk;
    const unsubscribe = vi.fn();
    window.terminalAPI.listFiles = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);
    window.terminalAPI.onListFilesChunk = (listener) => {
      receiveChunk = listener;
      return unsubscribe;
    };
    const hook = await mount(useFileNav, { ...navProps(), open: true });
    let first;
    let second;
    await act(() => {
      first = hook.current.loadDirectory("/old");
      second = hook.current.loadDirectory("/new");
    });
    await act(async () => {
      fast.resolve({
        success: true,
        data: [file("new")],
        chunked: true,
        token: "new-token",
      });
      await second;
      slow.resolve({
        success: true,
        data: [file("old")],
        chunked: true,
        token: "old-token",
      });
      await first;
    });
    await act(() => {
      receiveChunk({
        tabId: "files-session",
        path: "/old",
        token: "old-token",
        items: [file("stale")],
        done: true,
      });
      receiveChunk({
        tabId: "files-session",
        path: "/new",
        token: "new-token",
        items: [file("next")],
        done: true,
      });
    });
    expect(hook.current.currentPath).toBe("/new");
    expect(hook.current.files.map((entry) => entry.name)).toEqual([
      "new",
      "next",
    ]);
    expect(hook.current.isChunking).toBe(false);
    await hook.unmount();
    mounted.pop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("preserves refreshed selection objects, resets on navigation, and restores history", async () => {
    window.terminalAPI.listFiles = vi.fn(async (_tab, path) => ({
      success: true,
      data: path === "/" ? [file("a", 3), file("b", 4)] : [file("child")],
    }));
    const hook = await mount((props) => {
      const nav = useFileNav(props);
      const selection = useFileSelection(nav);
      return { nav, selection };
    }, navProps());
    await act(() => hook.current.nav.loadDirectory("/"));
    await act(() =>
      hook.current.selection.handleFileSelect(hook.current.nav.files[0], 0, {
        stopPropagation() {},
      }),
    );
    window.terminalAPI.listFiles.mockResolvedValueOnce({
      success: true,
      data: [file("a", 99)],
    });
    await act(() => hook.current.nav.loadDirectory("/", 0, true));
    expect(hook.current.selection.getSelectedFiles()).toEqual([file("a", 99)]);
    await act(() => hook.current.nav.loadDirectory("/child"));
    expect(hook.current.selection.getSelectedFiles()).toEqual([]);
    await act(() => hook.current.nav.handleHistoryBack());
    expect(hook.current.nav.currentPath).toBe("/");
    expect(hook.current.nav.pathHistory).toEqual(["/", "/child"]);
    await act(() => hook.current.nav.handleGoToNextPath());
    expect(hook.current.nav.currentPath).toBe("/child");
  });

  it("keeps range selection aligned with the sorted, filtered list", async () => {
    const hook = await mount(useFileSelection, {
      files: [file("c"), file("a"), file("b")],
      isChunking: false,
      selectionResetKey: 0,
    });
    await act(() =>
      hook.current.handleFileSelect(hook.current.displayFiles[0], 0, {
        stopPropagation() {},
      }),
    );
    await act(() =>
      hook.current.handleFileSelect(hook.current.displayFiles[2], 2, {
        shiftKey: true,
        stopPropagation() {},
        preventDefault() {},
      }),
    );
    expect(hook.current.getSelectedFiles().map((entry) => entry.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    await act(() =>
      hook.current.handleSearchChange({ target: { value: "b" } }),
    );
    expect(hook.current.getSelectedFiles()).toEqual([]);
    await act(() => hook.current.selectAll());
    expect(hook.current.getSelectedFiles()).toEqual([file("b")]);
  });
});

it("resolves superseded and unmounted confirmations without running cancelled actions", async () => {
  const hook = await mount(useConfirmDialog);
  let first;
  let second;
  await act(() => {
    first = hook.current.showConfirmDialog({ title: "first" });
  });
  await act(() => {
    second = hook.current.showConfirmDialog({ title: "second" });
  });
  expect(await first).toBe(false);
  await act(() => hook.current.handleConfirmDialogConfirm());
  expect(await second).toBe(true);
  let pending;
  await act(() => {
    pending = hook.current.showConfirmDialog({ title: "pending" });
  });
  await hook.unmount();
  mounted.pop();
  expect(await pending).toBe(false);
});

it("cancels an awaiting overwrite confirmation when a delete confirmation replaces it", async () => {
  const hook = await mount(useConfirmDialog);
  const onConfirm = vi.fn();
  let pending;
  await act(() => {
    pending = hook.current.showConfirmDialog({ title: "overwrite" });
  });
  await act(() => hook.current.confirmAction({ title: "delete", onConfirm }));
  expect(await pending).toBe(false);
  await act(() => hook.current.handleConfirmDialogCancel());
  expect(onConfirm).not.toHaveBeenCalled();
});

it("rolls back a failed staged deletion and retains only the failed selection", async () => {
  const selected = [file("a"), file("b")];
  window.terminalAPI.createFolder = vi.fn(async () => ({ success: true }));
  window.terminalAPI.moveFile = vi.fn(async () => ({ success: true }));
  window.terminalAPI.deleteFile = vi.fn(async (_tab, path) =>
    path.endsWith("/b")
      ? { success: false, error: "Permission denied" }
      : { success: true },
  );
  const confirmAction = vi.fn();
  const replaceSelection = vi.fn();
  const refresh = vi.fn();
  const hook = await mount(useFileOps, {
    confirmAction,
    showNotification: notify,
    currentPath: "/work",
    tabId: "delete-session",
    sshConnection: {},
    selectedFile: selected[0],
    getSelectedFiles: () => selected,
    replaceSelection,
    clearSelection: vi.fn(),
    loadDirectory: refresh,
    refreshAfterUserActivity: vi.fn(),
    handleEnterDirectory: vi.fn(),
  });
  await act(() => hook.current.handleDelete());
  await act(() => confirmAction.mock.calls[0][0].onConfirm());
  expect(window.terminalAPI.moveFile).toHaveBeenCalledWith(
    "delete-session",
    expect.stringContaining("/.simpleshell-delete-staging-"),
    "/work/b",
  );
  expect(replaceSelection).toHaveBeenCalledWith([selected[1]]);
  expect(refresh).toHaveBeenCalledWith("/work", 0, true);
  expect(hook.current.isDeleting).toBe(false);
});

it("rejects remote/string drops and only forwards native validated paths", async () => {
  const onDrop = vi.fn();
  window.terminalAPI.getPathForFile = (entry) => entry.nativePath;
  const hook = await mount(useDragDrop, {
    sshConnection: {},
    setNotification: notify,
    handleDroppedItems: onDrop,
  });
  const event = (items, files) => ({
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: { items, files },
  });
  await act(() => hook.current.handleDrop(event([{ kind: "string" }], [])));
  expect(onDrop).not.toHaveBeenCalled();
  const entry = { name: "a.txt", isFile: true };
  await act(() =>
    hook.current.handleDrop(
      event(
        [{ kind: "file", webkitGetAsEntry: () => entry }],
        [{ nativePath: "C:\\local\\a.txt" }],
      ),
    ),
  );
  expect(onDrop).toHaveBeenCalledWith([
    { entry, localPath: "C:\\local\\a.txt" },
  ]);
});

it("updates progress subscribers without rerendering task commands", async () => {
  let renders = 0;
  const commands = await mount(() => {
    renders += 1;
    return useTransferActions("progress-session");
  });
  const progress = await mount(() => useGlobalTransfers("progress-session"));
  const before = renders;
  let id;
  await act(() => {
    id = commands.current.addTransferProgress({ type: "upload", progress: 0 });
  });
  await act(() =>
    commands.current.updateTransferProgress(id, { progress: 50 }),
  );
  expect(commands.current.getTransferList()[0].progress).toBe(50);
  expect(progress.current.transferList[0].progress).toBe(50);
  expect(renders).toBe(before);
  await act(() => commands.current.clearAllTransfers());
});

it("records a transfer before opening upload IPC and keeps cancellation local to the task", async () => {
  let tasks;
  window.terminalAPI.uploadFile = vi.fn(async () => {
    expect(tasks.current.getTransferList()).toHaveLength(1);
    return { cancelled: true };
  });
  tasks = await mount(useTransferTasks, {
    tabId: "upload-session",
    sshConnection: {},
    currentPath: "/",
    selectedFile: null,
    getSelectedFiles: () => [],
    showNotification: notify,
    setNotification: notify,
    loadDirectory: vi.fn(),
    refreshAfterUserActivity: vi.fn(),
    showConfirmDialog: vi.fn(),
  });
  await act(() => tasks.current.handleUploadFile());
  expect(window.terminalAPI.uploadFile).toHaveBeenCalledOnce();
  expect(tasks.current.getTransferList()[0].isCancelled).toBe(true);
  window.terminalAPI.uploadFile.mockResolvedValueOnce({
    success: false,
    error: "Permission denied",
  });
  await act(() => tasks.current.handleUploadFile());
  const transfers = tasks.current.getTransferList();
  expect(transfers[0].isCancelled).toBe(true);
  expect(transfers[1].error).toBe("Permission denied");
  expect(transfers[1].isCancelled).not.toBe(true);
});

it.each([
  ["create file", CreateFileDialog, { showCreateFileDialog: false }],
  ["create folder", CreateFolderDialog, { showCreateFolderDialog: false }],
  ["rename", RenameDialog, { showRenameDialog: false }],
  ["permissions", PermissionDialog, { showPermissionDialog: false }],
  ["properties", PropertiesDialog, { showPropertiesDialog: false }],
  ["preview", PreviewDialog, { showPreview: false }],
  [
    "preview without a file",
    PreviewDialog,
    { showPreview: true, filePreview: null },
  ],
])(
  "renders no dialog or placeholder text for inactive %s",
  (_name, Component, props) => {
    expect(renderToStaticMarkup(createElement(Component, props))).toBe("");
  },
);

it("mounts the real FileManager and shows its drop overlay only during a drag", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        createElement(FileManager, {
          open: false,
          tabId: "smoke",
          sshConnection: null,
        }),
      ),
    );
    expect(host.querySelector("input")).not.toBeNull();
    expect(host.textContent).not.toContain("&&");
    expect(host.textContent).not.toContain(
      "fileManager.messages.dragDropMessage",
    );
    await act(() =>
      root.render(
        createElement(FileManager, {
          open: true,
          tabId: "smoke",
          sshConnection: null,
        }),
      ),
    );
    expect(notify).toHaveBeenCalled();

    const enter = new Event("dragenter", { bubbles: true, cancelable: true });
    Object.defineProperty(enter, "dataTransfer", {
      value: { items: [{ kind: "file" }] },
    });
    await act(() => host.querySelector("input").dispatchEvent(enter));
    expect(host.textContent).toContain("fileManager.messages.dragDropMessage");

    await act(() =>
      host
        .querySelector("input")
        .dispatchEvent(
          new Event("dragleave", { bubbles: true, cancelable: true }),
        ),
    );
    expect(host.textContent).not.toContain(
      "fileManager.messages.dragDropMessage",
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
