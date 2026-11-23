// Isolated loopback SSH server process for terminal pipeline benchmarks.
// Protocol:
//   flood <bytes> [workload]   workload: logs | ansi | json | cjk_emoji | burst
//   stdin: "stats\n" -> emits {"stats": ...}
const crypto = require("node:crypto");
const { Server } = require("ssh2");

const PROMPT = "bench$ ";
const stats = { connections: 0, authentications: 0, shells: 0 };
const hostKey = crypto
  .generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" });

const LOG_LINES = [
  "2026-11-23 12:00:00 INFO [worker-3] GET https://api.example.internal/v1/items/42 200 OK status=200 from 192.168.1.20:54321 pid=4812 /var/log/simpleshell/app.log",
  "2026-11-23 12:00:01 WARN disk usage 91% on /var/lib/docker/overlay2/ab12cd34ef56 (threshold 90%) uuid=3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "2026-11-23 12:00:02 ERROR connection refused: dial tcp 10.0.0.5:5432 failed mac=00:1a:2b:3c:4d:5e commit=a1b2c3d4e5",
  "2026-11-23 12:00:03 DEBUG PATH=/usr/local/bin:/usr/bin port=8080 sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
];

const ANSI_LINES = [
  "\x1b[38;5;39m2026-11-23 12:00:00\x1b[0m \x1b[1;32mINFO\x1b[0m [\x1b[36mworker-1\x1b[0m] \x1b[38;2;255;165;0mGET /metrics\x1b[0m \x1b[93m200\x1b[0m \x1b[4m12.4ms\x1b[0m",
  "\x1b[38;5;196mERROR\x1b[0m \x1b[2;37mupstream timeout\x1b[0m \x1b[35m10.24.0.9:8443\x1b[0m \x1b[91mretry=2\x1b[0m \x1b[33mtrace=9f8e7d6c\x1b[0m",
];

const LONG_JSON_PAYLOAD = JSON.stringify({
  ts: "2026-11-23T12:00:00.123Z",
  level: "info",
  service: "edge-gateway",
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  host: "prod-node-07.internal",
  ip: "172.16.42.19",
  method: "POST",
  path: "/api/v2/sessions/bulk-sync",
  headers: {
    "user-agent": "SimpleShell-Bench/1.0",
    "x-forwarded-for": "198.51.100.14, 10.0.1.2",
    "content-type": "application/json; charset=utf-8",
  },
  items: Array.from({ length: 24 }, (_, idx) => ({
    id: `conn-${idx}`,
    host: `10.10.${idx % 16}.${(idx * 7) % 250}`,
    latencyMs: 12 + idx,
    tags: ["ssh", "prod", "region-ap-east"],
  })),
});

const CJK_EMOJI_LINES = [
  "2026-11-23 终端吞吐测试 中文日志输出 😀🚀🔥 系统状态=正常 服务器=节点一 [连接稳定] 传输速率=128MB/s",
  "告警测试：节点 ap-east-01 负载 0.85 ✅ 内存使用 48% 📊 用户=管理员 路径=/数据/备份/快照.tar.gz 🎉",
];

function buildWorkloadBlock(workload, targetBytes = 32 * 1024) {
  if (workload === "burst") {
    return Buffer.from(
      "2026-11-23 12:00:00 INFO burst chunk 10.0.0.1 ok 中文😀\r\n",
    );
  }

  let templates = LOG_LINES;
  if (workload === "ansi") templates = ANSI_LINES;
  else if (workload === "json") templates = [LONG_JSON_PAYLOAD];
  else if (workload === "cjk_emoji") templates = CJK_EMOJI_LINES;

  const chunks = [];
  let bytes = 0;
  let seq = 0;
  while (bytes < targetBytes) {
    const line = `${String(seq).padStart(7, "0")} ${templates[seq % templates.length]}\r\n`;
    chunks.push(line);
    bytes += Buffer.byteLength(line);
    seq += 1;
  }
  return Buffer.from(chunks.join(""));
}

function createPump(totalBytes, workload, write, done) {
  let sent = 0;
  if (workload === "burst") {
    const chunk = buildWorkloadBlock("burst");
    const step = () => {
      let burstWrites = 0;
      while (sent < totalBytes && burstWrites < 16) {
        const remaining = totalBytes - sent;
        const slice =
          remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
        sent += slice.length;
        burstWrites += 1;
        if (!write(slice)) {
          return false;
        }
      }
      if (sent >= totalBytes) {
        done(sent);
        return true;
      }
      setImmediate(step);
      return false;
    };
    return step;
  }

  const block = buildWorkloadBlock(workload, 32 * 1024);
  return () => {
    while (sent < totalBytes) {
      const remaining = totalBytes - sent;
      const slice =
        remaining >= block.length ? block : block.subarray(0, remaining);
      sent += slice.length;
      if (!write(slice)) {
        return false;
      }
    }
    done(sent);
    return true;
  };
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
            const match = /^flood\s+(\d+)(?:\s+([a-z0-9_]+))?$/.exec(command);
            if (!match) {
              stream.write(`${command}\r\n${PROMPT}`);
              continue;
            }
            busy = true;
            const total = Number(match[1]);
            const workload = match[2] || "logs";
            const pump = createPump(
              total,
              workload,
              (chunk) => stream.write(chunk),
              (sent) => {
                busy = false;
                stream.removeListener("drain", pump);
                stream.write(`\r\nBENCH-DONE ${sent}\r\n${PROMPT}`);
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
