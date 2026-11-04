import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTerminalAPI } = require("../../src/preload/api/terminal.js");
const {
  TERMINAL_IO_MAILBOX_CHANNEL,
  TERMINAL_IO_MESSAGE_TYPES,
} = require("../../src/shared/contracts/terminalIOMailboxProtocol");

function createApi() {
  const send = vi.fn();
  const api = createTerminalAPI({
    ipcRenderer: {
      send,
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    TERMINAL_IO_MAILBOX_CHANNEL,
    TERMINAL_IO_MESSAGE_TYPES,
    IPC_EVENT_CHANNELS: {},
    IPC_REQUEST_CHANNELS: {},
  });
  return { api, send };
}

describe("terminalAPI.sendToProcess", () => {
  it("sends strings unchanged and decodes bytes as UTF-8 text", () => {
    const { api, send } = createApi();
    expect(api.sendToProcess(7, "ls\r")).toBe(true);
    expect(api.sendToProcess(7, new TextEncoder().encode("你好\r"))).toBe(true);

    const sentData = send.mock.calls.map(
      ([, envelope]) => envelope.message.data,
    );
    expect(sentData).toEqual(["ls\r", "你好\r"]);
    expect(send.mock.calls[0][0]).toBe(TERMINAL_IO_MAILBOX_CHANNEL);
  });

  it("rejects missing process ids and data", () => {
    const { api, send } = createApi();
    expect(api.sendToProcess(null, "x")).toBe(false);
    expect(api.sendToProcess(1, undefined)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
