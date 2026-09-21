// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { deferred, renderHook } from "../helpers/reactHarness.js";
import useFileNav from "../../src/renderer/features/file-manager/hooks/useFileNav.js";
import useFileSelection from "../../src/renderer/features/file-manager/hooks/useFileSelection.js";
import useConfirmDialog from "../../src/renderer/features/file-manager/hooks/useConfirmDialog.js";
import useDragDrop from "../../src/renderer/features/file-manager/hooks/useDragDrop.js";
import useTransferTasks from "../../src/renderer/features/file-manager/hooks/useTransferTasks.js";
import useFileOps from "../../src/renderer/features/file-manager/hooks/useFileOps.js";
import useTransferHosts from "../../src/renderer/features/file-manager/hooks/useTransferHosts.js";
import useFileKeyboard from "../../src/renderer/features/file-manager/hooks/useFileKeyboard.js";
import FileManager from "../../src/renderer/features/file-manager/index.jsx";
import CreateFileDialog from "../../src/renderer/features/file-manager/dialogs/CreateFileDialog.jsx";
import CreateFolderDialog from "../../src/renderer/features/file-manager/dialogs/CreateFolderDialog.jsx";
import RenameDialog from "../../src/renderer/features/file-manager/dialogs/RenameDialog.jsx";
import PermissionDialog from "../../src/renderer/features/file-manager/dialogs/PermissionDialog.jsx";
import PropertiesDialog from "../../src/renderer/features/file-manager/dialogs/PropertiesDialog.jsx";
import PreviewDialog from "../../src/renderer/features/file-manager/dialogs/PreviewDialog.jsx";
import {
  useGlobalTransfers,
  useTransferActions,
} from "../../src/renderer/features/transfers/state/globalTransferStore.js";

const { translate, notify } = vi.hoisted(() => ({
  translate: (key) => key,
  notify: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en" } }),
}));
vi.mock("../../src/renderer/shared/notifications/NotificationContext", () => ({
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
const operationProps = () => ({
  tabId: "operation-session",
  currentPath: "/work",
  selectedFile: file("original.txt"),
  sshConnection: {},
  refreshDirectory: vi.fn(),
  refreshAfterUserActivity: vi.fn(),
  handleEnterDirectory: vi.fn(),
  showNotification: notify,
  confirmAction: vi.fn(),
  getSelectedFiles: () => [],
  replaceSelection: vi.fn(),
  clearSelection: vi.fn(),
});

describe("file operation targets", () => {
  it.each([
    ["rename", "handleRename", "renameFile"],
    ["createFile", "handleCreateFile", "createFile"],
    ["createFolder", "handleCreateFolder", "createFolder"],
  ])(
    "keeps the %s target when navigation and selection change",
    async (dialog, command, api) => {
      const pending = deferred();
      window.terminalAPI[api] = vi.fn(() => pending.promise);
      const props = operationProps();
      const hook = await mount(useFileOps, props);
      await act(() => hook.current[command]());
      await act(() => hook.current.dialogs[dialog].setName("new.txt"));
      await hook.rerender({
        ...props,
        currentPath: "/elsewhere",
        selectedFile: file("other.txt"),
      });
      let request;
      await act(() => {
        request = hook.current.dialogs[dialog].submit();
        void hook.current.dialogs[dialog].submit();
      });
      expect(window.terminalAPI[api]).toHaveBeenCalledOnce();
      expect(window.terminalAPI[api].mock.calls[0]).toEqual(
        dialog === "rename"
          ? [props.tabId, "/work/original.txt", "new.txt"]
          : [props.tabId, "/work/new.txt"],
      );
      await act(async () => {
        pending.resolve({ success: true });
        await request;
      });
      expect(props.refreshDirectory).toHaveBeenCalledWith("/work");
      expect(hook.current.dialogs[dialog].open).toBe(false);
    },
  );

  it("does not let an old name submission close a new session's dialog", async () => {
    const pending = deferred();
    window.terminalAPI.createFile = vi.fn(() => pending.promise);
    const props = operationProps();
    const hook = await mount(useFileOps, props);
    await act(() => hook.current.handleCreateFile());
    await act(() => hook.current.dialogs.createFile.setName("old.txt"));
    let request;
    await act(() => {
      request = hook.current.dialogs.createFile.submit();
    });
    await hook.rerender({ ...props, tabId: "new-session" });
    await act(() => hook.current.handleCreateFile());
    await act(() => hook.current.dialogs.createFile.setName("new.txt"));
    await act(async () => {
      pending.resolve({ success: true });
      await request;
    });
    expect(hook.current.dialogs.createFile.open).toBe(true);
    expect(hook.current.dialogs.createFile.name).toBe("new.txt");
  });

  it("keeps permission edits bound to their original file", async () => {
    window.terminalAPI.getFilePermissions = vi.fn(async () => ({
      success: true,
      permissions: "644",
    }));
    window.terminalAPI.setFilePermissions = vi.fn(async () => ({
      success: true,
    }));
    const props = operationProps();
    const hook = await mount(useFileOps, props);
    await act(() => hook.current.handleOpenPermissions());
    await act(() =>
      hook.current.dialogs.permissions.setPermDialogPermissions("600"),
    );
    await hook.rerender({
      ...props,
      currentPath: "/elsewhere",
      selectedFile: null,
    });
    await act(() =>
      hook.current.dialogs.permissions.handlePermissionDialogSubmit(),
    );
    expect(window.terminalAPI.setFilePermissions).toHaveBeenCalledWith(
      props.tabId,
      "/work/original.txt",
      "600",
    );
    expect(props.refreshDirectory).toHaveBeenCalledWith("/work");
  });

  it("ignores properties responses from a closed or replaced dialog", async () => {
    const old = deferred();
    const next = deferred();
    window.terminalAPI.getAbsolutePath = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const props = operationProps();
    const hook = await mount(useFileOps, props);
    let first;
    let second;
    await act(() => {
      first = hook.current.handleOpenProperties();
    });
    await act(() =>
      hook.current.dialogs.properties.handleClosePropertiesDialog(),
    );
    await hook.rerender({ ...props, selectedFile: file("next.txt") });
    await act(() => {
      second = hook.current.handleOpenProperties();
    });
    await act(async () => {
      old.resolve({ success: true, path: "/stale" });
      await first;
    });
    expect(hook.current.dialogs.properties.propertiesData.path).toBe(
      "/work/next.txt",
    );
    expect(hook.current.dialogs.properties.propertiesLoading).toBe(true);
    await act(async () => {
      next.resolve({ success: true, path: "/resolved/next.txt" });
      await second;
    });
    expect(hook.current.dialogs.properties.propertiesData.path).toBe(
      "/resolved/next.txt",
    );
  });

  it("keeps an open preview bound to the original directory", async () => {
    const props = operationProps();
    const hook = await mount(useFileOps, props);
    await act(() => hook.current.handleFileActivate(props.selectedFile));
    await hook.rerender({ ...props, currentPath: "/elsewhere" });
    expect(hook.current.dialogs.preview.currentPath).toBe("/work");
    expect(hook.current.dialogs.preview.filePreview).toEqual(
      props.selectedFile,
    );
  });

  it("does not open a stale permission dialog after switching sessions", async () => {
    const permissions = deferred();
    window.terminalAPI.getFilePermissions = () => permissions.promise;
    const props = operationProps();
    const hook = await mount(useFileOps, props);
    let request;
    await act(() => {
      request = hook.current.handleOpenPermissions();
    });
    await hook.rerender({ ...props, tabId: "next-session" });
    await act(async () => {
      permissions.resolve({ success: true, permissions: "777" });
      await request;
    });
    expect(hook.current.dialogs.permissions.showPermissionDialog).toBe(false);
  });

  it("does not restore a deleted directory's selection after navigation", async () => {
    const moved = deferred();
    const selected = file("a");
    window.terminalAPI.createFolder = vi.fn(async () => ({ success: true }));
    window.terminalAPI.moveFile = vi
      .fn()
      .mockReturnValueOnce(moved.promise)
      .mockResolvedValue({ success: true });
    window.terminalAPI.deleteFile = vi.fn(async (_tab, path) =>
      path.endsWith("/a")
        ? { success: false, error: "Permission denied" }
        : { success: true },
    );
    const props = { ...operationProps(), getSelectedFiles: () => [selected] };
    const hook = await mount(useFileOps, props);
    await act(() => hook.current.handleDelete());
    let request;
    await act(() => {
      request = props.confirmAction.mock.calls[0][0].onConfirm();
    });
    await hook.rerender({ ...props, currentPath: "/next" });
    await act(async () => {
      moved.resolve({ success: true });
      await request;
    });
    expect(props.replaceSelection).not.toHaveBeenCalled();
    expect(props.clearSelection).not.toHaveBeenCalled();
    expect(props.refreshDirectory).toHaveBeenCalledWith("/work");
  });

  it("uses the latest external editor setting if startup settings arrive late", async () => {
    const settings = deferred();
    window.terminalAPI.loadUISettings = () => settings.promise;
    window.terminalAPI.openFileInExternalEditor = vi.fn(async () => ({
      success: true,
    }));
    const props = operationProps();
    const hook = await mount(useFileOps, props);
    await act(() =>
      window.dispatchEvent(
        new CustomEvent("settingsChanged", {
          detail: { externalEditor: { enabled: true } },
        }),
      ),
    );
    await act(async () => {
      settings.resolve({ externalEditor: { enabled: false } });
      await settings.promise;
    });
    await act(() => hook.current.handleFileActivate(props.selectedFile));
    expect(window.terminalAPI.openFileInExternalEditor).toHaveBeenCalledWith(
      props.tabId,
      "/work/original.txt",
    );
    expect(hook.current.showPreview).toBe(false);
  });
});

it("clears drag feedback on close and excludes text drags", async () => {
  const props = {
    open: true,
    sshConnection: {},
    setNotification: notify,
    handleDroppedItems: vi.fn(),
  };
  const hook = await mount(useDragDrop, props);
  const event = (kind) => ({
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: { items: [{ kind }] },
  });
  await act(() => hook.current.handleDragEnter(event("string")));
  expect(hook.current.isDragging).toBe(false);
  await act(() => hook.current.handleDragEnter(event("file")));
  expect(hook.current.isDragging).toBe(true);
  await hook.rerender({ ...props, open: false });
  expect(hook.current.isDragging).toBe(false);
});

it("does not navigate on upload completion, and invalidates the uploaded directory's cache", async () => {
  const upload = deferred();
  window.terminalAPI.uploadFile = () => upload.promise;
  window.terminalAPI.listFiles = vi.fn(async (_tab, path) => ({
    success: true,
    data: [file(path)],
  }));
  const props = { ...navProps(), open: true };
  const hook = await mount((navOptions) => {
    const nav = useFileNav(navOptions);
    const transfers = useTransferTasks({
      ...navOptions,
      currentPath: nav.currentPath,
      refreshDirectory: nav.refreshDirectory,
      selectedFile: null,
      getSelectedFiles: () => [],
    });
    return { nav, transfers };
  }, props);
  let pendingUpload;
  await act(() => {
    pendingUpload = hook.current.transfers.handleUploadFile();
  });
  await act(() => hook.current.nav.loadDirectory("/next"));
  const reads = window.terminalAPI.listFiles.mock.calls.length;
  await act(async () => {
    upload.resolve({ success: true });
    await pendingUpload;
  });
  expect(hook.current.nav.currentPath).toBe("/next");
  expect(window.terminalAPI.listFiles).toHaveBeenCalledTimes(reads);
  await act(() => hook.current.nav.loadDirectory("/"));
  expect(window.terminalAPI.listFiles).toHaveBeenCalledTimes(reads + 1);
});

it("does not supersede pending navigation with a mutation refresh or use an old session's refresh command", async () => {
  const pending = deferred();
  window.terminalAPI.listFiles = vi
    .fn()
    .mockResolvedValueOnce({ success: true, data: [] })
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ success: true, data: [] });
  const props = { ...navProps(), open: true };
  const hook = await mount(useFileNav, props);
  const refresh = hook.current.refreshDirectory;
  let navigation;
  await act(() => {
    navigation = hook.current.loadDirectory("/next");
  });
  await act(() => refresh("/"));
  expect(window.terminalAPI.listFiles).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending.resolve({ success: true, data: [] });
    await navigation;
  });
  expect(hook.current.currentPath).toBe("/next");
  await hook.rerender({ ...props, tabId: "new-session" });
  const reads = window.terminalAPI.listFiles.mock.calls.length;
  await act(() => refresh("/"));
  expect(window.terminalAPI.listFiles).toHaveBeenCalledTimes(reads);
  await hook.unmount();
  mounted.pop();
  await act(() => hook.current.refreshDirectory("/"));
  expect(window.terminalAPI.listFiles).toHaveBeenCalledTimes(reads);
});

it("loads transfer hosts only when sessions change and ignores removed sessions' late replies", async () => {
  const old = deferred();
  window.terminalAPI.getSSHConfig = vi.fn((id) =>
    id === "old" ? old.promise : Promise.resolve({ host: id }),
  );
  const hook = await mount(useTransferHosts, [{ tabId: "old", progress: 0 }]);
  await hook.rerender([
    { tabId: "old", progress: 50 },
    { tabId: "new", progress: 0 },
  ]);
  await hook.rerender([{ tabId: "new", progress: 100 }]);
  expect(hook.current).toEqual({ new: "new" });
  await act(async () => {
    old.resolve({ host: "old" });
    await old.promise;
  });
  expect(hook.current).toEqual({ new: "new" });
  expect(window.terminalAPI.getSSHConfig.mock.calls).toEqual([
    ["old"],
    ["new"],
  ]);
});

it("routes file shortcuts only from the file manager, excluding editors and dialog portals", async () => {
  const root = document.createElement("div");
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  editor.setAttribute("contenteditable", "true");
  root.appendChild(editor);
  document.body.appendChild(root);
  const handleDelete = vi.fn();
  const hook = await mount(useFileKeyboard, {
    rootRef: { current: root },
    open: true,
    getSelectedFiles: () => [file("a")],
    handleDelete,
  });
  try {
    for (const target of [document.body, editor, root]) {
      await act(() =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
        ),
      );
    }
    expect(handleDelete).toHaveBeenCalledOnce();
    await hook.rerender({ rootRef: { current: root }, open: false });
    await act(() =>
      root.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      ),
    );
    expect(handleDelete).toHaveBeenCalledOnce();
  } finally {
    root.remove();
  }
});

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
    refreshDirectory: refresh,
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
  expect(refresh).toHaveBeenCalledWith("/work");
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
    refreshDirectory: vi.fn(),
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
