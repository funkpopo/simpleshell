// Loopback SSH shell server for benchmarks. It runs in its own process so the
// server's encryption work does not pollute the measured client event loop.
//
// Shell protocol (typed into the session):
//   flood <bytes>\n  -> streams <bytes> of log-like Unicode text, then "PERF-DONE <bytes>\r\n" and a prompt
//   anything else    -> echoed, followed by a prompt
// stdout reports {"port":N} once listening and {"stats":{...}} on "stats\n" from stdin.
const crypto = require("node:crypto");
const { Server } = require("ssh2");

const PROMPT = "perf$ ";
const stats = { connections: 0, authentications: 0, shells: 0, execs: 0 };
const hostKey = crypto
  .generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" });

const LINE_TEMPLATES = [
  "2026-11-03 12:00:00 INFO [worker-3] GET /api/v1/items 200 OK in 35ms from 192.168.1.20 中文😀",
  "2026-11-03 12:00:01 WARN disk usage 91% on /var/lib/docker (threshold 90%)",
  "2026-11-03 12:00:02 ERROR connection refused: dial tcp 10.0.0.5:5432 failed",
  "drwxr-xr-x  2 root root 4096 Nov  3 12:00 /usr/local/bin/simpleshell",
  "uuid=3f2504e0-4f89-11d3-9a0c-0305e82c3301 mac=00:1a:2b:3c:4d:5e status=success",
];

function floodText(totalBytes, write, done) {
  let sent = 0;
  let row = 0;
  const pump = () => {
    while (sent < totalBytes) {
      const lines = [];
      let size = 0;
      while (size < 32 * 1024 && sent + size < totalBytes) {
        const line = `${String(row).padStart(8, "0")} ${LINE_TEMPLATES[row % LINE_TEMPLATES.length]}\r\n`;
        row += 1;
        lines.push(line);
        size += Buffer.byteLength(line);
      }
      const chunk = Buffer.from(lines.join(""));
      sent += chunk.length;
      if (!write(chunk)) {
        return false;
      }
    }
    done(sent);
    return true;
  };
  return pump;
}

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  stats.connections += 1;
  client.on("error", () => {});
  client.on("authentication", (context) => {
    stats.authentications += 1;
    context.accept();
  });
  client.on("request", (accept, reject, name) => {
    if (name === "keepalive@openssh.com") accept?.();
    else reject?.();
  });
  client.on("ready", () =>
    client.on("session", (acceptSession) => {
      const session = acceptSession();
      session.on("pty", (accept) => accept?.());
      session.on("window-change", (accept) => accept?.());
      session.on("env", (accept) => accept?.());
      session.on("exec", (accept, _reject, info) => {
        stats.execs += 1;
        const stream = accept();
        stream.end(`exec:${info.command}\n`);
        stream.exit(0);
      });
      session.on("shell", (accept) => {
        stats.shells += 1;
        const stream = accept();
        stream.on("error", () => {});
        stream.write(PROMPT);
        let input = "";
        let busy = false;
        stream.on("data", (data) => {
          input += data.toString("utf8");
          let newline;
          while (!busy && (newline = input.indexOf("\n")) >= 0) {
            const command = input.slice(0, newline).trim();
            input = input.slice(newline + 1);
            const flood = /^flood (\d+)$/.exec(command);
            if (!flood) {
              stream.write(`${command}\r\n${PROMPT}`);
              continue;
            }
            busy = true;
            const pump = floodText(
              Number(flood[1]),
              (chunk) => stream.write(chunk),
              (sent) => {
                busy = false;
                stream.removeListener("drain", pump);
                stream.write(`PERF-DONE ${sent}\r\n${PROMPT}`);
              },
            );
            stream.on("drain", pump);
            pump();
          }
        });
      });
    }),
  );
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (text) => {
  if (text.includes("stats")) {
    process.stdout.write(`${JSON.stringify({ stats })}\n`);
  }
});
process.stdin.on("end", () => process.exit(0));
