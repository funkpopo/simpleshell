import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const SshTransportHealth = require("../../src/main/connection/ssh-transport-health");

/** A client whose `checkTransport` answers when the test resolves it. */
const createClient = () => {
  const client = new EventEmitter();
  client.replies = [];
  client.checkTransport = vi.fn(
    (timeoutMs) =>
      new Promise((resolve) => client.replies.push({ resolve, timeoutMs })),
  );
  return client;
};

describe("SSH transport health", () => {
  it("shares one probe between overlapping checks of a client", async () => {
    const health = new SshTransportHealth({ timeoutMs: 100 });
    const client = createClient();
    const first = health.check(client);
    expect(health.check(client)).toBe(first);
    expect(client.checkTransport).toHaveBeenCalledTimes(1);
    expect(client.replies[0].timeoutMs).toBe(100);
    client.replies.shift().resolve(true);
    expect(await first).toBe(true);
    expect(health.pending.size).toBe(0);

    const next = health.check(client);
    expect(client.checkTransport).toHaveBeenCalledTimes(2);
    client.replies.shift().resolve(false);
    expect(await next).toBe(false);
  });

  it.each(["cancel", "dispose"])(
    "resolves a pending check as unknown after %s",
    async (action) => {
      const health = new SshTransportHealth();
      const client = createClient();
      const check = health.check(client);
      if (action === "cancel") health.cancel(client);
      if (action === "dispose") health.dispose();
      expect(await check).toBe(null);
      expect(health.pending.size).toBe(0);
      // A late answer of the cancelled probe changes nothing.
      client.replies.shift().resolve(false);
      const next = health.check(client);
      client.replies.shift().resolve(true);
      expect(await next).toBe(true);
    },
  );

  it("reports unknown for clients without a transport check", async () => {
    const health = new SshTransportHealth();
    expect(await health.check({})).toBe(null);
    expect(await health.check(null)).toBe(null);
    expect(health.pending.size).toBe(0);
  });
});
