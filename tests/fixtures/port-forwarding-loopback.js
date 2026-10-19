const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const net = require("node:net");
const { once } = require("node:events");
const { Server, utils } = require("ssh2");

const HOST = "127.0.0.1";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, label, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < end, `Timed out: ${label}`);
    await delay(10);
  }
}

async function listen(server, port = 0, host = HOST) {
  server.listen(port, host);
  await once(server, "listening");
  return server.address().port;
}

function track(set, socket) {
  set.add(socket);
  socket.on("error", () => {});
  socket.once("close", () => set.delete(socket));
  return socket;
}

function bridge(socket, stream) {
  socket.on("error", () => stream.destroy());
  stream.on("error", () => socket.destroy());
  socket.on("close", () => stream.destroy());
  stream.on("close", () => socket.destroy());
  // ssh2 server Channel.end() sends CLOSE as well as EOF. Use protocol EOF
  // explicitly so this fixture models OpenSSH's independent TCP half-closes.
  socket.pipe(stream, { end: false });
  // Queue the EOF after all pending writes; sending it directly can overtake
  // bytes waiting for SSH window credit during the backpressure test.
  socket.on("end", () => stream.write(Buffer.alloc(0), () => stream.eof()));
  stream.pipe(socket);
}

async function createFixture(options = {}) {
  const { privateKey: suppliedKey, ...serverOptions } = options;
  const privateKey =
    suppliedKey ||
    crypto
      .generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs1", format: "pem" });
  const publicKey = utils.parseKey(privateKey).getPublicSSH();
  const password = crypto.randomBytes(24).toString("hex");
  const sockets = new Set();
  const clients = new Set();
  const listeners = new Set();
  const forwards = new Map();
  const state = {
    authAttempts: 0,
    directOpens: 0,
    remoteCancels: 0,
    hangAuth: false,
    handshakes: [],
  };
  const server = new Server(
    { hostKeys: [privateKey], ...serverOptions },
    (client) => {
      clients.add(client);
      client.on("handshake", (negotiated) => state.handshakes.push(negotiated));
      client.on("error", () => {});
      const owned = new Map();
      client.on("close", () => {
        clients.delete(client);
        for (const [key, listener] of owned) {
          listener.close();
          forwards.delete(key);
        }
      });
      client.on("authentication", (ctx) => {
        state.authAttempts++;
        if (state.hangAuth) return;
        if (state.authenticate) return state.authenticate(ctx);
        if (ctx.method === "none")
          return ctx.reject(["password", "publickey", "keyboard-interactive"]);
        if (ctx.username !== "prototype") return ctx.reject();
        if (ctx.method === "password" && ctx.password === password)
          return ctx.accept();
        if (ctx.method === "publickey" && ctx.key.data.equals(publicKey)) {
          if (
            !ctx.signature ||
            utils
              .parseKey(privateKey)
              .verify(ctx.blob, ctx.signature, ctx.hashAlgo)
          )
            return ctx.accept();
        }
        ctx.reject();
      });
      client.on("ready", () => {
        client.on("tcpip", (accept, reject, info) => {
          state.directOpens++;
          const socket = track(
            sockets,
            net.connect({
              host: info.destIP,
              port: info.destPort,
              allowHalfOpen: true,
            }),
          );
          socket.once("error", reject);
          socket.once("connect", () => {
            socket.removeListener("error", reject);
            bridge(socket, track(sockets, accept()));
          });
        });
        client.on("request", (accept, reject, name, info) => {
          if (name === "tcpip-forward") {
            const listener = net.createServer(
              { allowHalfOpen: true },
              (socket) => {
                track(sockets, socket);
                client.forwardOut(
                  info.bindAddr,
                  listener.address().port,
                  socket.remoteAddress,
                  socket.remotePort,
                  (error, stream) => {
                    if (error) return socket.destroy();
                    bridge(socket, track(sockets, stream));
                  },
                );
              },
            );
            listener.once("error", reject);
            listener.listen(info.bindPort, info.bindAddr, () => {
              const port = listener.address().port;
              const key = `${info.bindAddr}:${port}`;
              owned.set(key, listener);
              forwards.set(key, listener);
              accept(port);
            });
          } else if (name === "cancel-tcpip-forward") {
            const key = `${info.bindAddr}:${info.bindPort}`;
            const listener = owned.get(key);
            if (!listener) return reject();
            state.remoteCancels++;
            listener.close();
            owned.delete(key);
            forwards.delete(key);
            if (state.cancelReplyDelay) {
              setTimeout(() => {
                if (!client._sock.destroyed) accept();
              }, state.cancelReplyDelay).unref();
            } else accept();
          } else reject();
        });
      });
    },
  );
  const port = await listen(server);
  return {
    clients,
    forwards,
    sockets,
    state,
    ssh: {
      host: HOST,
      port,
      username: "prototype",
      password,
      expectedHostFingerprint: `SHA256:${crypto.createHash("sha256").update(publicKey).digest("hex")}`,
    },
    privateKey,
    async tcp(handler, host = HOST) {
      const listener = net.createServer({ allowHalfOpen: true }, (socket) =>
        handler(track(sockets, socket)),
      );
      listeners.add(listener);
      await listen(listener, 0, host);
      return listener;
    },
    async close() {
      for (const client of clients) client._sock.destroy();
      for (const socket of sockets) socket.destroy();
      for (const listener of [...listeners, ...forwards.values(), server])
        listener.close();
      await until(() => clients.size === 0, "SSH fixtures closed");
    },
  };
}

// A bounded, binary reader for deliberately fragmented/coalesced SOCKS tests.
class Peer {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.ended = false;
    this.closed = false;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 2 * 1024 * 1024)
        socket.destroy(new Error("fixture buffer limit"));
    });
    socket.on("end", () => {
      this.ended = true;
    });
    socket.on("close", () => {
      this.closed = true;
    });
  }
  static async connect(port, host = HOST) {
    const peer = new Peer(net.connect({ host, port, allowHalfOpen: true }));
    await once(peer.socket, "connect");
    return peer;
  }
  async read(length) {
    await until(
      () => this.buffer.length >= length || this.closed,
      `read ${length} bytes`,
    );
    assert.ok(this.buffer.length >= length, "unexpected EOF");
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }
  close() {
    this.socket.destroy();
  }
}

module.exports = { HOST, Peer, createFixture, delay, until, listen };
