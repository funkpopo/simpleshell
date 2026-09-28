const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Ber } = require("asn1");
const { utils } = require("ssh2");
const {
  NativePortForwardingClient,
} = require("../src/main/native/nativePortForwardingClient");
const {
  HOST,
  Peer,
  createFixture,
  until,
} = require("./fixtures/port-forwarding-loopback");

const binary =
  process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
  path.resolve(
    __dirname,
    "../native-services/desktop-host/target/debug",
    process.platform === "win32"
      ? "simpleshell-native-services.exe"
      : "simpleshell-native-services",
  );

// Node exports DSA as PKCS8; ssh2 expects the traditional six-integer PEM.
// Both keys are generated for this test, with no persistent private-key fixture.
function dsaKey() {
  const keys = crypto.generateKeyPairSync("dsa", {
    modulusLength: 1024,
    divisorLength: 160,
  });
  const secret = new Ber.Reader(
    keys.privateKey.export({ type: "pkcs8", format: "der" }),
  );
  secret.readSequence();
  secret.readInt();
  secret.readSequence();
  secret.readOID();
  secret.readSequence();
  const params = Array.from({ length: 3 }, () =>
    secret.readString(Ber.Integer, true),
  );
  const x = new Ber.Reader(secret.readString(Ber.OctetString, true)).readString(
    Ber.Integer,
    true,
  );
  const pub = new Ber.Reader(
    keys.publicKey.export({ type: "spki", format: "der" }),
  );
  pub.readSequence();
  pub.readSequence();
  pub.readOID();
  pub.readSequence();
  for (let n = 0; n < 3; n++) pub.readString(Ber.Integer, true);
  const y = new Ber.Reader(
    pub.readString(Ber.BitString, true).subarray(1),
  ).readString(Ber.Integer, true);
  const writer = new Ber.Writer();
  writer.startSequence();
  writer.writeInt(0);
  for (const value of [...params, y, x]) writer.writeBuffer(value, Ber.Integer);
  writer.endSequence();
  const pem = `-----BEGIN DSA PRIVATE KEY-----\n${writer.buffer
    .toString("base64")
    .match(/.{1,64}/g)
    .join("\n")}\n-----END DSA PRIVATE KEY-----\n`;
  assert.equal(utils.parseKey(pem).type, "ssh-dss");
  const string = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  // Wrap these integers in the OpenSSH private-key format supported by both libraries.
  const check = crypto.randomBytes(4);
  let body = Buffer.concat([
    check,
    check,
    string("ssh-dss"),
    ...[...params, y, x].map(string),
    string(""),
  ]);
  const pad = (8 - (body.length % 8)) % 8;
  body = Buffer.concat([
    body,
    Buffer.from(Array.from({ length: pad }, (_, n) => n + 1)),
  ]);
  const blob = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    string("none"),
    string("none"),
    string(""),
    Buffer.from([0, 0, 0, 1]),
    string(utils.parseKey(pem).getPublicSSH()),
    string(body),
  ]);
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${blob
    .toString("base64")
    .match(/.{1,70}/g)
    .join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

async function main() {
  const native = new NativePortForwardingClient({ locate: () => binary });
  const rsa = utils.generateKeyPairSync("rsa", { bits: 2048 }).private;
  const base = {
    kex: ["curve25519-sha256"],
    cipher: ["aes128-ctr"],
    hmac: ["hmac-sha2-256"],
    serverHostKey: ["rsa-sha2-256"],
    compress: ["none"],
  };
  let count = 0;
  async function check(
    label,
    algorithms,
    privateKey = rsa,
    rekey = false,
    publicKeyAuth = false,
  ) {
    const fixture = await createFixture({
      privateKey,
      algorithms: { ...base, ...algorithms },
    });
    const id = `alg-${++count}`;
    try {
      const target = await fixture.tcp((socket) => socket.pipe(socket));
      const ssh = publicKeyAuth
        ? { ...fixture.ssh, password: undefined, privateKey }
        : fixture.ssh;
      const result = await native.start(id, 1, ssh, [
        {
          id: "L",
          type: "local",
          listenHost: HOST,
          listenPort: 0,
          targetHost: HOST,
          targetPort: target.address().port,
        },
      ]);
      const negotiated = fixture.state.handshakes[0];
      for (const [field, names] of Object.entries({ ...base, ...algorithms })) {
        if (field === "kex") assert.ok(names.includes(negotiated.kex), label);
        else if (field === "serverHostKey")
          assert.ok(names.includes(negotiated.serverHostKey), label);
        else
          for (const direction of ["cs", "sc"]) {
            const key = field === "hmac" ? "mac" : field;
            if (key === "mac" && !negotiated[direction].mac) continue; // AEAD owns integrity.
            assert.ok(
              names.includes(negotiated[direction][key]),
              `${label}: ${direction} ${key}`,
            );
          }
      }
      const peer = await Peer.connect(result.bindings[0].port);
      try {
        const payload = crypto.randomBytes(48 * 1024 + 17);
        peer.socket.write(payload);
        assert.deepEqual(await peer.read(payload.length), payload);
        if (rekey) {
          [...fixture.clients][0].rekey();
          await until(
            () => fixture.state.handshakes.length === 2,
            `${label} rekey`,
            10000,
          );
          peer.socket.write(payload);
          assert.deepEqual(await peer.read(payload.length), payload);
        }
      } finally {
        peer.close();
      }
      console.log(
        `PASS ${label}${rekey ? " + rekey" : ""}${publicKeyAuth ? " + public-key login" : ""}`,
      );
      return negotiated;
    } finally {
      await native.closeSession(id, 1);
      await fixture.close();
    }
  }
  try {
    for (const mac of [
      "hmac-sha2-256",
      "hmac-sha2-512",
      "hmac-sha1",
      "hmac-sha2-256-etm@openssh.com",
      "hmac-sha2-512-etm@openssh.com",
      "hmac-sha1-etm@openssh.com",
      "hmac-sha1-96",
      "hmac-md5",
      "hmac-md5-96",
      "hmac-sha2-256-96",
      "hmac-sha2-512-96",
    ])
      await check(mac, { hmac: [mac] }, rsa, mac.endsWith("-96"));
    for (const cipher of [
      "aes128-ctr",
      "aes192-ctr",
      "aes256-ctr",
      "aes128-cbc",
      "aes192-cbc",
      "aes256-cbc",
      "3des-cbc",
      "aes128-gcm",
      "aes256-gcm",
      "aes128-gcm@openssh.com",
      "aes256-gcm@openssh.com",
      "chacha20-poly1305@openssh.com",
    ])
      await check(cipher, { cipher: [cipher] });
    // ssh2 implements GEX only as a client. The OpenSSH runner covers GEX servers.
    for (const kex of [
      "curve25519-sha256@libssh.org",
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521",
      "diffie-hellman-group1-sha1",
      "diffie-hellman-group14-sha1",
      "diffie-hellman-group14-sha256",
      "diffie-hellman-group15-sha512",
      "diffie-hellman-group16-sha512",
      "diffie-hellman-group17-sha512",
      "diffie-hellman-group18-sha512",
    ])
      await check(kex, { kex: [kex] });
    for (const hostKey of ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"])
      await check(hostKey, { serverHostKey: [hostKey] }, rsa, false, true);
    await check(
      "ssh-ed25519",
      { serverHostKey: ["ssh-ed25519"] },
      utils.generateKeyPairSync("ed25519").private,
      false,
      true,
    );
    for (const bits of [256, 384, 521]) {
      const name = `ecdsa-sha2-nistp${bits}`;
      await check(
        name,
        { serverHostKey: [name] },
        utils.generateKeyPairSync("ecdsa", { bits }).private,
        false,
        true,
      );
    }
    await check(
      "ssh-dss / group1 / 3DES / MD5",
      {
        serverHostKey: ["ssh-dss"],
        kex: ["diffie-hellman-group1-sha1"],
        cipher: ["3des-cbc"],
        hmac: ["hmac-md5"],
      },
      dsaKey(),
      true,
      true,
    );
    const preferred = await check(
      "modern algorithms win over legacy-first server offers",
      {
        kex: ["diffie-hellman-group1-sha1", "curve25519-sha256"],
        cipher: ["3des-cbc", "aes256-ctr"],
        hmac: ["hmac-md5", "hmac-sha2-256-etm@openssh.com"],
        serverHostKey: ["ssh-rsa", "rsa-sha2-512"],
      },
    );
    assert.equal(preferred.kex, "curve25519-sha256");
    assert.equal(preferred.cs.cipher, "aes256-ctr");
    assert.equal(preferred.cs.mac, "hmac-sha2-256-etm@openssh.com");
    assert.equal(preferred.serverHostKey, "rsa-sha2-512");
    console.log(
      `All ${count} native SSH algorithm interoperability cases passed.`,
    );
  } finally {
    await native.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
