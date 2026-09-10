const { loadTransferRuntime } = require("./sftp-transfer-runtime");
process.once("message", async (options) => {
  const runtime = loadTransferRuntime();
  let interrupted = false;
  const context = runtime.createRunner({
    ...options,
    onProgress: (bytes) => {
      if (options.interrupt && bytes >= 256 * 1024 && !interrupted) {
        interrupted = true;
        process.send({
          type: "checkpoint",
          pids: [...runtime.children].map((child) => child.pid),
        });
      }
    },
  });
  try {
    const result = await context.runner.run();
    process.send({
      type: "done",
      result,
      logs: runtime.logs.filter((line) => /^SFTP /.test(line)),
    });
  } catch (error) {
    process.send({ type: "error", error: error.stack });
  } finally {
    runtime.close();
    await context.pool.shutdown();
    process.disconnect();
  }
});
