import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { NotificationProvider } from "../../src/contexts/NotificationContext.jsx";
import ResourceMonitor from "../../src/components/ResourceMonitor.jsx";
import FileManager from "../../src/components/FileManager.jsx";
import ShortcutCommands from "../../src/components/ShortcutCommands.jsx";
import AIChatWorkspace from "../../src/components/AIChatWorkspace.jsx";
import AIChatWindow from "../../src/components/AIChatWindow.jsx";
import { runDirectoryFollowChecks } from "./directory-follow-renderer.jsx";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const until = async (predicate, message) => {
  const end = Date.now() + 6000;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(message);
    await delay(20);
  }
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const systemInfo = (name) => ({
  os: { type: "Linux", hostname: name, platform: "linux" },
  cpu: { model: "Test CPU", cores: 2, usage: 10 },
  memory: { total: 1000, used: 100, free: 900, usagePercent: 10 },
  disks: [],
});
const file = (name) => ({
  name,
  isDirectory: false,
  size: 10,
  modifyTime: Date.now(),
  permissions: "-rw-r--r--",
});

export async function runSessionPanelChecks() {
  const previousApi = window.terminalAPI;
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;background:#121212";
  document.body.appendChild(container);
  const root = createRoot(container);
  const theme = createTheme({ palette: { mode: "dark" } });
  const render = (component) =>
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18next}>
          <ThemeProvider theme={theme}>
            <NotificationProvider>
              <div style={{ width: 480, height: 720 }}>{component}</div>
            </NotificationProvider>
          </ThemeProvider>
        </I18nextProvider>,
      ),
    );
  try {
    const aInfo = deferred();
    const monitorTargets = [];
    window.terminalAPI = {
      loadUISettings: async () => ({}),
      getSystemInfo: (id) => {
        monitorTargets.push(id);
        return id === 201
          ? aInfo.promise
          : Promise.resolve(systemInfo("MONITOR-B"));
      },
      getMetricsSample: async () => null,
    };
    render(
      <ResourceMonitor
        open
        sessionKey="A"
        currentTabId={201}
        onClose={() => {}}
      />,
    );
    await until(
      () => monitorTargets.includes(201),
      "monitor A request did not start",
    );
    render(
      <ResourceMonitor
        open
        sessionKey="B"
        currentTabId={202}
        onClose={() => {}}
      />,
    );
    await until(
      () => container.textContent.includes("MONITOR-B"),
      "monitor did not switch to B",
    );
    aInfo.resolve(systemInfo("LATE-MONITOR-A"));
    await delay(60);
    assert(
      !container.textContent.includes("LATE-MONITOR-A"),
      "late monitor response overwrote current session",
    );

    const aFiles = deferred();
    const fileTargets = [];
    window.terminalAPI = {
      loadUISettings: async () => ({}),
      listFiles: (id, path) => {
        fileTargets.push({ id, path });
        return id === "A"
          ? aFiles.promise
          : Promise.resolve({ success: true, data: [file("FILE-B.txt")] });
      },
    };
    const renderFiles = (id) =>
      render(
        <FileManager
          key={id}
          open
          tabId={id}
          tabName={id}
          sshConnection={{ host: `${id}.test`, tabId: id }}
          initialPath={`/${id}`}
          onClose={() => {}}
          onPathChange={() => {}}
          onNavigationStateChange={() => {}}
        />,
      );
    renderFiles("A");
    await until(
      () => fileTargets.some((entry) => entry.id === "A"),
      "file list A did not load",
    );
    renderFiles("B");
    await until(
      () => container.textContent.includes("FILE-B.txt"),
      "file manager did not switch to B",
    );
    aFiles.resolve({ success: true, data: [file("LATE-FILE-A.txt")] });
    await delay(60);
    assert(
      !container.textContent.includes("LATE-FILE-A.txt"),
      "late file list overwrote current session",
    );
    assert(
      fileTargets.some((entry) => entry.id === "B" && entry.path === "/B"),
      "B used the wrong directory cache",
    );

    const directoryFollow = await runDirectoryFollowChecks({
      render,
      container,
      until,
      delay,
      assert,
    });

    window.terminalAPI = {
      getShortcutCommands: async () => ({
        success: true,
        data: {
          commands: [{ id: "pwd", name: "Print path", command: "pwd" }],
          categories: [],
        },
      }),
    };
    const commandTargets = [];
    const renderCommands = (id, success) =>
      render(
        <ShortcutCommands
          open
          onClose={() => {}}
          sessionContext={{ host: `${id}.test`, protocol: "SSH" }}
          onSendCommand={() => {
            commandTargets.push(id);
            return { success, error: "NO-ACTIVE-PROCESS" };
          }}
        />,
      );
    renderCommands("A", true);
    const sendSelector = `button[aria-label="${i18next.t("shortcutCommands.sendAndExecute")}"]`;
    await until(
      () => container.querySelector(sendSelector),
      "quick command did not render",
    );
    renderCommands("B", false);
    container.querySelector(sendSelector).click();
    await until(
      () => document.body.textContent.includes("NO-ACTIVE-PROCESS"),
      "failed quick command reported success",
    );
    assert(
      commandTargets.join() === "B",
      "quick command callback retained old target",
    );
    render(null);

    const requests = [];
    const firstAck = deferred();
    const cancellations = [];
    const listeners = { chunk: new Set(), end: new Set(), error: new Set() };
    const listen = (type) => (callback) => {
      listeners[type].add(callback);
      return () => listeners[type].delete(callback);
    };
    const emit = (type, payload) =>
      listeners[type].forEach((callback) => callback(null, payload));
    const apiConfig = {
      id: "fixture",
      apiUrl: "https://fixture.invalid",
      model: "fixture",
      hasApiKey: true,
      streamEnabled: true,
    };
    window.terminalAPI = {
      loadAISettings: async () => ({
        configs: [apiConfig],
        current: apiConfig,
      }),
      loadMemory: async () => null,
      onAIStreamChunk: listen("chunk"),
      onAIStreamEnd: listen("end"),
      onAIStreamError: listen("error"),
      sendAPIRequest: async (request) => {
        requests.push(request);
        return requests.length === 1 ? firstAck.promise : { success: true };
      },
      cancelAPIRequest: async (id) => {
        cancellations.push(id);
      },
    };
    let sessions = ["A", "B"].map((id) => ({
      sessionKey: id,
      type: "ssh",
      processId: id,
      label: id,
      config: { host: `${id}.test`, username: id },
    }));
    let activeKey = "A";
    const executeTargets = [];
    const renderChat = (id, presetInput = "") => {
      activeKey = id;
      render(
        <AIChatWorkspace
          sessions={sessions}
          activeSessionKey={id}
          windowState="visible"
          chatComponent={AIChatWindow}
          presetInput={presetInput}
          onInputPresetUsed={() => {}}
          onClose={() => {}}
          onMinimize={() => {}}
          onFocus={() => {}}
          onExecuteCommand={(_command, options) => {
            executeTargets.push(options.expectedSessionKey);
            return { success: options.expectedSessionKey === activeKey };
          }}
        />,
      );
    };
    const aiDialog = (id) =>
      document
        .querySelector(`[data-ai-session="${id}"]`)
        ?.closest('[role="dialog"]');
    const sendAI = async (id) => {
      await until(() => {
        const button = aiDialog(id)?.querySelector(
          `button[aria-label="${i18next.t("ai.sendMessage")}"]`,
        );
        return button && !button.disabled;
      }, `AI ${id} did not become ready`);
      aiDialog(id)
        .querySelector(`button[aria-label="${i18next.t("ai.sendMessage")}"]`)
        .click();
    };
    renderChat("A", "QUESTION-A");
    await sendAI("A");
    await until(() => requests.length === 1, "AI A request not sent");
    assert(
      requests[0].messages[0].content.includes("A.test"),
      "AI prompt has wrong host A",
    );
    renderChat("B", "DRAFT-B");
    await until(() => aiDialog("B"), "AI did not switch host indicator to B");
    emit("chunk", {
      sessionId: requests[0].sessionId,
      chunk:
        'ANSWER-A\n<cmd risk="high">rm -rf /tmp/session-panel-fixture</cmd>',
    });
    emit("end", { sessionId: requests[0].sessionId });
    await delay(60);
    assert(
      !aiDialog("B").textContent.includes("ANSWER-A"),
      "A streamed into B conversation",
    );
    assert(
      aiDialog("B").querySelector("textarea").value === "DRAFT-B",
      "B draft was lost",
    );
    renderChat("A");
    await until(
      () => aiDialog("A")?.textContent.includes("ANSWER-A"),
      "A history was not retained",
    );
    const executionSelector = `button[aria-label="${i18next.t("ai.executeCommand")}"]`;
    await until(
      () => aiDialog("A")?.querySelector(executionSelector),
      "AI command block did not render",
    );
    aiDialog("A").querySelector(executionSelector).click();
    await until(
      () => document.body.textContent.includes(i18next.t("ai.executeAnyway")),
      "AI command confirmation did not open",
    );
    renderChat("B");
    await until(
      () => !document.body.textContent.includes(i18next.t("ai.executeAnyway")),
      "inactive AI left its execution confirmation open",
    );
    assert(
      executeTargets.length === 0,
      "switching AI executed an old confirmation",
    );
    await until(
      () => aiDialog("B")?.querySelector("textarea")?.value === "DRAFT-B",
      "B draft was not restored",
    );
    renderChat("A", "QUESTION-A2");
    await sendAI("A");
    await until(() => requests.length === 2, "second AI A request not sent");
    firstAck.resolve({ error: "LATE-ACK-A" });
    await delay(60);
    assert(
      !aiDialog("A").textContent.includes("LATE-ACK-A"),
      "old AI acknowledgement failed the new request",
    );
    assert(
      aiDialog("A").querySelector(
        `button[aria-label="${i18next.t("ai.stopGenerating")}"]`,
      ),
      "old AI acknowledgement cleared the current request",
    );
    renderChat("B");
    await sendAI("B");
    await until(() => requests.length === 3, "AI B request not sent");
    assert(
      requests[2].messages[0].content.includes("B.test"),
      "AI prompt has wrong host B",
    );
    assert(
      !requests[2].messages.some((message) =>
        message.content.includes("QUESTION-A"),
      ),
      "AI histories mixed across hosts",
    );
    sessions = sessions.filter((session) => session.sessionKey !== "A");
    renderChat("B");
    await until(
      () => cancellations.includes(requests[1].sessionId),
      "closing terminal A did not cancel its AI request",
    );
    assert(
      !cancellations.includes(requests[2].sessionId),
      "closing terminal A cancelled B's active stream",
    );
    emit("chunk", { sessionId: requests[2].sessionId, chunk: "ANSWER-B" });
    await until(
      () => aiDialog("B")?.textContent.includes("ANSWER-B"),
      "B stopped receiving after A closed",
    );
    render(null);
    await until(
      () => cancellations.includes(requests[2].sessionId),
      "closing AI did not cancel its request",
    );
    assert(
      !cancellations.includes(requests[0].sessionId),
      "closing AI cancelled an already finished request",
    );
    assert(
      Object.values(listeners).every((entries) => entries.size === 0),
      "AI stream subscriptions leaked",
    );
    return {
      directoryFollow,
      monitorTargets,
      fileTargets,
      commandTargets,
      aiRequests: requests.length,
      isolatedCancellation: true,
    };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    window.terminalAPI = previousApi;
  }
}
