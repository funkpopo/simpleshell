import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
vi.mock("../../src/main/utils/logger", () => ({ logToFile: () => {} }));
const TerminalIOMailboxManager = require("../../src/main/terminal/terminalIOMailboxManager");
const {
  TERMINAL_IO_DEFAULTS,
} = require("../../src/shared/contracts/terminalIOMailboxProtocol");

function createManager() {
  const sent = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (_channel, payload) => sent.push(payload) },
  };
  return {
    manager: new TerminalIOMailboxManager({ getMainWindow: () => window }),
    sent,
  };
}

function remoteFlow() {
  const calls = [];
  return {
    calls,
    flow: {
      ack: (bytes) => calls.push(["ack", bytes]),
      pause: (reason) => calls.push(["pause", reason]),
      resume: (reason) => calls.push(["resume", reason]),
    },
  };
}

describe("TerminalIOMailboxManager flow control", () => {
  it("pauses its local target at the threshold without a remote producer", () => {
    const { manager } = createManager();
    const target = { pause: vi.fn(), resume: vi.fn() };
    manager.createMailbox(1, { getFlowControlTarget: () => target });
    const chunk = "x".repeat(
      TERMINAL_IO_DEFAULTS.backpressurePauseThresholdBytes,
    );
    manager.emitOutput(1, chunk);
    manager._flushOutputBatch(manager._getMailbox(1));
    expect(target.pause).toHaveBeenCalledTimes(1);
    manager.handleAck(1, chunk.length);
    expect(target.resume).toHaveBeenCalledTimes(1);
  });

  it("relays ACKs and pause reasons to a remote producer", () => {
    const { manager, sent } = createManager();
    const target = { pause: vi.fn(), resume: vi.fn() };
    const { flow, calls } = remoteFlow();
    manager.createMailbox(2, {
      getFlowControlTarget: () => target,
      remoteFlow: flow,
    });

    manager.emitOutput(
      2,
      "y".repeat(TERMINAL_IO_DEFAULTS.backpressurePauseThresholdBytes),
    );
    manager._flushOutputBatch(manager._getMailbox(2));
    // Notices are not output credit: their ACK is absorbed.
    manager.emitOutput(2, "notice", { trackBackpressure: false });
    expect(sent).toHaveLength(2);

    manager.handleAck(2, 4);
    manager.handleAck(2, 1000);
    manager.pause(2, "renderer");
    manager.pause(2, "renderer");
    manager.pause(2, "selection");
    manager.resume(2, "renderer");
    manager.resume(2, "unknown");
    expect(calls).toEqual([
      ["ack", 998],
      ["pause", "renderer"],
      ["pause", "selection"],
      ["resume", "renderer"],
    ]);
    // The mailbox itself never pauses anything.
    expect(target.pause).not.toHaveBeenCalled();

    // A new producer (reconnect) learns the reasons still in effect.
    const next = remoteFlow();
    manager.createMailbox(2, { remoteFlow: next.flow });
    expect(next.calls).toEqual([["pause", "selection"]]);
  });
});
