// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "../helpers/reactHarness.js";
import { usePromptTracking } from "../../src/renderer/features/terminal/hooks/usePromptTracking.js";
const {
  getVisibleCommand,
  isPromptReadyFromTerminal,
} = require("../../src/renderer/features/terminal/model/promptDetection.js");

let hook;
let disposables;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {
    addToCommandHistory: vi.fn(),
    incrementCommandUsage: vi.fn(),
  };
  disposables = [];
});
afterEach(async () => {
  disposables.forEach((item) => item.dispose());
  await hook?.unmount();
  hook = null;
});

async function setup(initialLine = "$ ", baseY = 0) {
  const handlers = {};
  let lines = [initialLine];
  const active = {
    type: "normal",
    baseY,
    cursorY: 0,
    cursorX: initialLine.length,
    getLine(index) {
      const text = lines[index - baseY];
      if (text === undefined)
        return { translateToString: () => "$ old-scrollback" };
      return { isWrapped: index > baseY, translateToString: () => text };
    },
  };
  const term = { buffer: { active } };
  for (const event of ["Data", "LineFeed", "Render", "WriteParsed"]) {
    term[`on${event}`] = (fn) => {
      handlers[event] = fn;
      return { dispose: () => delete handlers[event] };
    };
  }
  const ref = (current) => ({ current });
  const suggestionApi = {};
  for (const name of [
    "setShowSuggestions",
    "setSuggestions",
    "setCurrentInput",
    "setSuggestionsHiddenByEsc",
    "setSuggestionsSuppressedUntilEnter",
    "updateCursorPosition",
  ])
    suggestionApi[name] = vi.fn();
  for (const name of [
    "suppressionContextRef",
    "suggestionsSuppressedRef",
    "suggestionsHiddenByEscRef",
    "suggestionSelectedRef",
  ])
    suggestionApi[name] = ref(false);
  suggestionApi.getSuggestionsRef = ref(vi.fn());
  const sendInputToProcess = vi.fn();
  const enqueueInputToProcess = vi.fn();
  hook = await renderHook(usePromptTracking, {
    sessionKey: "test",
    termRef: ref(term),
    inEditorModeRef: ref(false),
    isCommandExecutingRef: ref(false),
    lastExecutedCommandTimeRef: ref(0),
    lastExecutedCommandRef: ref(""),
    scheduleTerminalLayoutSyncRef: ref(vi.fn()),
    scheduleTerminalRedrawRef: ref(vi.fn()),
    scheduleTerminalRedraw: vi.fn(),
    focusTerminalInput: vi.fn(),
    broadcastInputToGroup: vi.fn(),
    sendInputToProcess,
    enqueueInputToProcess,
    suggestionApi,
  });
  await act(() =>
    hook.current.setupCommandDetection(term, "pid", false, disposables),
  );
  return {
    term,
    handlers,
    suggestionApi,
    sendInputToProcess,
    enqueueInputToProcess,
    input: async (data) => act(() => handlers.Data(data)),
    output: async (...text) =>
      act(() => {
        lines = text;
        active.cursorY = text.length - 1;
        active.cursorX = text.at(-1).length;
        handlers.WriteParsed();
      }),
  };
}

describe("terminal history privacy", () => {
  it("reads prompt state once per parsed output batch instead of per line or repaint", async () => {
    const h = await setup();
    const reads = vi.spyOn(h.term.buffer.active, "getLine");
    await act(() => {
      for (let i = 0; i < 2000; i++) h.handlers.LineFeed();
      for (let i = 0; i < 10; i++) h.handlers.Render();
    });
    expect(reads).not.toHaveBeenCalled();
    await h.output("$ git status");
    expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
    expect(h.suggestionApi.setCurrentInput).toHaveBeenCalledWith("git status");
  });
  it.each([
    "Password: ",
    "[sudo] password for root: ",
    "Enter passphrase for key '/tmp/id:one': ",
    "密码：",
    "Verification code: ",
    "Custom challenge > ",
    "$ ",
  ])("forwards hidden input without recording it at %s", async (prompt) => {
    const h = await setup();
    await h.output(prompt);
    for (const key of "hidden-login-value") await h.input(key);
    await h.input("\r");
    expect(h.sendInputToProcess).toHaveBeenLastCalledWith("pid", "\r");
    expect(
      h.sendInputToProcess.mock.calls.map((call) => call[1]).join(""),
    ).toBe("hidden-login-value\r");
    expect(window.terminalAPI.addToCommandHistory).not.toHaveBeenCalled();
    expect(window.terminalAPI.incrementCommandUsage).not.toHaveBeenCalled();
    expect(
      h.suggestionApi.setCurrentInput.mock.calls.flat().join(""),
    ).not.toContain("hidden");
  });

  it("records visible commands after scrollback and wrapped lines", async () => {
    const h = await setup("$ ", 50);
    await h.output("$ printf hello", "-world");
    await h.input("\r");
    expect(window.terminalAPI.addToCommandHistory).toHaveBeenCalledWith(
      "printf hello-world",
    );
  });

  it("keeps hidden paste out of history then resumes at the next prompt", async () => {
    const h = await setup("Password: ", 50);
    await h.input("\x1b[200~hidden-login-value\x1b[201~");
    await h.input("\r");
    expect(h.enqueueInputToProcess).toHaveBeenCalled();
    expect(window.terminalAPI.addToCommandHistory).not.toHaveBeenCalled();
    await h.output("$ git status");
    await h.input("\r");
    expect(
      window.terminalAPI.addToCommandHistory,
    ).toHaveBeenCalledExactlyOnceWith("git status");
  });

  it("uses echoed completion and edits, not typed keys", async () => {
    const h = await setup();
    await h.input("g");
    await h.output("$ g");
    await h.input("\t");
    await h.output("$ git status");
    await h.input("\r");
    expect(window.terminalAPI.addToCommandHistory).toHaveBeenCalledWith(
      "git status",
    );
    expect(h.suggestionApi.setCurrentInput).toHaveBeenCalledWith("g");
  });

  it("filters echoed credentials and ignores alternate buffers and unknown prompts", async () => {
    const h = await setup();
    await h.output("$ curl --token demo-value https://example.test");
    await h.input("\r");
    expect(window.terminalAPI.addToCommandHistory).not.toHaveBeenCalled();
    await h.output("application input: something");
    expect(getVisibleCommand(h.term)).toBe("");
    expect(isPromptReadyFromTerminal(h.term)).toBe(false);
    h.term.buffer.active.type = "alternate";
    await h.output("$ git status");
    expect(getVisibleCommand(h.term)).toBe("");
  });
});
