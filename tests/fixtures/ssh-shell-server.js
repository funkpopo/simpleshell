const crypto = require("node:crypto");
const { Server, utils } = require("ssh2");

/**
 * Loopback SSH server for terminal-client tests.
 *
 * Auth: password `secret`, or keyboard-interactive answering `123456` for the
 * prompt `Code: `. Shells print `$ `, echo each line, and treat `exit <n>`
 * as exit status n. Exec prints `ran:<command>` and exits 0. Requests are
 * recorded in `events`.
 */
async function createSshShellServer() {
  const hostKey = crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs1", format: "pem" });
  const publicKey = utils.parseKey(hostKey).getPublicSSH();
  const fingerprintHex = crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex");
  const events = [];
  const clients = new Set();
  const stats = { connections: 0 };

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    stats.connections += 1;
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", (context) => {
      if (context.method === "password" && context.password === "secret") {
        events.push({ type: "auth", method: "password" });
        return context.accept();
      }
      if (context.method === "keyboard-interactive") {
        return context.prompt(
          [{ prompt: "Code: ", echo: false }],
          "otp",
          "Enter your one-time code",
          (answers) => {
            if (answers[0] === "123456") {
              events.push({ type: "auth", method: "keyboard-interactive" });
              context.accept();
            } else context.reject();
          },
        );
      }
      context.reject(["password", "keyboard-interactive"]);
    });
    client.on("ready", () =>
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        session.on("pty", (accept, _reject, info) => {
          events.push({
            type: "pty",
            term: info.term,
            cols: info.cols,
            rows: info.rows,
          });
          accept?.();
        });
        session.on("window-change", (accept, _reject, info) => {
          events.push({
            type: "window-change",
            cols: info.cols,
            rows: info.rows,
          });
          accept?.();
        });
        session.on("env", (accept, _reject, info) => {
          events.push({ type: "env", key: info.key, val: info.val });
          accept?.();
        });
        session.on("exec", (accept, _reject, info) => {
          const stream = accept();
          stream.write(`ran:${info.command}\n`);
          stream.stderr.write("exec-stderr\n");
          stream.exit(0);
          stream.end();
        });
        session.on("shell", (accept) => {
          const stream = accept();
          stream.on("error", () => {});
          stream.write("$ ");
          let input = "";
          stream.on("data", (data) => {
            input += data.toString("utf8");
            let index;
            while ((index = input.indexOf("\n")) >= 0) {
              const line = input.slice(0, index).trim();
              input = input.slice(index + 1);
              const exit = /^exit (\d+)$/.exec(line);
              if (exit) {
                stream.exit(Number(exit[1]));
                stream.end();
                return;
              }
              stream.write(`${line}\r\n$ `);
            }
          });
        });
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    fingerprintHex,
    events,
    stats,
    /** Drops every client connection, as a network failure would. */
    sever() {
      for (const client of clients) client.end();
    },
    async close() {
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createSshShellServer };
