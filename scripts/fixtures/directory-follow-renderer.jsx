import React from "react";
import { Terminal } from "@xterm/xterm";
import FileManager from "../../src/components/FileManager.jsx";
import Settings from "../../src/components/Settings.jsx";
import i18next from "i18next";
import { useSftpFollowSetting } from "../../src/hooks/useSftpFollowSetting.js";
import { attachWorkingDirectoryTracking } from "../../src/modules/terminal/workingDirectoryTracking.js";
import {
  clearWorkingDirectorySession,
  getWorkingDirectoryState,
  setTerminalWorkingDirectory,
} from "../../src/modules/terminal/workingDirectoryStore.js";

export async function runDirectoryFollowChecks({
  render,
  container,
  until,
  delay,
  assert,
}) {
  const term = new Terminal({ cols: 80, rows: 5 });
  const tracker = attachWorkingDirectoryTracking(term, "follow", {
    username: "alice",
  });
  const write = (data) => new Promise((resolve) => term.write(data, resolve));
  const requests = [];
  const connections = { follow: { host: "server" }, other: { host: "other" } };
  let finishOldRequest;
  let finishHomeRequest;
  const pendingLists = new Map();
  let preferences = { language: "en-US", sftpFollowTerminalDirectory: false };
  let resolveInitialSettings;
  let initialSettings = new Promise((resolve) => {
    resolveInitialSettings = resolve;
  });
  const setPreference = async (enabled) => {
    preferences = { ...preferences, sftpFollowTerminalDirectory: enabled };
    window.dispatchEvent(
      new CustomEvent("settingsChanged", { detail: preferences }),
    );
    await delay(30);
  };
  window.terminalAPI = {
    loadUISettings: () =>
      initialSettings || Promise.resolve({ ...preferences }),
    saveUISettings: async (settings) => {
      preferences = { ...preferences, ...settings };
      return { success: true };
    },
    getAbsolutePath: (id, path) => {
      assert(
        id === "follow" && path === "./project",
        "home path was resolved for the wrong session",
      );
      return new Promise((resolve) => {
        finishHomeRequest = resolve;
      });
    },
    listFiles: (id, path, options) => {
      requests.push({ id, path });
      if (path.startsWith("/pending-"))
        return new Promise((resolve) => pendingLists.set(path, resolve));
      if (path === "/denied")
        return Promise.resolve({ success: false, error: "Permission denied" });
      if (path !== "/")
        assert(
          options.nonBlocking === false,
          "automatic navigation committed before read completion",
        );
      if (path === "/slow")
        return new Promise((resolve) => {
          finishOldRequest = resolve;
        });
      return Promise.resolve({
        success: true,
        data: [{ name: `file:${path}`, size: 1 }],
      });
    },
  };
  const Fixture = ({ id, open }) => {
    const enabled = useSftpFollowSetting();
    return (
      <FileManager
        key={id}
        open={open}
        tabId={id}
        sshConnection={connections[id]}
        initialPath="/"
        onClose={() => {}}
        followTerminalDirectory={enabled}
      />
    );
  };
  const show = (id = "follow", open = true) =>
    render(<Fixture id={id} open={open} />);
  const loaded = (path, id = "follow") =>
    requests.some((request) => request.id === id && request.path === path);
  try {
    show();
    await write("\x1b]7;file://server/srv/a%20");
    assert(
      getWorkingDirectoryState("follow").path === null,
      "partial OSC updated the directory",
    );
    await write("b\x07");
    await delay(180);
    assert(!loaded("/srv/a b"), "follow ran before saved settings loaded");
    await setPreference(true);
    resolveInitialSettings({
      language: "en-US",
      sftpFollowTerminalDirectory: false,
    });
    initialSettings = null;
    await until(() => loaded("/srv/a b"), "OSC directory was not followed");
    assert(
      !container.querySelector("button[aria-pressed]"),
      "file sidebar still owns a follow toggle",
    );
    await setPreference(false);
    await write("\x1b]7;file://server/disabled\x1b\\");
    await delay(200);
    assert(!loaded("/disabled"), "disabled follow still navigated");
    await setPreference(true);
    await until(() => loaded("/disabled"), "enabling follow did not catch up");
    await write("\x1b]7;file://server/slow\x07");
    await until(() => finishOldRequest, "slow request did not start");
    await write("\x1b]1337;CurrentDir=/latest\x07");
    await until(
      () => container.textContent.includes("file:/latest"),
      "latest directory did not render",
    );
    finishOldRequest({
      success: true,
      data: [{ name: "STALE-FILE", size: 1 }],
    });
    await delay(60);
    assert(
      !container.textContent.includes("STALE-FILE"),
      "old directory overwrote the latest directory",
    );
    const count = requests.length;
    await write("\x1b]7;file://server/latest\x07");
    await delay(180);
    assert(
      requests.length === count,
      "identical cwd caused an extra list request",
    );
    show("follow", false);
    await write("\x1b]7;file://server/hidden\x07");
    await delay(180);
    assert(!loaded("/hidden"), "hidden panel fetched directories");
    show();
    await until(() => loaded("/hidden"), "reopened panel did not catch up");
    await setPreference(false);
    setTerminalWorkingDirectory("other", "/other");
    show("other");
    await delay(180);
    assert(
      !loaded("/other", "other"),
      "global opt-out was lost on session switch",
    );
    await setPreference(true);
    await until(
      () => loaded("/other", "other"),
      "session switch followed the wrong directory",
    );
    show();
    tracker.reset();
    await write("\r\x1b[2Kalice@server:~/project$ ");
    await until(
      () => finishHomeRequest,
      "home-relative prompt was not resolved",
    );
    await write("\r\x1b[2Kalice@server:/newer$ ");
    await until(
      () => loaded("/newer"),
      "prompt fallback did not follow the newer path",
    );
    finishHomeRequest({ success: true, path: "/home/alice/project" });
    await delay(160);
    assert(
      !loaded("/home/alice/project"),
      "late home resolution replaced a newer cwd",
    );
    const longPath = `/srv/${"long-directory/".repeat(8)}中文`;
    await write(`\r\n${"output\r\n".repeat(8)}alice@server:${longPath}$ `);
    await until(
      () => loaded(longPath),
      "wrapped prompt after scrollback lost its directory",
    );
    const wideBoundaryPath = `/srv/${"x".repeat(61)}中文`;
    await write(
      `\r\n${"output\r\n".repeat(6)}alice@server:${wideBoundaryPath}$ `,
    );
    await until(
      () => loaded(wideBoundaryPath),
      "wide-character wrap padding entered the path",
    );

    const report = async (path) => {
      await write(`\x1b]7;file://server${path}\x07`);
    };
    await until(
      () => container.textContent.includes(`file:${wideBoundaryPath}`),
      "baseline directory is missing",
    );
    await report("/pending-return");
    await until(
      () => pendingLists.has("/pending-return"),
      "pending return request missing",
    );
    await report(wideBoundaryPath);
    await delay(30);
    pendingLists.get("/pending-return")({
      success: true,
      data: [{ name: "STALE-RETURN" }],
    });
    await delay(180);
    assert(
      container.textContent.includes(`file:${wideBoundaryPath}`) &&
        !container.textContent.includes("STALE-RETURN"),
      "A to B to A allowed an old response to navigate",
    );

    await report("/pending-disable");
    await until(
      () => pendingLists.has("/pending-disable"),
      "pending disable request missing",
    );
    await setPreference(false);
    pendingLists.get("/pending-disable")({
      success: true,
      data: [{ name: "STALE-DISABLED" }],
    });
    await delay(100);
    assert(
      !container.textContent.includes("STALE-DISABLED"),
      "disabled follow committed a pending read",
    );
    await report("/denied");
    await setPreference(true);
    await until(
      () => loaded("/denied"),
      "unreadable directory was not attempted",
    );
    await delay(60);
    assert(
      container.textContent.includes(`file:${wideBoundaryPath}`),
      "failed navigation erased the current directory",
    );

    await report("/pending-close");
    await until(
      () => pendingLists.has("/pending-close"),
      "pending close request missing",
    );
    show("other");
    pendingLists.get("/pending-close")({
      success: true,
      data: [{ name: "STALE-CLOSED" }],
    });
    await delay(180);
    assert(
      !container.textContent.includes("STALE-CLOSED"),
      "closed panel committed a late response",
    );

    // Exercise the actual global Settings form and persisted reload.
    await setPreference(false);
    render(<Settings open onClose={() => {}} />);
    const settingInput = () =>
      [...document.querySelectorAll("label")]
        .find((label) =>
          label.textContent.includes(
            i18next.t("settings.sftpFollowTerminalDirectory"),
          ),
        )
        ?.querySelector("input");
    await until(
      () => settingInput(),
      "global setting is missing from Settings",
    );
    assert(
      !settingInput().checked,
      "Settings did not load the saved global opt-out",
    );
    settingInput().click();
    await delay(30);
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === i18next.t("settings.save"))
      .click();
    await until(
      () => preferences.sftpFollowTerminalDirectory === true,
      "Settings did not persist the global follow preference",
    );
    show("other");
    await until(
      () => container.textContent.includes("file:/other"),
      "global preference was not restored after remount",
    );
    return { directoryFollow: true, requests: requests.length };
  } finally {
    render(null);
    tracker.dispose();
    term.dispose();
    clearWorkingDirectorySession("follow");
    clearWorkingDirectorySession("other");
  }
}
