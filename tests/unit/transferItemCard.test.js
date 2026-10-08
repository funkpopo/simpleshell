// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import TransferItemCard from "../../src/renderer/features/transfers/components/TransferItemCard.jsx";

const { t } = vi.hoisted(() => ({
  t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

let root;
let host;

const baseTransfer = {
  tabId: "tab-1",
  transferId: "t-1",
  transferKey: "key-1",
  type: "upload",
  fileName: "app.log",
  progress: 40,
  transferredBytes: 400,
  totalBytes: 1000,
  transferSpeed: 128,
  remainingTime: 6,
  totalFiles: 1,
  startTime: 1700000000000,
};

const render = async (props) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(TransferItemCard, props));
  });
};

const byLabel = (label) =>
  document.querySelector(`button[aria-label="${label}"]`);

const click = async (node) => {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

beforeEach(() => {
  root = null;
  host = null;
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  host?.remove();
  document.body.innerHTML = "";
});

it("float 变体：渲染文件名、百分比 Chip，终止按钮回调携带完整 transfer", async () => {
  const onCancel = vi.fn();
  await render({
    variant: "float",
    transfer: { ...baseTransfer },
    onCancel,
  });

  expect(document.body.textContent).toContain("app.log");
  expect(document.body.textContent).toContain("40%");
  // 活跃任务：显示终止（stop）按钮，不显示删除
  const stopButton = byLabel("fileManager.transfer.stop");
  expect(stopButton).toBeTruthy();
  expect(byLabel("fileManager.transfer.delete")).toBeNull();

  await click(stopButton);
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCancel.mock.calls[0][0]).toMatchObject({
    tabId: "tab-1",
    transferId: "t-1",
  });
});

it("float 变体：失败任务显示删除按钮而非终止按钮", async () => {
  const onDelete = vi.fn();
  await render({
    variant: "float",
    transfer: { ...baseTransfer, error: "boom", progress: 40 },
    onDelete,
  });

  const deleteButton = byLabel("fileManager.transfer.delete");
  expect(deleteButton).toBeTruthy();
  expect(byLabel("fileManager.transfer.stop")).toBeNull();

  await click(deleteButton);
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onDelete.mock.calls[0][0]).toMatchObject({ transferId: "t-1" });
});

it("sidebar 变体：活跃任务显示进度条/暂停按钮/校验菜单，暂停回调携带 transfer", async () => {
  const onCancel = vi.fn();
  const onVerify = vi.fn();
  await render({
    variant: "sidebar",
    transfer: { ...baseTransfer },
    isActive: true,
    onCancel,
    onVerify,
  });

  // 活跃任务有暂停按钮与校验菜单入口
  const pauseButton = byLabel("fileManager.transfer.pause");
  expect(pauseButton).toBeTruthy();
  expect(byLabel("fileManager.transfer.taskOptions")).toBeTruthy();
  // 内联百分比（进度条右侧）
  expect(document.body.textContent).toContain("40%");

  await click(pauseButton);
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCancel.mock.calls[0][0]).toMatchObject({ transferId: "t-1" });
});

it("sidebar 变体：历史任务不显示进度与暂停，显示删除历史按钮", async () => {
  const onDelete = vi.fn();
  await render({
    variant: "sidebar",
    transfer: { ...baseTransfer, progress: 100 },
    isActive: false,
    onDelete,
  });

  expect(byLabel("fileManager.transfer.pause")).toBeNull();
  expect(byLabel("fileManager.transfer.taskOptions")).toBeNull();
  const deleteButton = byLabel("fileManager.transfer.deleteRecord");
  expect(deleteButton).toBeTruthy();

  await click(deleteButton);
  expect(onDelete).toHaveBeenCalledTimes(1);
});

it("sidebar 变体：错误任务渲染错误 Alert", async () => {
  await render({
    variant: "sidebar",
    transfer: { ...baseTransfer, error: "disk full" },
    isActive: false,
  });

  expect(document.body.textContent).toContain("disk full");
  expect(document.querySelector(".MuiAlert-root")).toBeTruthy();
});

it("sidebar 变体：多文件任务可展开文件列表", async () => {
  await render({
    variant: "sidebar",
    transfer: {
      ...baseTransfer,
      totalFiles: 2,
      fileList: [
        { index: 0, name: "a.txt", size: 100, completed: true },
        { index: 1, name: "b.txt", size: 200, completed: false },
      ],
    },
    isActive: true,
    onCancel: vi.fn(),
  });

  const expandButton = byLabel("fileManager.transfer.viewDetails");
  expect(expandButton).toBeTruthy();
  // Collapse unmountOnExit：展开前文件项不在 DOM 中
  expect(document.body.textContent).not.toContain("a.txt");

  await click(expandButton);
  expect(document.body.textContent).toContain("a.txt");
  expect(document.body.textContent).toContain("b.txt");
  expect(byLabel("fileManager.transfer.collapseDetails")).toBeTruthy();
});
