/**
 * ZMODEM 测试对端：以第二个 zmodem-serve 实例模拟远端 rz/sz。
 *
 * 用于 scripts/check-zmodem-sidecar.js 与 scripts/fixtures/screen-split-electron.js，
 * 替代原 npm zmodem2 依赖（已从 devDependencies 移除）：
 * - 发送角色（模拟 sz）：feed(buildZrinitFrame()) 注入手工构造的 ZRINIT
 *   触发帧（zmodem-serve 的发送状态机由输入流中的 ZRINIT 检测启动），
 *   随后 sendFiles() 授予文件，对端即按协议自发完成 ZRQINIT/ZFILE/数据/ZFIN。
 * - 接收角色（模拟 rz）：设置 onOffer 返回批准路径（或手工 acceptFile），
 *   对端检测到 ZRQINIT 后自发应答 ZRINIT 并完成接收。
 * - 字节穿梭由调用方完成：对端 writeRemote 经 onWire 回调交给调用方写入
 *   被测侧；被测侧写往远端的字节经 feed() 交给对端。
 *
 * wireAck 无需回送：sidecar 对 writeRemote 采用即时确认模型。
 */

const { spawn } = require("node:child_process");

/** sidecar maxInputChunkBytes 上限（见 zmodem/mod.rs 与 ready 消息） */
const MAX_INPUT_CHUNK_BYTES = 64 * 1024;

/** CRC16-XMODEM：ZMODEM 十六进制帧头校验 */
function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * 手工构造 ZRINIT 十六进制帧（rz 启动序列）：buffer=8192，
 * caps=CANFDX|CANOVIO|CANBRK|CANFC32。帧尾 CR LF XON 与 lrzsz 一致。
 */
function buildZrinitFrame() {
  const payload = [0x01, 0x00, 0x20, 0x27, 0x00];
  const hex =
    payload.map((b) => b.toString(16).padStart(2, "0")).join("") +
    crc16Xmodem(payload).toString(16).padStart(4, "0");
  return Buffer.concat([
    Buffer.from([42, 42, 24, 66]),
    Buffer.from(hex, "latin1"),
    Buffer.from([13, 10, 17]),
  ]);
}

class ZmodemPeer {
  /**
   * @param {string} hostPath simpleshell-native-services 二进制路径
   * @param {string} sessionId 对端会话 ID（同一进程内唯一）
   */
  constructor(hostPath, sessionId = "peer") {
    this.sessionId = sessionId;
    this.messages = [];
    this.stderrText = "";
    this.onWire = null; // (bytes: Buffer) => void，writeRemote 字节
    this.onPassthrough = null; // (bytes: Buffer) => void，干净回环中应为空
    this.onOffer = null; // async (offer) => string，返回批准的保存路径
    this._waiters = [];
    this._lineBuffer = "";
    this._closed = false;

    this.child = spawn(hostPath, ["zmodem-serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.on("error", (error) => this._failAll(error));
    this.child.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderrText += chunk.toString("utf8");
    });

    this.ready = this.waitFor(
      (m) => m.type === "ready",
      10000,
      "timeout waiting for peer ready",
    );
  }

  _onStdout(chunk) {
    this._lineBuffer += chunk.toString("utf8");
    const lines = this._lineBuffer.split(/\r?\n/);
    this._lineBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      this.messages.push(message);
      if (
        message.type === "writeRemote" &&
        message.sessionId === this.sessionId &&
        this.onWire
      ) {
        this.onWire(Buffer.from(message.dataBase64, "base64"));
      }
      if (
        message.type === "passthrough" &&
        message.sessionId === this.sessionId &&
        this.onPassthrough
      ) {
        this.onPassthrough(Buffer.from(message.dataBase64, "base64"));
      }
      if (
        message.type === "event" &&
        message.sessionId === this.sessionId &&
        message.kind === "offer" &&
        this.onOffer
      ) {
        Promise.resolve(this.onOffer(message))
          .then((path) => {
            if (path) this.acceptFile(path);
          })
          .catch(() => {});
      }
      for (let i = this._waiters.length - 1; i >= 0; i -= 1) {
        if (this._waiters[i].predicate(message)) {
          this._waiters[i].resolve(message);
          this._waiters.splice(i, 1);
        }
      }
    }
  }

  _failAll(error) {
    for (const waiter of this._waiters.splice(0)) waiter.reject(error);
  }

  waitFor(predicate, timeoutMs = 10000, label = "timeout waiting for peer") {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { predicate, resolve, reject };
      this._waiters.push(entry);
      setTimeout(() => {
        const index = this._waiters.indexOf(entry);
        if (index !== -1) {
          this._waiters.splice(index, 1);
          reject(
            new Error(`${label} (stderr: ${this.stderrText.slice(-300)})`),
          );
        }
      }, timeoutMs);
    });
  }

  _send(message) {
    if (this._closed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** 注册会话（检测模式） */
  open() {
    this._send({ type: "open", sessionId: this.sessionId });
  }

  /** 投递被测侧写往远端的字节（按 sidecar 输入上限分块） */
  feed(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    for (let i = 0; i < buffer.length; i += MAX_INPUT_CHUNK_BYTES) {
      this._send({
        type: "input",
        sessionId: this.sessionId,
        dataBase64: buffer
          .subarray(i, i + MAX_INPUT_CHUNK_BYTES)
          .toString("base64"),
      });
    }
  }

  /** 发送角色：授予文件清单（path/name/size，与 sendFiles 协议一致） */
  sendFiles(files) {
    this._send({ type: "sendFiles", sessionId: this.sessionId, files });
  }

  /** 接收角色：批准下载目标路径 */
  acceptFile(path) {
    this._send({ type: "acceptFile", sessionId: this.sessionId, path });
  }

  /** 等待终结事件：done / cancelled / error */
  waitDone(timeoutMs = 30000) {
    return this.waitFor(
      (m) =>
        m.type === "event" &&
        m.sessionId === this.sessionId &&
        ["done", "cancelled", "error"].includes(m.kind),
      timeoutMs,
      "timeout waiting for peer transfer completion",
    );
  }

  /** 关闭会话并终止进程（有界等待） */
  async close() {
    if (this._closed) return;
    this._closed = true;
    try {
      this._send({ type: "close", sessionId: this.sessionId });
    } catch {
      /* 进程可能已退出 */
    }
    try {
      this.child.stdin.end();
    } catch {
      /* intentionally ignored */
    }
    this.child.kill();
    await new Promise((resolve) => {
      this.child.once("close", resolve);
      setTimeout(resolve, 2000);
    });
  }
}

module.exports = { ZmodemPeer, buildZrinitFrame, crc16Xmodem };
