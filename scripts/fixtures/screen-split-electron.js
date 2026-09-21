const { app, BrowserWindow, ipcMain } = require("electron");
const { Server, Client } = require("ssh2");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Sender, Receiver } = require("zmodem2");
const {
  ZmodemTransferService,
} = require("../../src/main/terminal/zmodemTransferService");
process.on("uncaughtException", (error) => {
  console.error("SCREEN_SPLIT FAIL", error.stack);
  app.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("SCREEN_SPLIT FAIL", error.stack);
  app.exit(1);
});
const output = process.argv[2];
app.setPath("userData", path.join(output, "electron-profile"));
const processes = new Map();
const channels = new Map();
const stats = {
  starts: {},
  closes: {},
  reconnects: 0,
  downloads: 0,
  uploads: 0,
};
let win;
let port;
let nextProcess = 100;
const payload = Buffer.from(
  "split-session ZMODEM payload 世界\n".repeat(12000),
);
const downloadRoot = path.join(output, "downloads");
fs.mkdirSync(downloadRoot, { recursive: true });
const uploadPath = path.join(output, "upload.txt");
fs.writeFileSync(uploadPath, payload);
const transfer = new ZmodemTransferService({
  getSaveRoot: () => downloadRoot,
  emitIpc: (data) => {
    if (["start", "end", "offer", "file-done"].includes(data.type))
      console.log("TRANSFER", JSON.stringify(data));
    if (!win.isDestroyed()) win.webContents.send("fixture-zmodem", data);
  },
  getMainWindow: () => null,
});
transfer._pickUploadFiles = async () => [uploadPath];
const server = new Server(
  {
    hostKeys: [
      generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
        type: "pkcs1",
        format: "pem",
      }),
    ],
  },
  (client) => {
    let name;
    client.on("error", () => {});
    client.on("authentication", (context) => {
      name = context.username;
      context.accept();
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (acceptPty) => acceptPty());
        session.on("window-change", (acceptResize) => acceptResize?.());
        session.on("shell", (acceptShell) => {
          const stream = acceptShell();
          channels.set(name, stream);
          let peer = null;
          let received = [];
          let offset = 0;
          let pumping = false;
          let pendingInput = Buffer.alloc(0);
          const pump = () => {
            if (!peer || pumping) return;
            pumping = true;
            setTimeout(() => {
              pumping = false;
              if (!peer) return;
              const outgoing = peer.drainOutgoing();
              if (outgoing.length) stream.write(Buffer.from(outgoing));
              let event;
              while ((event = peer.pollEvent())) {
                console.log("PEER", name, event);
                if (event === "FileComplete" && peer instanceof Sender)
                  peer.finishSession();
                if (event === "SessionComplete") {
                  if (peer instanceof Receiver) {
                    const tail = peer.drainFile();
                    if (tail?.length) received.push(Buffer.from(tail));
                    if (!Buffer.concat(received).equals(payload))
                      throw new Error("SSH ZMODEM upload bytes differ");
                    stats.uploads++;
                  } else stats.downloads++;
                  peer = null;
                  stream.write(`\r\n${name}:transfer-complete\r\n`);
                  return;
                }
              }
              if (peer instanceof Sender) {
                const request = peer.pollFile();
                if (request) {
                  offset = request.offset;
                  peer.feedFile(
                    payload.subarray(
                      offset,
                      Math.min(offset + request.len, payload.length),
                    ),
                  );
                  pump();
                }
              } else {
                const data = peer.drainFile();
                if (data?.length) received.push(Buffer.from(data));
              }
              if (
                pendingInput.length &&
                !peer.hasOutgoing() &&
                peer.state !== 7 &&
                (peer instanceof Receiver
                  ? !peer.hasFileData() && !peer.pendingEventsFull()
                  : peer.pendingRequest === null)
              ) {
                const consumed = peer.feedIncoming(pendingInput);
                pendingInput =
                  consumed > 0
                    ? pendingInput.subarray(consumed)
                    : Buffer.alloc(0);
              }
              pump();
            }, 8);
          };
          stream.on("data", (data) => {
            if (peer) {
              pendingInput = Buffer.concat([pendingInput, data]);
              pump();
              return;
            }
            const command = data.toString().trim();
            if (command === "fixture-download") {
              peer = new Sender(true);
              peer.startFile(
                `download-${name}-${Date.now()}.txt`,
                payload.length,
                Date.now(),
              );
              pump();
            } else if (command === "fixture-upload") {
              received = [];
              peer = new Receiver();
              pump();
            } else if (command === "fixture-cwd") {
              stream.write(`\x1b]7;file://loopback/sessions/${name}\x07`);
            } else stream.write(`\r\n${name}:${command}\r\n`);
          });
        });
      }),
    );
  },
);

const connect = async (tabId, processId = nextProcess++) => {
  const client = new Client();
  const record = { client, tabId, processId, stream: null, pending: [] };
  processes.set(processId, record);
  await new Promise((resolve, reject) => {
    client.once("error", reject);
    client.once("ready", () =>
      client.shell({ term: "xterm-256color" }, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        record.stream = stream;
        stream.on("data", (data) => {
          const visible = transfer.feedOutput(processId, data, {
            stream,
            tabId,
            sshConfig: { host: "127.0.0.1" },
            emitTerminalText: (text) =>
              win.webContents.send(`fixture-output-${processId}`, {
                type: "output",
                data: text,
              }),
          });
          if (visible?.length)
            win.webContents.send(`fixture-output-${processId}`, {
              type: "output",
              data: visible.toString(),
            });
        });
        resolve();
      }),
    );
    client.connect({
      host: "127.0.0.1",
      port,
      username: tabId,
      readyTimeout: 5000,
    });
  });
  return processId;
};

ipcMain.handle("fixture-start", async (_event, config) => {
  stats.starts[config.tabId] = (stats.starts[config.tabId] || 0) + 1;
  if (config.tabId === "late")
    await new Promise((resolve) => setTimeout(resolve, 300));
  return connect(config.tabId);
});
ipcMain.handle("fixture-mouse", (_event, event) => {
  win.webContents.sendInputEvent(event);
});
ipcMain.handle("fixture-capture", async (_event, name) => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid capture name");
  // A hidden window paints on capture; wait for that frame before saving it.
  await win.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    (await win.webContents.capturePage()).toPNG(),
  );
});
ipcMain.handle("fixture-kill", async (_event, id) => {
  const record = processes.get(id);
  if (!record) return;
  processes.delete(id);
  stats.closes[record.tabId] = (stats.closes[record.tabId] || 0) + 1;
  record.stream.close();
  record.client.end();
});
ipcMain.on("fixture-mailbox", (_event, id, message) => {
  const record = processes.get(id);
  if (!record) return;
  if (message.type === "input") record.stream.write(message.data);
  if (message.type === "resize")
    record.stream.setWindow(message.rows, message.cols, 0, 0);
});
ipcMain.handle("fixture-reconnect", async (_event, id) => {
  const record = processes.get(id);
  record.client.destroy();
  await connect(record.tabId, id);
  stats.reconnects++;
  return { tabId: record.tabId, processId: id };
});
ipcMain.handle("fixture-stats", () => ({
  ...stats,
  processCount: processes.size,
}));
ipcMain.handle("fixture-downloads", () =>
  fs
    .readdirSync(downloadRoot)
    .filter((name) => name.endsWith(".txt"))
    .every((name) =>
      fs.readFileSync(path.join(downloadRoot, name)).equals(payload),
    ),
);
ipcMain.on("fixture-result", async (_event, result) => {
  console.log("SCREEN_SPLIT " + JSON.stringify(result));
  if (result.success)
    fs.writeFileSync(
      path.join(output, "render.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
  for (const record of processes.values()) record.client.end();
  server.close();
  app.exit(result.success ? 0 : 1);
});
app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (_event, _level, message) => {
    if (/Error|FAIL/.test(message)) console.error(message);
  });
  await win.loadFile(path.join(output, "index.html"));
});
