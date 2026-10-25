// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  SIDEBAR_LIST_SKELETONS,
  SidebarLazySkeleton,
  SidebarListSkeleton,
} from "../../src/renderer/shared/ui/SkeletonLoader.jsx";
import WindowedSidebarList from "../../src/renderer/shared/ui/WindowedSidebarList.jsx";
import CommandHistory from "../../src/renderer/features/terminal/CommandHistory.jsx";
import SidebarSearchField from "../../src/renderer/shared/ui/SidebarSearchField.jsx";
import ShortcutCommands from "../../src/renderer/features/terminal/ShortcutCommands.jsx";
import LocalTerminalSidebar from "../../src/renderer/features/terminal/LocalTerminalSidebar.jsx";
import FileList from "../../src/renderer/features/file-manager/panels/FileList.jsx";
import VirtualizedConnectionList from "../../src/renderer/features/connections/VirtualizedConnectionList.jsx";

const { t, notification } = vi.hoisted(() => ({
  t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  // 与真实 NotificationProvider 一致：回调引用稳定
  notification: { showNotification: () => {} },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));
vi.mock(
  "../../src/renderer/shared/notifications/NotificationContext.jsx",
  () => ({ useNotification: () => notification }),
);

let root = null;
let host = null;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // react-window 依赖 ResizeObserver；jsdom 未实现，提供空实现即可完成挂载
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const flush = () => act(async () => {});

const render = async (element) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return host;
};

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  delete window.terminalAPI;
});

it("renders deterministic list skeletons sized by their preset", async () => {
  const first = await render(
    createElement(SidebarListSkeleton, { variant: "history" }),
  );
  const status = first.querySelector('[role="status"]');
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(status.children).toHaveLength(SIDEBAR_LIST_SKELETONS.history.rows);
  const firstMarkup = first.innerHTML;

  await act(async () => root.unmount());
  host.remove();
  const second = await render(
    createElement(SidebarListSkeleton, { variant: "history" }),
  );
  // 宽度按行序轮换而非随机：重渲染不会让占位条跳动
  expect(second.innerHTML).toBe(firstMarkup);
});

it("renders a lazy fallback for every sidebar variant", async () => {
  const variants = [
    "connection",
    "history",
    "shortcut",
    "localTerminal",
    "file",
    "resource",
    "ipAddress",
    "security",
    "forwarding",
  ];
  for (const variant of variants) {
    const container = await render(
      createElement(SidebarLazySkeleton, { open: true, variant }),
    );
    expect(
      container.querySelector('[aria-busy="true"]'),
      `${variant} fallback must expose a busy state`,
    ).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
    root = null;
    host = null;
  }
});

it("renders short sidebar lists inline without windowing", async () => {
  const items = ["a", "b", "c"];
  const container = await render(
    createElement(WindowedSidebarList, {
      items,
      rowHeight: 52,
      getItemKey: (item) => item,
      renderItem: (item) => createElement("div", { "data-row": item }, item),
    }),
  );
  expect(container.querySelectorAll("[data-row]")).toHaveLength(3);
  expect(container.querySelector('[role="listitem"]')).toBeNull();
});

it("renders the shared sidebar search adornments", async () => {
  const container = await render(
    createElement(SidebarSearchField, {
      value: "",
      onChange: () => {},
      placeholder: "search",
    }),
  );
  expect(container.querySelector('[data-testid="SearchIcon"]')).not.toBeNull();
  expect(container.textContent).toContain("Ctrl+/");
  expect(container.querySelector("[inputprops]")).toBeNull();
});

it("toggles a command history selection checkbox exactly once per click", async () => {
  window.terminalAPI = {
    getAllCommandHistory: async () => ({
      success: true,
      data: [
        { command: "ls -la", timestamp: 1 },
        { command: "git status", timestamp: 2 },
      ],
    }),
  };
  const container = await render(
    createElement(CommandHistory, {
      open: true,
      onClose: () => {},
      onSendCommand: () => ({ success: true }),
    }),
  );

  const selectModeButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent.includes("commandHistory.selectMode"),
  );
  await act(async () => {
    selectModeButton.click();
  });

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox.checked).toBe(false);
  await act(async () => {
    checkbox.click();
  });
  // 复选框点击不能再冒泡到行按钮触发第二次切换（否则选中状态会被抵消）
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(container.textContent).toContain("commandHistory.deleteSelected");
});

it("renders shortcut commands with the shared row and empty states", async () => {
  window.terminalAPI = {
    getShortcutCommands: async () => ({
      success: true,
      data: {
        commands: [{ id: "pwd", name: "Print path", command: "pwd" }],
        categories: [],
      },
    }),
  };
  const container = await render(
    createElement(ShortcutCommands, {
      open: true,
      onClose: () => {},
      onSendCommand: () => ({ success: true }),
    }),
  );
  await flush();
  expect(container.textContent).toContain("Print path");
  expect(
    container.querySelector(
      'button[aria-label="shortcutCommands.sendAndExecute"]',
    ),
  ).not.toBeNull();
  expect(container.textContent).toContain("shortcutCommands.totalCommands");
});

it("keeps the local terminal search visible and lists detected terminals", async () => {
  window.terminalAPI = {
    detectLocalTerminals: async () => [
      { id: "pwsh", type: "powershell", name: "PowerShell" },
      { id: "cmd", type: "cmd", name: "Command Prompt" },
    ],
  };
  const container = await render(
    createElement(LocalTerminalSidebar, {
      open: true,
      onClose: () => {},
      onLaunchTerminal: async () => {},
    }),
  );
  await flush();
  expect(container.querySelector("input")).not.toBeNull();
  expect(container.textContent).toContain("PowerShell");
  expect(container.textContent).toContain("Command Prompt");
  expect(container.textContent).toContain(
    "localTerminal.availableTerminals (2)",
  );
});

const makeFiles = (count) =>
  Array.from({ length: count }, (_, index) => ({
    name: `file-${index}.txt`,
    modifyTime: 1700000000000 + index,
    size: 1024,
    isDirectory: index % 5 === 0,
  }));

const fileListProps = (files, selectedName) => ({
  displayFiles: files,
  loading: false,
  error: null,
  searchTerm: "",
  isChunking: false,
  listToken: null,
  handleBlankContextMenu: () => {},
  handleBlankClick: () => {},
  isFileSelected: (file) => file.name === selectedName,
  handleContextMenu: () => {},
  handleFileSelect: () => {},
  handleFileActivate: () => {},
});

it("renders plain and virtualized file lists with the same row component", async () => {
  const container = await render(
    createElement(FileList, fileListProps(makeFiles(3), "file-1.txt")),
  );
  const rows = container.querySelectorAll('[data-file-item="true"]');
  expect(rows).toHaveLength(3);
  expect(rows[1].classList.contains("Mui-selected")).toBe(true);
  await act(async () => root.unmount());
  host.remove();

  const large = await render(
    createElement(FileList, fileListProps(makeFiles(500), "file-0.txt")),
  );
  // 窗口化：远少于 500 行被挂载
  expect(large.querySelectorAll('[data-file-item="true"]').length).toBeLessThan(
    100,
  );
  expect(large.querySelector(".file-manager-virtualized-list")).not.toBeNull();
});

it("renders the virtualized connection list without legacy row markup", async () => {
  const connections = [
    {
      id: "g1",
      type: "group",
      name: "Production",
      expanded: true,
      items: [
        {
          id: "c1",
          type: "connection",
          name: "web-01",
          host: "10.0.0.1",
          username: "root",
          protocol: "ssh",
        },
      ],
    },
  ];
  const container = await render(
    createElement(VirtualizedConnectionList, {
      connections,
      onToggleGroup: () => {},
      onSelectConnection: () => {},
    }),
  );
  expect(container.querySelector(".react-window-list")).not.toBeNull();
  // 旧版虚拟化行使用硬编码英文 “N connections”，现与可拖拽列表共用行组件
  expect(container.textContent).not.toMatch(/\d+ connections/);

  await act(async () => root.unmount());
  host.remove();
  const empty = await render(
    createElement(VirtualizedConnectionList, { connections: [] }),
  );
  expect(empty.textContent).toContain("connectionManager.noConnections");
});
