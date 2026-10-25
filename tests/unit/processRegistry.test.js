import { afterEach, describe, expect, it } from "vitest";
import processManager from "../../src/main/process/processManager.js";

afterEach(() => {
  processManager.clearAllProcesses();
});

describe("process registry keys one session record by processId and tabId", () => {
  it("lists each aliased session once and still removes every key on cleanup", () => {
    const released = [];
    const session = {
      type: "ssh2",
      tabId: "tab-1",
      config: { tabId: "tab-1" },
      connectionInfo: { key: "conn-1" },
    };
    const local = { type: "local", tabId: "tab-2" };
    processManager.setProcess(7, session);
    processManager.setProcess("tab-1", session);
    processManager.setProcess(8, local);
    processManager.setProcess("tab-2", local);

    // 别名共享同一对象：经任一键写入的状态对另一键可见
    processManager.getProcess("tab-1").editorMode = true;
    expect(processManager.getProcess(7).editorMode).toBe(true);

    expect(
      processManager.getUniqueProcessEntries().map(([, proc]) => proc),
    ).toEqual([session, local]);

    processManager.cleanupAllProcesses({
      onConnectionRelease: (proc) => released.push(proc.connectionInfo.key),
    });
    expect(released).toEqual(["conn-1"]);
    expect(processManager.getProcessCount()).toBe(0);
  });
});
