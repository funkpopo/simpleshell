// Real OpenSSH interoperability using an existing WSL distribution. No service installation.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFile, execFileSync } = require("node:child_process");
const execAsync = require("node:util").promisify(execFile);
const { once } = require("node:events");
const { utils } = require("ssh2");
const {
  NativePortForwardingClient,
} = require("../src/main/native/nativePortForwardingClient");
const {
  HOST,
  Peer,
  listen,
  until,
} = require("./fixtures/port-forwarding-loopback");

async function main() {
  assert.equal(
    process.platform,
    "win32",
    "This runner uses an existing Windows WSL distribution",
  );
  const distro = process.argv[2] || "podman-machine-default";
  const kex = process.argv[3];
  assert.ok(
    !kex ||
      [
        "diffie-hellman-group-exchange-sha1",
        "diffie-hellman-group-exchange-sha256",
      ].includes(kex),
    "optional KEX must be an allowed GEX algorithm",
  );
  const tempRoot = path.resolve(__dirname, "../temp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tempRoot, "simpleshell-openssh-"));
  const privateKey = crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs1", format: "pem" });
  const pub = utils.parseKey(privateKey).getPublicSSH();
  fs.writeFileSync(path.join(dir, "host_key"), privateKey);
  fs.writeFileSync(
    path.join(dir, "authorized_keys"),
    `ssh-rsa ${pub.toString("base64")}\n`,
  );
  const wslPath = execFileSync(
    "wsl.exe",
    ["-d", distro, "-u", "root", "--exec", "wslpath", "-a", dir],
    { windowsHide: true, encoding: "utf8" },
  ).trim();
  assert.ok(!wslPath.includes("'"), "temporary path must be shell quotable");
  const reserve = net.createServer();
  const sshPort = await listen(reserve);
  await new Promise((resolve) => reserve.close(resolve));
  const script = `set -eu
work=$(mktemp -d /tmp/simpleshell-forward-XXXXXX)
cleanup() {
  if test -n "$sshd_pid"; then kill "$sshd_pid" 2>/dev/null || true; fi
  if test -n "$echo_pid"; then kill "$echo_pid" 2>/dev/null || true; fi
  case "$work" in /tmp/simpleshell-forward-*) rm -rf -- "$work" ;; esac
}
sshd_pid=""
echo_pid=""
trap cleanup EXIT
trap 'exit 0' TERM INT
cp '${wslPath}/host_key' "$work/host_key"
cp '${wslPath}/authorized_keys' "$work/authorized_keys"
chmod 600 "$work/host_key" "$work/authorized_keys"
python3 -u -c '
import socket, threading
s=socket.socket(); s.bind(("${HOST}",0)); s.listen(); print(s.getsockname()[1],flush=True)
def handle(c):
 data=b""
 while True:
  chunk=c.recv(65536)
  if not chunk: break
  data+=chunk
 c.sendall(b"reply:"+data); c.close()
while True:
 c,_=s.accept(); threading.Thread(target=handle,args=(c,),daemon=True).start()
' > "$work/echo.port" &
echo_pid=$!
cat > "$work/sshd_config" <<EOF
Port ${sshPort}
ListenAddress ${HOST}
HostKey $work/host_key
AuthorizedKeysFile $work/authorized_keys
PidFile $work/sshd.pid
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
StrictModes no
AllowTcpForwarding yes
GatewayPorts no
LogLevel VERBOSE
${kex ? `KexAlgorithms ${kex}` : ""}
EOF
/usr/sbin/sshd -D -e -f "$work/sshd_config" &
sshd_pid=$!
for n in $(seq 1 100); do
 if test -s "$work/echo.port"; then break; fi
 sleep 0.02
done
echo "READY $$ $(cat "$work/echo.port")"
wait "$sshd_pid"
`;
  const server = spawn(
    "wsl.exe",
    [
      "-d",
      distro,
      "-u",
      "root",
      "--exec",
      "bash",
      "--noprofile",
      "--norc",
      "-s",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let metadata;
  let output = "";
  let diagnostic = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/READY (\d+) (\d+)/);
    if (match)
      metadata = { pid: Number(match[1]), targetPort: Number(match[2]) };
  });
  server.stderr.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-4096);
  });
  server.stdin.end(script);
  const native = new NativePortForwardingClient({
    locate: () =>
      process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
      path.resolve(
        __dirname,
        "../native-services/desktop-host/target/debug/simpleshell-native-services.exe",
      ),
  });
  const sockets = new Set();
  const target = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => socket.end(`reply:${data}`));
  });
  try {
    await until(
      () => metadata || server.exitCode !== null,
      "WSL OpenSSH startup",
      15000,
    );
    assert.ok(metadata, diagnostic);
    const localTarget = await listen(target);
    const result = await native.start(
      "openssh",
      1,
      {
        host: HOST,
        port: sshPort,
        username: "root",
        privateKey,
        expectedHostFingerprint: `SHA256:${crypto.createHash("sha256").update(pub).digest("hex")}`,
      },
      [
        {
          id: "L",
          type: "local",
          listenHost: HOST,
          listenPort: 0,
          targetHost: HOST,
          targetPort: metadata.targetPort,
        },
        {
          id: "R",
          type: "remote",
          listenHost: HOST,
          listenPort: 0,
          targetHost: HOST,
          targetPort: localTarget,
        },
        { id: "D", type: "dynamic", listenHost: HOST, listenPort: 0 },
      ],
    );
    for (const binding of result.bindings) {
      if (binding.type === "remote") {
        const { stdout } = await execAsync(
          "wsl.exe",
          [
            "-d",
            distro,
            "-u",
            "root",
            "--exec",
            "python3",
            "-c",
            `import socket,sys; s=socket.create_connection(('${HOST}',${binding.port})); s.sendall(b'openssh-half-close'); s.shutdown(socket.SHUT_WR); data=b''.join(iter(lambda:s.recv(4096),b'')); sys.stdout.write(data.decode()); s.close()`,
          ],
          { windowsHide: true, timeout: 15000 },
        );
        assert.equal(stdout, "reply:openssh-half-close");
        console.log(
          "PASS OpenSSH remote: connection from the actual remote host and response after FIN",
        );
        continue;
      }
      const peer = await Peer.connect(binding.port);
      try {
        if (binding.type === "dynamic") {
          peer.socket.write(Buffer.from([5, 1, 0]));
          assert.deepEqual(await peer.read(2), Buffer.from([5, 0]));
          peer.socket.write(
            Buffer.concat([
              Buffer.from([5, 1, 0, 3, 9]),
              Buffer.from("localhost"),
              Buffer.from([
                metadata.targetPort >> 8,
                metadata.targetPort & 255,
              ]),
            ]),
          );
          assert.equal((await peer.read(10))[1], 0);
        }
        peer.socket.end("openssh-half-close");
        assert.equal(
          (await peer.read(24)).toString(),
          "reply:openssh-half-close",
        );
        console.log(
          `PASS OpenSSH ${binding.type}: payload and response after client FIN`,
        );
      } finally {
        peer.close();
      }
    }
    await native.closeSession("openssh", 1);
    console.log(
      `PASS OpenSSH remote unbind and independent SSH close${kex ? ` (${kex})` : ""}`,
    );
  } catch (error) {
    console.error(diagnostic);
    console.error(output);
    throw error;
  } finally {
    await native.stop();
    for (const socket of sockets) socket.destroy();
    target.close();
    if (metadata?.pid && Number.isSafeInteger(metadata.pid))
      execFileSync(
        "wsl.exe",
        [
          "-d",
          distro,
          "-u",
          "root",
          "--exec",
          "kill",
          "-TERM",
          String(metadata.pid),
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    else server.kill();
    if (server.exitCode === null) await once(server, "exit");
    assert.ok(
      path
        .resolve(dir)
        .startsWith(`${tempRoot}${path.sep}simpleshell-openssh-`),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
