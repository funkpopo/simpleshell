// Transport liveness checks on top of `NativeSshClient.checkTransport`: the
// core answers from a keepalive reply or recent channel traffic. Concurrent
// checks of one client share a probe, and a pending check can be cancelled
// (resolving `null`, "unknown") when the client is replaced or closed.
class SshTransportHealth {
  constructor({ timeoutMs = 10000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  /** Resolves true (alive), false (dead) or null (unknown / cancelled). */
  check(client) {
    if (typeof client?.checkTransport !== "function") {
      return Promise.resolve(null);
    }
    const pending = this.pending.get(client);
    if (pending) return pending.promise;
    let cancel;
    const promise = Promise.race([
      client.checkTransport(this.timeoutMs),
      new Promise((resolve) => {
        cancel = () => resolve(null);
      }),
    ]).finally(() => this.pending.delete(client));
    this.pending.set(client, { promise, cancel });
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
