// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import FilePreview from "../../src/renderer/features/file-manager/FilePreview.jsx";
import useBinaryPreview from "../../src/renderer/features/file-manager/hooks/useBinaryPreview.js";
import { deferred, renderHook } from "../helpers/reactHarness.js";

const { translate, notification, pdfLoaded } = vi.hoisted(() => ({
  translate: (key) => key,
  notification: vi.fn(),
  pdfLoaded: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../src/renderer/i18n/i18n", () => ({
  default: { t: (key) => key },
}));
vi.mock("../../src/renderer/shared/notifications/NotificationContext", () => ({
  useNotification: () => ({ showNotification: notification }),
}));
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange, readOnly, editable }) =>
    createElement("textarea", {
      "aria-label": "preview-text",
      value,
      readOnly: readOnly || editable === false,
      onChange: (event) => onChange?.(event.target.value),
    }),
}));
vi.mock("react-pdf", () => {
  pdfLoaded();
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ children, onLoadSuccess }) => {
      useEffect(() => {
        onLoadSuccess({ numPages: 3 });
      }, []);
      return createElement("div", null, children);
    },
    Page: ({ pageNumber, scale }) =>
      createElement("div", {
        "data-pdf-page": pageNumber,
        "data-pdf-scale": scale,
      }),
  };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs", () => ({
  default: "pdf.worker.min.mjs",
}));

let root, host;
const props = {
  open: true,
  path: "/data",
  tabId: "ssh-a",
  file: { name: "notes.txt", size: 4 },
};
async function render(nextProps) {
  if (!root) {
    host = document.createElement("div");
    host.tabIndex = -1;
    document.body.appendChild(host);
    root = createRoot(host);
    host.focus();
  }
  await act(async () => root.render(createElement(FilePreview, nextProps)));
}
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    if (predicate()) return;
  }
  expect(predicate()).toBeTruthy();
}
const button = (text) =>
  [...document.querySelectorAll("button")].find(
    (element) => element.textContent === text,
  );
async function click(text) {
  expect(button(text), text).toBeTruthy();
  await act(async () => button(text).click());
}
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {
    readFileContent: vi.fn(async () => ({ success: true, content: "old\n" })),
    readFileAsBase64: vi.fn(async () => ({
      success: true,
      content: "YWJj",
      cacheFilePath: "cached-file",
    })),
    releaseRuntimeFilePath: vi.fn(async () => ({ success: true })),
    listFileSnapshots: vi.fn(async () => ({ success: true, snapshots: [] })),
    createFileSnapshot: vi.fn(async () => ({ success: true })),
    saveFileContent: vi.fn(async () => ({ success: true })),
    loadUISettings: vi.fn(async () => ({ editorFont: "consolas" })),
  };
});
afterEach(async () => {
  if (root) await act(() => root.unmount());
  host?.remove();
  root = null;
});

it("loads text and images without initializing PDF and releases the image cache on close", async () => {
  await render(props);
  await until(() =>
    document.querySelector('textarea[aria-label="preview-text"]'),
  );
  expect(pdfLoaded).not.toHaveBeenCalled();
  const onClose = vi.fn();
  await render({ ...props, onClose, file: { name: "image.png", size: 3 } });
  await until(() => document.querySelector('img[alt="image.png"]'));
  expect(pdfLoaded).not.toHaveBeenCalled();
  expect(window.terminalAPI.readFileAsBase64).toHaveBeenCalledWith(
    "ssh-a",
    "/data/image.png",
  );
  await click("common.close");
  expect(onClose).toHaveBeenCalledOnce();
  await act(() => root.unmount());
  root = null;
  expect(
    window.terminalAPI.releaseRuntimeFilePath,
  ).toHaveBeenCalledExactlyOnceWith("file-cache", "cached-file", {
    reason: "file-preview-close",
  });
});

it("confirms unsaved edits, saves the file and records the replaced baseline", async () => {
  const onClose = vi.fn();
  await render({ ...props, onClose });
  await until(() =>
    document.querySelector('textarea[aria-label="preview-text"]'),
  );
  await click("filePreview.editMode");
  const editor = document.querySelector('textarea[aria-label="preview-text"]');
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(editor, "new\n");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("common.close");
  expect(onClose).not.toHaveBeenCalled();
  await click("filePreview.saveAndClose");
  expect(window.terminalAPI.saveFileContent).toHaveBeenCalledExactlyOnceWith(
    "ssh-a",
    "/data/notes.txt",
    "new\n",
  );
  expect(window.terminalAPI.createFileSnapshot).toHaveBeenCalledWith(
    "ssh-a",
    "/data/notes.txt",
    "old\n",
    expect.objectContaining({ type: "initial" }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("does not close a modified preview when saving fails", async () => {
  const onClose = vi.fn();
  window.terminalAPI.saveFileContent.mockResolvedValue({
    success: false,
    error: "denied",
  });
  await render({ ...props, onClose });
  await until(() =>
    document.querySelector('textarea[aria-label="preview-text"]'),
  );
  await click("filePreview.editMode");
  const editor = document.querySelector('textarea[aria-label="preview-text"]');
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(editor, "changed");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("common.close");
  await click("filePreview.saveAndClose");
  expect(onClose).not.toHaveBeenCalled();
  expect(window.terminalAPI.createFileSnapshot).not.toHaveBeenCalled();
  expect(button("filePreview.saveAndClose")).toBeTruthy();
});

it("releases a cache returned after the binary preview has unmounted", async () => {
  const pending = deferred();
  window.terminalAPI.readFileAsBase64.mockReturnValue(pending.promise);
  const hook = await renderHook(useBinaryPreview, {
    file: props.file,
    tabId: props.tabId,
    fullPath: "/data/late.png",
  });
  await hook.unmount();
  await act(async () =>
    pending.resolve({
      success: true,
      content: "YWJj",
      cacheFilePath: "late-cache",
    }),
  );
  expect(
    window.terminalAPI.releaseRuntimeFilePath,
  ).toHaveBeenCalledExactlyOnceWith(
    "file-cache",
    "late-cache",
    expect.any(Object),
  );
});

it("compares a saved version and restores it into the same text session", async () => {
  const snapshot = {
    id: "saved",
    label: "Saved version",
    createdAt: "2026-01-01T00:00:00Z",
    size: 7,
  };
  window.terminalAPI.listFileSnapshots.mockResolvedValue({
    success: true,
    snapshots: [snapshot],
  });
  window.terminalAPI.getFileSnapshot = vi.fn(async () => ({
    success: true,
    snapshot: { content: "before\n" },
  }));
  window.terminalAPI.restoreFileSnapshot = vi.fn(async () => ({
    success: true,
    content: "before\n",
    snapshots: [],
  }));
  await render({ ...props, onClose: vi.fn() });
  await until(() =>
    [...document.querySelectorAll('[role="button"]')].some((element) =>
      element.textContent.includes("Saved version"),
    ),
  );
  const row = [...document.querySelectorAll('[role="button"]')].find(
    (element) => element.textContent.includes("Saved version"),
  );
  await act(() => row.click());
  await until(
    () =>
      document.querySelectorAll('textarea[aria-label="preview-text"]')
        .length === 2,
  );
  expect(
    [...document.querySelectorAll('textarea[aria-label="preview-text"]')].map(
      (element) => element.value,
    ),
  ).toEqual(["before\n", "old\n"]);
  await click("filePreview.restoreVersion");
  expect(
    window.terminalAPI.restoreFileSnapshot,
  ).toHaveBeenCalledExactlyOnceWith(
    "ssh-a",
    "/data/notes.txt",
    "saved",
    "old\n",
  );
  expect(
    document.querySelector('textarea[aria-label="preview-text"]').value,
  ).toBe("before\n");
});

it("initializes PDF only for a PDF and keeps page and zoom controls in its owner", async () => {
  await render({ ...props, file: { name: "manual.pdf", size: 3 } });
  await until(() => document.querySelector('[data-pdf-page="1"]'));
  expect(pdfLoaded).toHaveBeenCalledOnce();
  await act(() =>
    document.querySelector('button[aria-label="filePreview.nextPage"]').click(),
  );
  await act(() =>
    document.querySelector('button[aria-label="filePreview.zoomIn"]').click(),
  );
  expect(
    document
      .querySelector('[data-pdf-page="2"]')
      .getAttribute("data-pdf-scale"),
  ).toBe("1.2");
});
