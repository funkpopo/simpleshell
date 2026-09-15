// ssh2 1.x exposes no public ping API. Keep its protocol/callback integration
// here: global request replies are FIFO, including native keepalive replies.
class SshTransportHealth {
  constructor({ timeoutMs = 10000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  check(client) {
    if (this.pending.has(client)) {
      return this.pending.get(client).promise;
    }
    if (
      typeof client?._protocol?.ping !== "function" ||
      !Array.isArray(client?._callbacks)
    ) {
      // If ssh2 changes its internals, retain its native keepalive fallback.
      return Promise.resolve(null);
    }
    if (client.destroyed || client._sock?.destroyed) {
      return Promise.resolve(false);
    }

    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    let settled = false;
    let timer;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.removeListener("close", onClose);
      this.pending.delete(client);
      resolve(healthy);
    };
    const onClose = () => finish(false);
    this.pending.set(client, { promise, cancel: () => finish(null) });
    client.once("close", onClose);
    timer = setTimeout(() => finish(false), this.timeoutMs);
    timer.unref?.();

    // REQUEST_FAILURE (true) is also a valid response to keepalive@openssh.com.
    // On timeout/cancel retain this slot until ssh2 consumes it, otherwise a
    // late reply could be delivered to an unrelated port-forwarding callback.
    client._callbacks.push((error) =>
      finish(
        error === undefined || error === null || typeof error === "boolean",
      ),
    );
    try {
      client._protocol.ping();
    } catch {
      finish(false);
    }
    return promise;
  }

  cancel(client) {
    this.pending.get(client)?.cancel();
  }

  dispose() {
    for (const { cancel } of this.pending.values()) cancel();
  }
}

module.exports = SshTransportHealth;
