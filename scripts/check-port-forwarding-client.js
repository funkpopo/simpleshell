const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  NativePortForwardingClient,
} = require("../src/main/native/nativePortForwardingClient");
const { until } = require("./fixtures/port-forwarding-loopback");

function client(mode) {
  return new NativePortForwardingClient({
    locate: () => process.execPath,
    startTimeout: 1000,
    requestTimeout: 100,
    spawn: (_binary, _args, options) =>
      spawn(
        process.execPath,
        [path.join(__dirname, "fixtures/port-forwarding-protocol.js"), mode],
        options,
      ),
  });
}
async function main() {
  for (const [mode, code] of [
    ["old", "SIDECAR_VERSION"],
    ["exit", "SIDECAR_VERSION"],
    ["broken", "PROTOCOL_ERROR"],
  ]) {
    const native = client(mode);
    try {
      await assert.rejects(native.ensureReady(), { code });
    } finally {
      await native.stop();
    }
    assert.equal(native.pending.size, 0);
  }
  console.log(
    "PASS old host, unsupported command/early exit and malformed ready reject startup and reap the process",
  );
  for (const [mode, code] of [
    ["stale", "PROTOCOL_ERROR"],
    ["oversize", "PROTOCOL_ERROR"],
    ["hang", "CONNECT_TIMEOUT"],
  ]) {
    const native = client(mode);
    try {
      await assert.rejects(
        native.request("removeRule", "tab", 1, { ruleId: "rule" }),
        { code },
      );
    } finally {
      await native.stop();
    }
    assert.equal(native.pending.size, 0);
  }
  console.log(
    "PASS response generation validation, stdout bound and request timeout terminate the transport",
  );
  const native = client("good");
  try {
    const response = await native.request("addRules", "tab", 1, {
      rules: [
        { id: "rule", type: "local", listenHost: "localhost", listenPort: 0 },
      ],
    });
    assert.equal(response.bindings[0].port, 32123);
    await assert.rejects(
      native.request("authResponse", "tab", 1, {
        answers: ["x".repeat(256 * 1024)],
      }),
      { code: "INVALID_CONFIG" },
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      native.request("start", "tab", 1, {}, { signal: controller.signal }),
      { code: "CANCELLED" },
    );
    await until(() => native.pending.size === 0, "all request entries settled");
  } finally {
    await native.stop();
  }
  console.log(
    "PASS fragmented NDJSON ready/results, oversized stdin rejection and cancellation before send",
  );
  const missing = new NativePortForwardingClient({ locate: () => null });
  await assert.rejects(missing.ensureReady(), { code: "SIDECAR_MISSING" });
  await missing.stop();
  console.log(
    "PASS missing native host fails explicitly without invoking Node forwarding",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
