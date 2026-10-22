import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const SshTransportHealth = require("../../src/main/connection/ssh-transport-health");

afterEach(() => vi.useRealTimers());

const createClient = () => {
  const client = new EventEmitter();
  client._sock = new EventEmitter();
  client._sock.destroyed = false;
  client._protocol = { ping: vi.fn() };
  client._callbacks = [];
  client._resetKA = vi.fn();
  return client;
};

describe("SSH health under terminal load", () => {
  it("accepts incoming traffic without accumulating unanswered ping callbacks", async () => {
    vi.useFakeTimers();
    const health = new SshTransportHealth({ timeoutMs: 100 });
    const client = createClient();
    const unrelated = vi.fn();
    client._callbacks.push(unrelated);
    for (let i = 0; i < 20; i++) {
      const check = health.check(client);
      client._sock.emit("data", Buffer.from("encrypted SSH output"));
      expect(await check).toBe(true);
      expect(client._callbacks).toHaveLength(2);
      expect(client._sock.listenerCount("data")).toBe(0);
      expect(client.listenerCount("close")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(client._protocol.ping).toHaveBeenCalledTimes(1);
    expect(client._resetKA).toHaveBeenCalledTimes(20);
    client._callbacks.shift()(false);
    expect(unrelated).toHaveBeenCalledTimes(1);
    const waiting = health.check(client);
    client._callbacks.shift()(true);
    expect(await waiting).toBe(true);
    expect(client._callbacks).toHaveLength(0);
    const stalled = health.check(client);
    await vi.advanceTimersByTimeAsync(100);
    expect(await stalled).toBe(false);
    expect(client._sock.listenerCount("data")).toBe(0);
    health.dispose();
  });

  it.each(["cancel", "close", "dispose"])(
    "removes activity listeners and deadlines after %s",
    async (action) => {
      vi.useFakeTimers();
      const health = new SshTransportHealth();
      const client = createClient();
      const check = health.check(client);
      if (action === "cancel") health.cancel(client);
      if (action === "close") client.emit("close");
      if (action === "dispose") health.dispose();
      expect(await check).toBe(action === "close" ? false : null);
      expect(client._sock.listenerCount("data")).toBe(0);
      expect(client.listenerCount("close")).toBe(0);
      expect(health.pending.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not deliver an old transport's late reply to its replacement", async () => {
    vi.useFakeTimers();
    const health = new SshTransportHealth({ timeoutMs: 100 });
    const client = createClient();
    const oldSocket = client._sock;
    const old = health.check(client);
    const oldReply = client._callbacks.shift();
    client._sock = new EventEmitter();
    client._sock.destroyed = false;
    const next = health.check(client);
    expect(await old).toBe(null);
    expect(oldSocket.listenerCount("data")).toBe(0);
    oldReply(true);
    expect(health.pending.size).toBe(1);
    client._sock.emit("data", Buffer.from("new SSH transport"));
    expect(await next).toBe(true);
    expect(client._protocol.ping).toHaveBeenCalledTimes(2);
    health.dispose();
  });
});
