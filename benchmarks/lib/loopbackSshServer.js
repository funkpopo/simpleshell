const path = require("node:path");
const { spawn } = require("node:child_process");
const { ROOT } = require("./env");

async function startLoopbackSshServer() {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "loopbackSshProcess.js")],
    { stdio: ["pipe", "pipe", "inherit"], cwd: ROOT },
  );

  const lines = [];
  const waiters = [];
  let buffer = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else lines.push(message);
    }
  });

  const next = () =>
    lines.length
      ? Promise.resolve(lines.shift())
      : new Promise((resolve) => waiters.push(resolve));

  const { port } = await next();

  return {
    port,
    config: {
      host: "127.0.0.1",
      port,
      username: "bench",
      password: "bench",
    },
    async stats() {
      child.stdin.write("stats\n");
      return (await next()).stats;
    },
    async close() {
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", resolve);
      });
    },
  };
}

module.exports = { startLoopbackSshServer };
