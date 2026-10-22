// ssh2 1.x exposes no public ping API. Keep its protocol/callback integration
// here: global request replies are FIFO, including native keepalive replies.
class SshTransportHealth {
  constructor({ timeoutMs = 10000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.probes = new WeakMap();
  }

  check(client) {
    const previous = this.pending.get(client);
    if (previous) {
      if (previous.socket === client?._sock) return previous.promise;
      previous.cancel();
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
    const socket = client._sock;
    let probe = this.probes.get(client);
    if (probe && probe.socket !== socket) {
      this.probes.delete(client);
      probe = null;
    }
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.removeListener("close", onClose);
      socket?.removeListener?.("data", onData);
      if (probe?.finish === finish) probe.finish = null;
      this.pending.delete(client);
      resolve(healthy);
    };
    const onClose = () => {
      if (this.probes.get(client) === probe) this.probes.delete(client);
      finish(false);
    };
    const onData = (data) => {
      if (!data?.length || client._sock !== socket || socket.destroyed) return;
      // Global replies share the TCP stream with shell output and are FIFO.
      // A busy peer may still be sending valid SSH traffic after the ping's
      // deadline. Receiving that traffic proves liveness as well as a reply.
      client._resetKA?.();
      finish(true);
    };
    this.pending.set(client, { promise, socket, cancel: () => finish(null) });
    client.once("close", onClose);
    socket?.on?.("data", onData);
    timer = setTimeout(() => finish(false), this.timeoutMs);
    timer.unref?.();

    // REQUEST_FAILURE (true) is also a valid response to keepalive@openssh.com.
    // On timeout/cancel retain this slot until ssh2 consumes it, otherwise a
    // late reply could be delivered to an unrelated port-forwarding callback.
    // Reuse an unanswered probe on later checks. Completing a check from data
    // must not accumulate ping callbacks behind an already delayed FIFO reply.
    if (probe) {
      probe.finish = finish;
    } else {
      probe = { finish, socket };
      this.probes.set(client, probe);
      client._callbacks.push((error) => {
        if (this.probes.get(client) === probe) this.probes.delete(client);
        probe.finish?.(
          error === undefined || error === null || typeof error === "boolean",
        );
      });
      try {
        client._protocol.ping();
      } catch {
        finish(false);
      }
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
