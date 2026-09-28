// Separate server and traffic processes keep their CPU work out of the measured main process.
const crypto = require("node:crypto");
const net = require("node:net");
const { once } = require("node:events");
const { createFixture } = require("./port-forwarding-loopback");

process.on("message", async (message) => {
  try {
    if (message.kind === "server") {
      const fixture = await createFixture();
      const target = await fixture.tcp((socket) => {
        const digest = crypto.createHash("sha256");
        socket.on("data", (chunk) => digest.update(chunk));
        socket.on("end", () => socket.end(digest.digest("hex")));
      });
      process.send({ ssh: fixture.ssh, targetPort: target.address().port });
      process.once("disconnect", async () => {
        await fixture.close();
        process.exit(0);
      });
    } else if (message.kind === "traffic") {
      const socket = net.connect(message.port, [127, 0, 0, 1].join("."));
      socket.on("error", (error) => {
        throw error;
      });
      let result = "";
      socket.on("data", (chunk) => {
        result += chunk;
      });
      const ended = once(socket, "end");
      await once(socket, "connect");
      const block = Buffer.alloc(64 * 1024, 0x6d);
      const digest = crypto.createHash("sha256");
      for (let sent = 0; sent < message.bytes; sent += block.length) {
        digest.update(block);
        if (!socket.write(block)) await once(socket, "drain");
      }
      socket.end();
      await ended;
      if (result !== digest.digest("hex"))
        throw new Error("benchmark digest mismatch");
      process.send({ bytes: message.bytes, verified: true });
      process.disconnect();
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
});
