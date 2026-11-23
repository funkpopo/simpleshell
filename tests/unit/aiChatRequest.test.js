// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, createElement, useState, useTransition } from "react";
import { createRoot } from "react-dom/client";
import { renderHook } from "../helpers/reactHarness.js";
import useChatRequest from "../../src/renderer/features/ai/hooks/useChatRequest.js";
import {
  buildConnectionContext,
  generateSystemPrompt,
} from "../../src/renderer/features/ai/lib/aiSystemPrompt.js";
import AIChatWindow from "../../src/renderer/features/ai/AIChatWindow.jsx";
import WebTerminalContextMenu from "../../src/renderer/features/terminal/components/WebTerminalContextMenu.jsx";
import { useTerminalContextMenu } from "../../src/renderer/features/terminal/hooks/useTerminalContextMenu.js";
import { collectTerminalContext } from "../../src/renderer/features/terminal/lib/terminalContextCollector.js";
import {
  clearWorkingDirectorySession,
  registerTerminalContextProvider,
  setTerminalLastCommand,
  setTerminalWorkingDirectory,
} from "../../src/renderer/shared/state/workingDirectoryStore.js";

const { translate } = vi.hoisted(() => ({
  translate: (key, params) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({ t: translate, i18n: { language: "en-US" } }),
  };
});
vi.mock("../../src/renderer/features/ai/AISettings", () => ({
  default: () => null,
}));

const api = {
  id: "cfg",
  apiUrl: "https://example.invalid/v1",
  apiKey: "sk-test",
  model: "m",
  streamEnabled: true,
};

let streamListeners;
let hook;

function useChatHarness(extraOptions = {}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("hello");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const request = useChatRequest({
    sessionKey: "s1",
    connectionInfo: null,
    currentApi: api,
    messages,
    setMessages,
    input,
    setInput,
    setError,
    isPending,
    startTransition,
    inputRef: { current: null },
    ...extraOptions,
  });
  return { ...request, messages, input, error };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  streamListeners = {};
  const subscribe = (name) => (handler) => {
    streamListeners[name] = handler;
    return () => delete streamListeners[name];
  };
  window.terminalAPI = {
    loadMemory: vi.fn(async () => null),
    deleteMemory: vi.fn(async () => {
      throw new Error("disk full");
    }),
    sendAPIRequest: vi.fn(() => new Promise(() => {})),
    cancelAPIRequest: vi.fn(async () => ({ success: true })),
    onAIStreamChunk: subscribe("chunk"),
    onAIStreamEnd: subscribe("end"),
    onAIStreamError: subscribe("error"),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await hook?.unmount();
  hook = null;
  clearWorkingDirectorySession("s1");
  clearWorkingDirectorySession("ctx-ui-1");
  clearWorkingDirectorySession("menu-s1");
  vi.restoreAllMocks();
  delete window.terminalAPI;
});

async function startStreaming() {
  hook = await renderHook(useChatHarness, {}, StrictMode);
  await act(async () => {
    void hook.current.handleSendMessage();
  });
  await vi.waitFor(() => expect(streamListeners.chunk).toBeTypeOf("function"));
  const sessionId =
    window.terminalAPI.sendAPIRequest.mock.calls[0][0].sessionId;
  return sessionId;
}

describe("useChatRequest", () => {
  it("appends each stream chunk exactly once under StrictMode", async () => {
    const sessionId = await startStreaming();
    const before = hook.current.messages.at(-1);

    await act(async () => {
      streamListeners.chunk(null, { sessionId, chunk: "ab" });
      streamListeners.chunk(null, { sessionId, chunk: "cd" });
    });

    const reply = hook.current.messages.at(-1);
    expect(reply.content).toBe("abcd");
    // The previous message object is never mutated.
    expect(before.content).toBe("");

    await act(async () => {
      streamListeners.end(null, { sessionId });
    });
    expect(hook.current.messages.at(-1).isStreaming).toBe(false);
    expect(hook.current.abortController).toBeNull();
  });

  it("clearing during a request resets the busy state even if memory deletion fails", async () => {
    await startStreaming();
    expect(hook.current.abortController).not.toBeNull();

    await act(async () => {
      await hook.current.handleClearChat();
    });

    expect(hook.current.abortController).toBeNull();
    expect(hook.current.messages).toEqual([]);
    expect(window.terminalAPI.deleteMemory).toHaveBeenCalled();
  });

  it("injects terminal context only when attached and prevents leakage when toggled off", async () => {
    const context = {
      cwd: "/etc/nginx",
      username: "ops",
      lastCommand: "nginx -t",
      recentOutput: "nginx: configuration file test is successful",
    };

    hook = await renderHook(() =>
      useChatHarness({
        connectionInfo: { host: "web-1", type: "SSH", username: "ops" },
        attachTerminalContext: true,
        getTerminalContext: () => context,
      }),
    );

    await act(async () => {
      void hook.current.handleSendMessage();
    });
    await vi.waitFor(() =>
      expect(window.terminalAPI.sendAPIRequest).toHaveBeenCalledTimes(1),
    );
    const attachedSystemPrompt =
      window.terminalAPI.sendAPIRequest.mock.calls[0][0].messages[0].content;
    expect(attachedSystemPrompt).toContain("/etc/nginx");
    expect(attachedSystemPrompt).toContain("nginx -t");
    expect(attachedSystemPrompt).toContain(
      "nginx: configuration file test is successful",
    );

    await hook.unmount();
    hook = null;
    window.terminalAPI.sendAPIRequest.mockClear();

    hook = await renderHook(() =>
      useChatHarness({
        connectionInfo: { host: "web-1", type: "SSH", username: "ops" },
        attachTerminalContext: false,
        getTerminalContext: () => context,
      }),
    );

    await act(async () => {
      void hook.current.handleSendMessage();
    });
    await vi.waitFor(() =>
      expect(window.terminalAPI.sendAPIRequest).toHaveBeenCalledTimes(1),
    );
    const detachedSystemPrompt =
      window.terminalAPI.sendAPIRequest.mock.calls[0][0].messages[0].content;
    expect(detachedSystemPrompt).not.toContain("/etc/nginx");
    expect(detachedSystemPrompt).not.toContain("nginx -t");
    expect(detachedSystemPrompt).not.toContain(
      "nginx: configuration file test is successful",
    );
  });
});

describe("buildConnectionContext and Context-Aware AI UI", () => {
  it("formats structured context when attached, zero leakage when off, and safe fallback on Welcome", () => {
    const welcomeContext = buildConnectionContext({
      language: "en-US",
      connectionInfo: null,
      terminalContext: { cwd: "/secret/dir", recentOutput: "leaked" },
      attachTerminalContext: true,
    });
    expect(welcomeContext).toBe("No active connection");
    expect(welcomeContext).not.toContain("/secret/dir");
    expect(welcomeContext).not.toContain("leaked");

    const detached = buildConnectionContext({
      language: "en-US",
      connectionInfo: { host: "prod-1", type: "SSH", username: "root" },
      terminalContext: {
        cwd: "/var/log/nginx",
        lastCommand: "tail -n 20 error.log",
        recentOutput: "upstream timed out",
      },
      attachTerminalContext: false,
    });
    expect(detached).toBe("Current connection: prod-1 (SSH)");
    expect(detached).not.toContain("/var/log/nginx");
    expect(detached).not.toContain("upstream timed out");

    const attached = generateSystemPrompt({
      language: "en-US",
      connectionInfo: { host: "prod-1", type: "SSH", username: "root" },
      terminalContext: {
        cwd: "/var/log/nginx",
        username: "root",
        lastCommand: "nginx -t",
        recentOutput: '```json\n{"err": true}\n```',
      },
      attachTerminalContext: true,
    });
    expect(attached).toContain("Current connection: prod-1 (SSH)");
    expect(attached).toContain(
      "Current working directory (CWD): /var/log/nginx",
    );
    expect(attached).toContain("Last executed command: nginx -t");
    expect(attached).toContain("````text");
    expect(attached).toContain('{"err": true}');
  });

  it("enables Explain Recent Output with AI when selection is empty and sends redacted context", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const dispatched = [];
    const onSendToAIEvent = (event) => dispatched.push(event.detail);
    window.addEventListener("sendToAI", onSendToAIEvent);

    try {
      await act(() =>
        root.render(
          createElement(WebTerminalContextMenu, {
            contextMenu: { mouseX: 10, mouseY: 10 },
            isActive: true,
            selectedText: "",
            onClose: () => {},
            onCopy: () => {},
            onPaste: () => {},
            onSendToAI: () => {},
            onSearch: () => {},
            onClear: () => {},
          }),
        ),
      );
      const menuItems = [...document.querySelectorAll('[role="menuitem"]')];
      const aiMenuItem = menuItems.find((item) =>
        item.textContent.includes("terminal.explainRecentOutput"),
      );
      expect(aiMenuItem).toBeDefined();
      expect(aiMenuItem.getAttribute("aria-disabled")).not.toBe("true");

      const mockTerm = {
        cols: 80,
        buffer: {
          active: {
            length: 2,
            getLine: (idx) => ({
              isWrapped: false,
              translateToString: () =>
                idx === 0
                  ? "\x1b[31mError: failed auth\x1b[0m"
                  : "Authorization: Bearer super-secret-jwt",
            }),
          },
        },
      };

      hook = await renderHook(() =>
        useTerminalContextMenu({
          sessionKey: "menu-s1",
          termRef: { current: mockTerm },
          isActiveRef: { current: true },
          markPasteIfAllowed: () => true,
          handlePasteText: () => {},
          clearTerminal: () => {},
          openSearchBar: () => {},
          setShowSuggestions: () => {},
          setSuggestions: () => {},
          getTerminalContext: () =>
            collectTerminalContext({
              sessionKey: "menu-s1",
              term: mockTerm,
              cwd: "/etc/nginx",
            }),
        }),
      );

      await act(() => hook.current.handleSendToAI());
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].sessionKey).toBe("menu-s1");
      expect(dispatched[0].text).toContain("Error: failed auth");
      expect(dispatched[0].text).toContain("Bearer [REDACTED]");
      expect(dispatched[0].text).not.toContain("super-secret-jwt");
      expect(dispatched[0].text).not.toContain("\x1b[31m");
    } finally {
      window.removeEventListener("sendToAI", onSendToAIEvent);
      await act(() => root.unmount());
      host.remove();
    }
  });

  it("renders toggleable terminal context chip and 1-click quick action chips in AIChatWindow", async () => {
    setTerminalWorkingDirectory("ctx-ui-1", "/etc/nginx");
    setTerminalLastCommand("ctx-ui-1", "nginx -t");
    const unregister = registerTerminalContextProvider("ctx-ui-1", () => ({
      sessionKey: "ctx-ui-1",
      cwd: "/etc/nginx",
      username: "ops",
      lastCommand: "nginx -t",
      recentOutput: "nginx: syntax error\nnginx: test failed",
      lineCount: 2,
      charCount: 38,
      truncated: false,
    }));

    window.terminalAPI = {
      ...window.terminalAPI,
      loadAISettings: vi.fn(async () => ({
        current: api,
        configs: [api],
      })),
      loadWindowSize: vi.fn(async () => null),
      saveWindowSize: vi.fn(async () => true),
      deleteMemory: vi.fn(async () => true),
    };

    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.focus();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          createElement(AIChatWindow, {
            windowState: "visible",
            sessionKey: "ctx-ui-1",
            commandEnabled: true,
            onClose: () => {},
            onMinimize: () => {},
            presetInput: "",
            onInputPresetUsed: () => {},
            connectionInfo: {
              host: "prod-1",
              username: "ops",
              type: "SSH",
              port: 22,
            },
            onExecuteCommand: () => {},
          }),
        );
      });

      await vi.waitFor(() =>
        expect(
          document.querySelector('[data-testid="ai-terminal-context-chip"]'),
        ).not.toBeNull(),
      );

      const chip = document.querySelector(
        '[data-testid="ai-terminal-context-chip"]',
      );
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect(chip.textContent).toContain("ai.terminalContext.chipCwdLines");
      expect(chip.textContent).toContain("/etc/nginx");

      // Toggle off -> zero leakage on send
      await act(async () => {
        chip.click();
      });
      expect(chip.getAttribute("aria-pressed")).toBe("false");

      // Click 1-click quick action -> auto-attaches and streams cleanly
      const quickExplain = document.querySelector(
        '[data-testid="ai-quick-explain-chip"]',
      );
      await act(async () => {
        quickExplain.click();
      });

      await vi.waitFor(() =>
        expect(window.terminalAPI.sendAPIRequest).toHaveBeenCalledTimes(1),
      );
      const sentRequest = window.terminalAPI.sendAPIRequest.mock.calls[0][0];
      expect(sentRequest.messages[0].content).toContain("/etc/nginx");
      expect(sentRequest.messages[0].content).toContain("nginx: syntax error");
      expect(sentRequest.messages[1].content).toBe(
        "ai.quickActions.explainOutputPrompt",
      );

      await act(async () => {
        streamListeners.chunk(null, {
          sessionId: sentRequest.sessionId,
          chunk: "Check line 42 in nginx.conf.",
        });
        streamListeners.end(null, { sessionId: sentRequest.sessionId });
      });
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain(
          "Check line 42 in nginx.conf.",
        ),
      );

      // Toggle off again and verify suggestCommand chip also works
      await act(async () => {
        chip.click();
      });
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      const quickSuggest = document.querySelector(
        '[data-testid="ai-quick-suggest-chip"]',
      );
      await act(async () => {
        quickSuggest.click();
      });
      await vi.waitFor(() =>
        expect(window.terminalAPI.sendAPIRequest).toHaveBeenCalledTimes(2),
      );
      expect(
        window.terminalAPI.sendAPIRequest.mock.calls[1][0].messages.at(-1)
          .content,
      ).toBe("ai.quickActions.suggestCommandPrompt");
    } finally {
      unregister();
      await act(() => root.unmount());
      host.remove();
      anchor.remove();
    }
  });
});
