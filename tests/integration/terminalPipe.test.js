import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
for (const [name, exports] of [
  ["logger", { logToFile: () => {} }],
  ["crashReporter", { recordCrashMarker: () => {} }],
]) {
  const filename = require.resolve(`../../src/main/utils/${name}`);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const {
  NativeSshClient,
} = require("../../src/main/connection/native/nativeSshClient");
const {
  shutdownCoreSupervisors,
} = require("../../src/main/native/coreSupervisor");
const TerminalIOMailboxManager = require("../../src/main/terminal/terminalIOMailboxManager");
const {
  ZmodemTransferService,
} = require("../../src/main/terminal/zmodemTransferService");
const outputProcessor = require("../../src/main/terminal/output-processor");
const highlightRules = require("../../src/shared/domain/highlight-configs");
const { nativeHostPath } = require("../helpers/nativeHost");
const { createSshShellServer } = require("../fixtures/ssh-shell-server");

async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openPipe(client, pipe = { rules: highlightRules }) {
  return new Promise((resolve, reject) =>
    client.shell(
      { term: "xterm-256color", cols: 120, rows: 30 },
      { pipe },
      (error, stream) => (error ? reject(error) : resolve(stream)),
    ),
  );
}

function collect(stream) {
  const state = { text: "", editorMode: [] };
  stream.on("data", (chunk) => {
    state.text += chunk.toString("utf8");
  });
  stream.on("editorMode", (active) => state.editorMode.push(active));
  return state;
}

describe("terminal pipe channels (output processed in simpleshell-core)", () => {
  let server;
  let client;
  let dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-pipe-"));
    server = await createSshShellServer({ zmodemHost: nativeHostPath() });
    client = new NativeSshClient();
    client.connect({
      host: "127.0.0.1",
      port: server.port,
      username: "tester",
      password: "secret",
      hostHash: "sha256",
      hostVerifier: (_hash, callback) => callback(true),
    });
    await once(client, "ready");
  });

  afterAll(async () => {
    client?.end();
    await shutdownCoreSupervisors();
    await server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("delivers highlighted terminal text and editor-mode changes", async () => {
    const stream = await openPipe(client);
    expect(stream.pipeMode).toBe(true);
    const state = collect(stream);
    await waitFor(() => state.text.includes("$ "));
    state.text = "";

    const line = "error at 10.0.0.1:22 中文😀 pid=42";
    stream.write(`${line}\n`);
    const expected = outputProcessor.applySyntaxHighlighting(`${line}\r\n$ `);
    await waitFor(() => state.text.length >= expected.length);
    expect(state.text).toBe(expected);

    stream.write("vim notes.txt\n");
    await waitFor(() => state.editorMode.length > 0);
    expect(state.editorMode).toEqual([true]);
    stream.close();
    await once(stream, "close");
  });

  it("is flow-controlled by renderer ACKs relayed through the mailbox", async () => {
    let delivered = 0;
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: (_channel, payload) => {
          for (const message of [].concat(payload)) {
            delivered += Buffer.byteLength(message.data, "utf8");
          }
        },
      },
    };
    const mailboxes = new TerminalIOMailboxManager({
      getMainWindow: () => window,
    });
    // Unhighlighted, so text bytes equal channel bytes.
    const stream = await openPipe(client, {});
    const id = 9001;
    mailboxes.createMailbox(id, {
      remoteFlow: {
        ack: (bytes) => stream.grantCredit(bytes),
        pause: (reason) => stream.pauseFor(reason),
        resume: (reason) => stream.resumeFor(reason),
      },
    });
    let text = "";
    stream.on("data", (chunk) => {
      text += chunk.toString("utf8");
      mailboxes.emitOutput(id, chunk.toString("utf8"));
    });
    await waitFor(() => text.includes("$ "));

    const FLOOD = 4 * 1024 * 1024;
    stream.write(`flood ${FLOOD}\n`);
    await sleep(600);
    // Without ACKs the core stops at its credit (the mailbox threshold).
    const stalled = delivered;
    expect(stalled).toBeLessThan(768 * 1024);
    expect(text.includes("DONE")).toBe(false);

    // A renderer pause holds the stream even with ACKs.
    mailboxes.pause(id, "renderer");
    mailboxes.handleAck(id, delivered);
    await sleep(300);
    expect(delivered - stalled).toBeLessThan(64 * 1024);

    mailboxes.resume(id, "renderer");
    let acked = stalled;
    while (!text.includes("DONE")) {
      await sleep(5);
      mailboxes._flushOutputBatch(mailboxes._getMailbox(id));
      if (delivered > acked) {
        mailboxes.handleAck(id, delivered - acked);
        acked = delivered;
      }
    }
    // The first prompt, then every flooded byte once, in order.
    expect(text.indexOf("DONE")).toBe("$ ".length + FLOOD);
    mailboxes.destroyProcess(id);
    stream.close();
    await once(stream, "close");
  });

  it("runs sz and rz inside the stream with the transfer service", async () => {
    const events = [];
    const notices = [];
    const saveRoot = path.join(dir, "saved");
    fs.mkdirSync(saveRoot);
    const service = new ZmodemTransferService({
      getSaveRoot: () => saveRoot,
      emitIpc: (event) => events.push(event),
    });
    const upload = path.join(dir, "upload 上传.bin");
    const uploadBytes = crypto.randomBytes(200 * 1024 + 11);
    fs.writeFileSync(upload, uploadBytes);
    service._pickUploadFiles = async () => [upload];

    const stream = await openPipe(client);
    const state = collect(stream);
    const detach = service.attachChannel("pipe-zmodem", stream, {
      tabId: "pipe-tab",
      sshConfig: {},
      emitTerminalText: (text) => notices.push(text),
    });
    await waitFor(() => state.text.includes("$ "));
    const ends = () => events.filter((event) => event.type === "end");

    // Download: the remote sz is detected and received in the core.
    const source = path.join(dir, "download 下载.bin");
    const sourceBytes = crypto.randomBytes(300 * 1024 + 5);
    fs.writeFileSync(source, sourceBytes);
    stream.write(`sz ${source}\n`);
    await waitFor(() => ends().length === 1);
    expect(ends()[0]).toMatchObject({
      status: "complete",
      direction: "download",
    });
    await waitFor(() => plain(state.text).includes("sz done"));
    const saved = fs.readFileSync(path.join(saveRoot, "download 下载.bin"));
    expect(saved.equals(sourceBytes)).toBe(true);
    // Protocol bytes never reached the terminal.
    expect(state.text.includes("\u0018B0")).toBe(false);

    // Upload: the remote rz asks for files.
    const received = path.join(dir, "received");
    fs.mkdirSync(received);
    stream.write(`rz ${received}\n`);
    await waitFor(() => ends().length === 2);
    expect(ends()[1]).toMatchObject({
      status: "complete",
      direction: "upload",
    });
    const digest = crypto
      .createHash("sha256")
      .update(uploadBytes)
      .digest("hex");
    await waitFor(() =>
      plain(state.text).includes(
        `rz upload 上传.bin ${uploadBytes.length} ${digest}`,
      ),
    );
    expect(notices.length).toBeGreaterThan(0);

    // Detection resumes afterwards.
    stream.write("still here\n");
    await waitFor(() => plain(state.text).includes("still here"));
    detach();
    service.destroyAll();
    stream.close();
    await once(stream, "close");
  });
});
