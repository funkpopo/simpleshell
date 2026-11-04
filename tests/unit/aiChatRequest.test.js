// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, useState, useTransition } from "react";
import { renderHook } from "../helpers/reactHarness.js";
import useChatRequest from "../../src/renderer/features/ai/hooks/useChatRequest.js";

const api = {
  id: "cfg",
  apiUrl: "https://example.invalid/v1",
  apiKey: "sk-test",
  model: "m",
  streamEnabled: true,
};

let streamListeners;
let hook;

function useChatHarness() {
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
  });
  return { ...request, messages, error };
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
  vi.restoreAllMocks();
  delete window.terminalAPI;
});

async function startStreaming() {
  hook = await renderHook(useChatHarness, {}, StrictMode);
  await act(async () => {
    void hook.current.handleSendMessage();
  });
  await vi.waitFor(() => expect(streamListeners.chunk).toBeTypeOf("function"));
  const sessionId = window.terminalAPI.sendAPIRequest.mock.calls[0][0].sessionId;
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
});
