const { app, BrowserWindow, ipcMain } = require("electron");
const { Server, Client } = require("ssh2");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ZmodemPeer, buildZrinitFrame } = require("./zmodem-peer");
const {
  getNativeServicesHostPath,
} = require("../../src/main/native/nativeServices");
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
          // ZMODEM 对端：第二个 zmodem-serve 实例（模拟远端 rz/sz）。
          // 字节穿梭是事件直驱：SSH 流字节 feed 给对端，对端 writeRemote
          // 直接写回 SSH 流；无轮询泵，避开 Windows 定时器粒度钳制。
          let peer = null;
          const runPeer = (task) =>
            task().catch((error) => {
              console.error("SCREEN_SPLIT FAIL", error.stack);
              app.exit(1);
            });
          const startPeer = async () => {
            const instance = new ZmodemPeer(
              getNativeServicesHostPath(),
              `peer-${name}`,
            );
            await instance.ready;
            instance.open();
            instance.onWire = (bytes) => stream.write(bytes);
            return instance;
          };
          const finishPeer = async (ev, role) => {
            if (ev.kind !== "done")
              throw new Error(`fixture ${role} failed: ${ev.kind}`);
            stats[role === "download" ? "downloads" : "uploads"]++;
            await peer.close();
            peer = null;
            stream.write(`\r\n${name}:transfer-complete\r\n`);
          };
          stream.on("close", () => {
            if (peer) {
              peer.close();
              peer = null;
            }
          });
          stream.on("data", (data) => {
            if (peer) {
              peer.feed(data);
              return;
            }
            const command = data.toString().trim();
            if (command === "fixture-download") {
              runPeer(async () => {
                peer = await startPeer();
                // 触发对端发送：手工 ZRINIT（rz 启动序列）+ 授予文件清单
                peer.feed(buildZrinitFrame());
                peer.sendFiles([
                  {
                    path: uploadPath,
                    name: `download-${name}-${Date.now()}.txt`,
                    size: payload.length,
                  },
                ]);
                await finishPeer(await peer.waitDone(60000), "download");
              });
            } else if (command === "fixture-upload") {
              runPeer(async () => {
                peer = await startPeer();
                const savePath = path.join(
                  output,
                  `upload-${name}-${Date.now()}.bin`,
                );
                peer.onOffer = () => savePath;
                // 模拟 rz 启动序列：主动写入 SSH 流，触发应用侧上传状态机
                stream.write(buildZrinitFrame());
                const ev = await peer.waitDone(60000);
                if (ev.kind !== "done")
                  throw new Error(`fixture upload failed: ${ev.kind}`);
                if (!fs.readFileSync(savePath).equals(payload))
                  throw new Error("SSH ZMODEM upload bytes differ");
                fs.rmSync(savePath, { force: true });
                stats.uploads++;
                await peer.close();
                peer = null;
                stream.write(`\r\n${name}:transfer-complete\r\n`);
              });
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
        const emitOutput = (text) =>
          win.webContents.send(`fixture-output-${processId}`, {
            type: "output",
            data: text,
          });
        stream.on("data", (data) => {
          // native 后端：透传字节经 onRawOutput 回调进入终端（与
          // sshHandlers 的真实集成一致）；feedOutput 同步返回恒为空
          const visible = transfer.feedOutput(processId, data, {
            stream,
            tabId,
            sshConfig: { host: "127.0.0.1" },
            emitTerminalText: emitOutput,
            onRawOutput: (raw) => emitOutput(raw.toString("utf8")),
          });
          if (visible?.length) emitOutput(visible.toString());
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
