const readline = require("node:readline");
const mode = process.argv[2];
const ready = {
  schemaVersion: mode === "old" ? 0 : 1,
  kind: "ready",
  prototype: false,
  capabilities: [
    "local",
    "remote",
    "socks5",
    "addRules",
    "removeRule",
    "keyboardInteractive",
    "agent",
    "connections",
  ],
};
if (mode === "exit") process.exit(1);
if (mode === "broken") process.stdout.write("{invalid}\n");
else {
  const line = `${JSON.stringify(ready)}\n`;
  process.stdout.write(line.slice(0, 13));
  setTimeout(() => process.stdout.write(line.slice(13)), 10);
}
readline
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const request = JSON.parse(line);
    if (mode === "hang") return;
    if (mode === "oversize")
      return process.stdout.write("x".repeat(600 * 1024));
    const response = {
      schemaVersion: 1,
      kind: "result",
      requestId: request.requestId,
      sessionId: request.sessionId,
      generation:
        mode === "stale" ? request.generation + 1 : request.generation,
      bindings: (request.rules || []).map((r) => ({
        id: r.id,
        type: r.type,
        host: r.listenHost,
        port: r.listenPort || 32123,
      })),
    };
    const output = `${JSON.stringify(response)}\n`;
    process.stdout.write(output.slice(0, 5));
    setTimeout(() => process.stdout.write(output.slice(5)), 5);
  })
  .on("close", () => process.exit(0));
