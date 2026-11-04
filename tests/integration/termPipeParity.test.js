import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";

const require = createRequire(import.meta.url);
for (const [name, exports] of [["logger", { logToFile: () => {} }]]) {
  const filename = require.resolve(`../../src/main/utils/${name}`);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { nativeHostPath } = require("../helpers/nativeHost");
// The former main-process highlighter and OSC filter, kept as references.
const outputProcessor = require("../helpers/referenceHighlighter");
const highlightRules = require("../../src/shared/domain/highlight-configs");
const { createOscSafeOutputTransform } = require("../helpers/oscSafeOutput");

/** Runs samples through the core's `highlight-text` service. */
async function rustOutputs(rules, requests) {
  const child = spawn(nativeHostPath(), ["highlight-text"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stdin.write(`${JSON.stringify({ rules })}\n`);
  for (const request of requests) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  child.stdin.end();
  const [code] = await once(child, "close");
  expect(code).toBe(0);
  return Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).output);
}

function corpus() {
  const samples = [
    "commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f merged",
    "container 0123456789ab started; image sha256:" + "ab".repeat(32),
    "id=550e8400-e29b-41d4-a716-446655440000 ok",
    "link fe80::1%eth0 and 2001:db8::ff00:42:8329 and ::ffff:192.168.1.1",
    "1:2:3:4:5:6:7:8 abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    "12:00:01 aa:bb:cc:dd:ee:ff deadbeef-cafe",
    "\u001b[1m   \u001b[0m \r\n\t \u001b[31merror\u001b[0m  ~/x /tmp/a",
    'C:\\Users\\dev\\app.log and \\\\server\\share "GET / HTTP/1.1" 200 512',
    "export PATH=/usr/bin HOME='/root' echo $HOME ${USER} pid=4321 listening on port 8080",
    "HTTP/1.1 404 exit code 2 status: 500 https://example.com/a?b=c www.test.org",
    "\u001b[38;5;196mred\u001b[m \u001b[1;mbold\u001b[22m plain error",
    "\u001b[" + "9".repeat(400) + "m overflow error \u001b[0;0;0m reset error",
    "中文error 错误 WARN 失败 failed 192.168.0.1 端口 port 22 😀 ok",
    "root@box-a1b2c3d4:~# ls\r\n\u001b]0;root@box-a1b2c3d4: ~\u0007prompt $& $1 $` $'",
    "\u001b]8;;https://example.com\u001b\\link error\u001b]8;;\u001b\\ after",
    "2026-10-25 12:00:01 INFO [worker-3] GET /api/v1 200 OK in 35ms from 10.0.0.5:443",
    "vim /etc/hosts && less /var/log/syslog && cat ~/.bashrc",
  ];
  let seed = 7;
  const random = (limit) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % limit;
  };
  const alphabet =
    '0123456789abcdefABCDEFxyz:::---..  /~=$_"\\\r\n\u001b[m;中😀\u001b]\u0007';
  for (let round = 0; round < 1500; round++) {
    let text = "";
    const length = 1 + random(120);
    for (let index = 0; index < length; index++) {
      text += [...alphabet][random([...alphabet].length)];
    }
    samples.push(text);
  }
  const tokens = [
    "error",
    "WARN",
    "failed",
    "ok",
    "GET",
    "pid",
    "pid=",
    "port",
    "listening on",
    "status",
    "HTTP/1.1",
    "exit code",
    "sha256:",
    "a".repeat(64),
    "deadbeef",
    "0123456789ab",
    "3f2a9c1",
    "550e8400-e29b-41d4-a716-446655440000",
    "192.168.1.10",
    "10.0.0.1:22",
    "fe80::1",
    "2001:db8::8329",
    "aa:bb:cc:dd:ee:ff",
    "12:00:01",
    "2026-10-25",
    "2026-10-25 12:00:01",
    "https://x.io/p",
    "www.a.b",
    "/var/log/a.log",
    "~/x",
    "./run.sh",
    "C:\\tmp\\a",
    "\\\\srv\\s",
    "$HOME",
    "${PATH}",
    "FOO=bar",
    'A="b c"',
    '"GET / HTTP/1.1" 200 12',
    "1234",
    "42",
    "\u001b[31m",
    "\u001b[38:5:1m",
    "\u001b[1 m",
    "\u001b[;m",
    "\u001b[0m",
    "\u001b[1;32m",
    "\u001b[m",
    "\u001b[22m",
    "\u001b[K",
    "\u001b]0;title\u0007",
    "@host-abcdef12:",
    "中文",
    "😀",
    " ",
    "  ",
    "\r\n",
    "\t",
    "=",
    ":",
    "-",
    ".",
    "/",
    '"',
    "(",
    "'",
  ];
  for (let round = 0; round < 1500; round++) {
    let text = "";
    const count = 1 + random(24);
    for (let index = 0; index < count; index++) {
      text += tokens[random(tokens.length)];
      if (random(3) === 0) text += " ";
    }
    samples.push(text);
  }
  samples.push(
    Array.from(
      { length: 2000 },
      (_, row) =>
        `${row} 2026-10-25 12:00:${String(row % 60).padStart(2, "0")} error 10.0.${row % 255}.1 pid=${row} 中文😀`,
    ).join("\r\n"),
  );
  return samples;
}

describe("term-pipe parity with the former main-process output path", () => {
  it("highlights exactly like the reference highlighter", async () => {
    const samples = corpus();
    const rust = await rustOutputs(
      highlightRules,
      samples.map((text) => ({ text })),
    );
    const mismatches = samples
      .map((sample, index) => ({
        sample,
        expected: outputProcessor.applySyntaxHighlighting(sample),
        actual: rust[index],
      }))
      .filter(({ expected, actual }) => expected !== actual);
    expect(mismatches.slice(0, 3)).toEqual([]);
  });

  it("matches the reference OSC-safe streaming pipeline", async () => {
    const samples = corpus();
    const rust = await rustOutputs(
      highlightRules,
      samples.map((text) => ({ text, mode: "pipe" })),
    );
    const mismatches = samples
      .map((sample, index) => {
        const transform = createOscSafeOutputTransform((text) =>
          outputProcessor.applySyntaxHighlighting(text),
        );
        return {
          sample,
          // As the main process streamed: the chunk, then the final flush.
          expected: transform(sample, false) + transform("", true),
          actual: rust[index],
        };
      })
      .filter(({ expected, actual }) => expected !== actual);
    expect(mismatches.slice(0, 3)).toEqual([]);
  });

  it("validates rules, falling back to fancy-regex for lookaround", async () => {
    const child = spawn(nativeHostPath(), ["highlight-validate"], {
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stdin.end(
      JSON.stringify([
        ...highlightRules,
        { type: "regex", enabled: true, pattern: "(?<=\\$)\\w+" },
        { type: "regex", enabled: true, pattern: "([a-z]" },
      ]),
    );
    await once(child, "close");
    const checks = JSON.parse(output);
    expect(
      checks.slice(0, highlightRules.length).every((check) => check.valid),
    ).toBe(true);
    expect(checks.at(-2)).toMatchObject({ valid: true, engine: "fancy-regex" });
    expect(checks.at(-1)).toMatchObject({ valid: false });
  });
});
