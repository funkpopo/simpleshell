// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook, deferred } from "../helpers/reactHarness.js";
import { AppProvider } from "../../src/renderer/app/state/AppContext.jsx";
import { usePromptTracking } from "../../src/renderer/features/terminal/hooks/usePromptTracking.js";
import { useTerminalSuggestions } from "../../src/renderer/features/terminal/hooks/useTerminalSuggestions.js";
import { useTerminalInputSync } from "../../src/renderer/features/terminal/hooks/useTerminalInputSync.js";
import { processCache } from "../../src/renderer/features/terminal/runtime/terminalSessionStore.js";

let hook;
let disposables;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  disposables = [];
  processCache["history-test"] = "pid";
  window.terminalAPI = {
    getCommandSuggestions: vi.fn(async (input) => ({
      success: true,
      suggestions: [{ command: `${input} --suggested`, count: 1 }],
    })),
    addToCommandHistory: vi.fn(),
    incrementCommandUsage: vi.fn(),
    sendToProcess: vi.fn(),
  };
});
afterEach(async () => {
  disposables.forEach((item) => item.dispose());
  await hook?.unmount();
  hook = null;
  delete processCache["history-test"];
  delete window.terminalAPI;
  vi.useRealTimers();
});

async function setup() {
  const handlers = {};
  let line = "$ ";
  const active = {
    type: "normal",
    cursorX: line.length,
    cursorY: 0,
    baseY: 0,
    getLine: () => ({ translateToString: () => line }),
  };
  const listen = (name) => (callback) => {
    handlers[name] = callback;
    return { dispose: () => delete handlers[name] };
  };
  const term = {
    buffer: { active, onBufferChange: listen("BufferChange") },
  };
  for (const name of ["Data", "Render", "WriteParsed", "LineFeed"])
    term[`on${name}`] = listen(name);
  const ref = (current) => ({ current });
  const options = {
    sessionKey: "history-test",
    termRef: ref(term),
    terminalRef: ref({
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
      }),
    }),
    inEditorModeRef: ref(false),
    isCommandExecutingRef: ref(false),
    lastExecutedCommandRef: ref(""),
    lastExecutedCommandTimeRef: ref(0),
    scheduleTerminalLayoutSyncRef: ref(vi.fn()),
    scheduleTerminalRedrawRef: ref(vi.fn()),
    scheduleTerminalRedraw: vi.fn(),
    focusTerminalInput: vi.fn(),
    sendInputToProcess: vi.fn(),
    enqueueInputToProcess: vi.fn(),
    broadcastInputToGroup: vi.fn(),
    handlePasteText: vi.fn(),
    suggestionUiRef: ref(null),
    eventManager: {
      addEventListener(target, name, callback) {
        target.addEventListener(name, callback);
        return () => target.removeEventListener(name, callback);
      },
    },
  };
  hook = await renderHook(
    () => {
      const api = useTerminalSuggestions(options);
      options.suggestionUiRef.current = api;
      const tracking = usePromptTracking({ ...options, suggestionApi: api });
      useTerminalInputSync(options);
      return { api, tracking };
    },
    {},
    AppProvider,
  );
  await act(() =>
    hook.current.tracking.setupCommandDetection(
      term,
      "pid",
      false,
      disposables,
    ),
  );
  return {
    options,
    get api() {
      return hook.current.api;
    },
    get tracking() {
      return hook.current.tracking;
    },
    input: (data) => act(() => handlers.Data(data)),
    output: (command) =>
      act(() => {
        line = `$ ${command}`;
        active.cursorX = line.length;
        handlers.WriteParsed();
        handlers.Render();
      }),
    buffer: (type) =>
      act(() => {
        active.type = type;
        handlers.BufferChange();
      }),
    sync: (input) =>
      act(() =>
        window.dispatchEvent(
          new CustomEvent("syncTerminalInput", {
            detail: { input, targetTabId: "history-test" },
          }),
        ),
      ),
    flush: (ms = 100) => act(() => vi.advanceTimersByTimeAsync(ms)),
  };
}

describe("terminal history navigation", () => {
  it("keeps repeated normal, application and modified history arrows in the PTY", async () => {
    const h = await setup();
    const arrows = [
      "\x1b[A",
      "\x1b[A",
      "\x1b[B",
      "\x1bOA",
      "\x1bOB",
      "\x1b[1;5A",
    ];
    for (const [index, arrow] of arrows.entries()) {
      await h.input(arrow);
      await h.output(`git history-${index}`);
      await h.flush();
      expect(h.api.currentInput).toBe(`git history-${index}`);
      expect(h.api.showSuggestions).toBe(false);
      expect(h.api.suggestions).toEqual([]);
    }
    expect(window.terminalAPI.getCommandSuggestions).not.toHaveBeenCalled();
    expect(
      h.options.sendInputToProcess.mock.calls.map((call) => call[1]),
    ).toEqual(arrows);
    expect(
      h.options.broadcastInputToGroup.mock.calls.map((call) => call[0]),
    ).toEqual(arrows);
  });

  it.each(["IPC", "layout"])(
    "invalidates a suggestion waiting for %s when history navigation begins",
    async (stage) => {
      const response = deferred();
      window.terminalAPI.getCommandSuggestions.mockReturnValue(
        response.promise,
      );
      const h = await setup();
      await h.input("g");
      await h.output("g");
      await h.flush(12);
      expect(window.terminalAPI.getCommandSuggestions).toHaveBeenCalledOnce();
      const result = {
        success: true,
        suggestions: [{ command: "git status", count: 1 }],
      };
      if (stage === "layout") await act(() => response.resolve(result));
      await h.input("\x1b[A");
      await h.output("git log");
      if (stage === "IPC") await act(() => response.resolve(result));
      await h.flush();
      expect(h.api.showSuggestions).toBe(false);
      expect(h.api.suggestions).toEqual([]);
      expect(window.terminalAPI.getCommandSuggestions).toHaveBeenCalledOnce();
      // Focus/resize recovery and explicit refresh requests must also respect history.
      await act(() =>
        h.tracking.recoverTerminalInteractionState({
          refreshSuggestions: true,
        }),
      );
      await act(() => h.api.getSuggestions("git"));
      expect(window.terminalAPI.getCommandSuggestions).toHaveBeenCalledOnce();
    },
  );

  it("cancels the delayed lookup before it can start", async () => {
    const h = await setup();
    await h.input("g");
    await h.output("g");
    await h.input("\x1b[A");
    await h.output("git log");
    await h.flush();
    expect(window.terminalAPI.getCommandSuggestions).not.toHaveBeenCalled();
  });

  it.each([" ", "\x7f", "\t", "\x1b[3~", "\x15"])(
    "resumes suggestions when the recalled command is edited with %j",
    async (edit) => {
      const h = await setup();
      await h.input("\x1b[A");
      await h.output("git status");
      await h.flush();
      await h.input("\x1b[D");
      await h.flush();
      expect(window.terminalAPI.getCommandSuggestions).not.toHaveBeenCalled();
      await h.input(edit);
      await h.output("git status edited");
      await h.flush();
      expect(h.api.showSuggestions).toBe(true);
      expect(window.terminalAPI.getCommandSuggestions).toHaveBeenLastCalledWith(
        "git status edited",
        10,
      );
    },
  );

  it.each(["\r", "\x03", "reconnect", "alternate"])(
    "clears history navigation after %j",
    async (reset) => {
      const h = await setup();
      await h.input("\x1b[A");
      await h.output("git status");
      if (reset === "reconnect")
        await act(() => h.tracking.resetPromptTracking());
      else if (reset === "alternate") {
        await h.buffer("alternate");
        await h.buffer("normal");
      } else await h.input(reset);
      await h.output("");
      await h.input("p");
      await h.output("p");
      await h.flush();
      expect(h.api.showSuggestions).toBe(true);
      if (reset === "\r") {
        expect(window.terminalAPI.addToCommandHistory).toHaveBeenCalledWith(
          "git status",
        );
      }
    },
  );

  it("does not reopen suggestions while a picked suggestion is echoed", async () => {
    const h = await setup();
    await h.input("g");
    await h.output("g");
    await h.flush();
    expect(h.api.showSuggestions).toBe(true);
    await act(() =>
      h.api.handleSuggestionSelect({ command: "g --suggested", count: 1 }),
    );
    // The shell may echo the inserted command in several chunks.
    await h.output("g --sug");
    await h.output("g --suggested");
    await h.input(" ");
    await h.output("g --suggested ");
    await h.flush();
    expect(h.api.showSuggestions).toBe(false);
    expect(window.terminalAPI.getCommandSuggestions).toHaveBeenCalledOnce();
    await h.input("-");
    await h.output("g --suggested -");
    await h.flush();
    expect(h.api.showSuggestions).toBe(true);
    expect(window.terminalAPI.getCommandSuggestions).toHaveBeenLastCalledWith(
      "g --suggested -",
      10,
    );
  });

  it("releases the picked-suggestion latch when the line is reset", async () => {
    const h = await setup();
    await act(() =>
      h.api.handleSuggestionSelect({ command: "git status", count: 1 }),
    );
    await h.output("git status");
    await h.input("\x03");
    await h.output("");
    await h.input("g");
    await h.output("g");
    await h.flush();
    expect(h.api.showSuggestions).toBe(true);
    expect(window.terminalAPI.getCommandSuggestions).toHaveBeenLastCalledWith(
      "g",
      10,
    );
  });

  it("suppresses history suggestions for synchronized input and resumes on editing", async () => {
    const h = await setup();
    await h.sync("\x1b[A");
    await h.output("git status");
    await h.flush(200);
    expect(window.terminalAPI.getCommandSuggestions).not.toHaveBeenCalled();
    expect(h.api.showSuggestions).toBe(false);
    expect(h.options.enqueueInputToProcess).toHaveBeenCalledWith(
      "pid",
      "\x1b[A",
      { forceChunk: true },
    );
    await h.sync(" ");
    await h.output("git status edited");
    await h.flush(200);
    expect(h.api.showSuggestions).toBe(true);
  });
});
