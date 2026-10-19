const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Server, utils } = require("ssh2");

async function createSftpLoopback(root) {
  // ssh2 accepts OpenSSH / RSA PEM host keys on all supported Node versions.
  const hostKey = crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs1", format: "pem" });
  const publicKey = utils.parseKey(hostKey).getPublicSSH();
  const fingerprint = `SHA256:${crypto.createHash("sha256").update(publicKey).digest("hex")}`;
  const clients = new Set();
  const operations = [];
  const handles = new Set();
  const control = {
    before: null,
    afterWrite: null,
    readDelay: 0,
    writeDelay: 0,
  };
  const resolve = (remotePath) => {
    const target = path.resolve(
      root,
      `.${remotePath.startsWith("/") ? remotePath : `/${remotePath}`}`,
    );
    if (target !== root && !target.startsWith(`${root}${path.sep}`))
      throw new Error("SFTP fixture path escapes root");
    return target;
  };
  const attrs = (stat) => ({
    size: stat.size,
    uid: 1000,
    gid: 1000,
    mode: stat.isDirectory() ? 0o040755 : 0o100644,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  });
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", (context) => context.accept());
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const descriptors = new Map();
          let sequence = 0;
          const statusError = (id, error) => {
            sftp.status(
              id,
              error.code === "ENOENT" ? 2 : error.code === "EACCES" ? 3 : 4,
              error.message,
            );
          };
          const register = (name, handler) =>
            sftp.on(name, async (id, ...args) => {
              try {
                await handler(id, ...args);
              } catch (error) {
                if (!sftp.destroyed) statusError(id, error);
              }
            });
          const before = async (operation) => {
            operations.push(operation);
            await control.before?.(operation, client);
          };
          for (const name of ["STAT", "LSTAT"])
            register(name, async (id, remote) => {
              await before({ name, path: remote });
              sftp.attrs(id, attrs(await fsp.stat(resolve(remote))));
            });
          register("REALPATH", async (id, remote) =>
            sftp.name(id, [
              {
                filename: path.posix.resolve("/", remote),
                longname: remote,
                attrs: {},
              },
            ]),
          );
          register("OPEN", async (id, remote, flags) => {
            await before({ name: "OPEN", path: remote, flags });
            const nativeFlags =
              (flags & 2
                ? flags & 1
                  ? fs.constants.O_RDWR
                  : fs.constants.O_WRONLY
                : fs.constants.O_RDONLY) |
              (flags & 8 ? fs.constants.O_CREAT : 0) |
              (flags & 16 ? fs.constants.O_TRUNC : 0) |
              (flags & 32 ? fs.constants.O_EXCL : 0);
            const file = await fsp.open(resolve(remote), nativeFlags);
            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(++sequence);
            const entry = { file, remote, handle: sequence };
            descriptors.set(sequence, entry);
            handles.add(entry);
            sftp.handle(id, handle);
          });
          const get = (handle) => {
            const entry = descriptors.get(handle.readUInt32BE());
            if (!entry) throw new Error("Unknown SFTP handle");
            return entry;
          };
          register("OPENDIR", async (id, remote) => {
            const entries = await fsp.readdir(resolve(remote));
            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(++sequence);
            descriptors.set(sequence, { remote, handle: sequence, entries });
            sftp.handle(id, handle);
          });
          register("READDIR", async (id, handle) => {
            const entry = get(handle);
            if (!entry.entries.length) {
              sftp.status(id, 1);
              return;
            }
            const entries = entry.entries.splice(0, 100);
            const names = await Promise.all(
              entries.map(async (name) => ({
                filename: name,
                longname: name,
                attrs: attrs(
                  await fsp.stat(resolve(path.posix.join(entry.remote, name))),
                ),
              })),
            );
            sftp.name(id, names);
          });
          register("FSTAT", async (id, handle) =>
            sftp.attrs(id, attrs(await get(handle).file.stat())),
          );
          register("READ", async (id, handle, offset, length) => {
            const entry = get(handle);
            await before({ name: "READ", path: entry.remote, offset, length });
            if (control.readDelay)
              await new Promise((resolveDelay) =>
                setTimeout(resolveDelay, control.readDelay),
              );
            if (sftp.destroyed) return;
            const buffer = Buffer.alloc(Math.min(length, 256 * 1024));
            const { bytesRead } = await entry.file.read(
              buffer,
              0,
              buffer.length,
              offset,
            );
            if (!bytesRead) sftp.status(id, 1);
            else sftp.data(id, buffer.subarray(0, bytesRead));
          });
          register("WRITE", async (id, handle, offset, data) => {
            const entry = get(handle);
            await before({
              name: "WRITE",
              path: entry.remote,
              offset,
              length: data.length,
            });
            if (control.writeDelay)
              await new Promise((resolveDelay) =>
                setTimeout(resolveDelay, control.writeDelay),
              );
            if (sftp.destroyed) return;
            await entry.file.write(data, 0, data.length, offset);
            await control.afterWrite?.({
              path: entry.remote,
              offset,
              length: data.length,
            });
            if (!sftp.destroyed) sftp.status(id, 0);
          });
          register("CLOSE", async (id, handle) => {
            const entry = get(handle);
            await entry.file?.close();
            descriptors.delete(entry.handle);
            handles.delete(entry);
            sftp.status(id, 0);
          });
          register("MKDIR", async (id, remote) => {
            await fsp.mkdir(resolve(remote));
            sftp.status(id, 0);
          });
          register("REMOVE", async (id, remote) => {
            await fsp.unlink(resolve(remote));
            sftp.status(id, 0);
          });
          register("RENAME", async (id, source, target) => {
            await before({ name: "RENAME", path: source, target });
            await fsp.rename(resolve(source), resolve(target));
            sftp.status(id, 0);
          });
          sftp.on("error", () => {});
          sftp.on("close", () => {
            for (const entry of descriptors.values()) {
              void entry.file?.close();
              handles.delete(entry);
            }
            descriptors.clear();
          });
        });
      }),
    );
  });
  await new Promise((resolveReady) =>
    server.listen(0, "127.0.0.1", resolveReady),
  );
  return {
    operations,
    control,
    resolve,
    config: {
      host: "127.0.0.1",
      port: server.address().port,
      username: "fixture",
      password: "fixture",
      expectedHostFingerprint: fingerprint,
    },
    close: async () => {
      for (const client of clients) client.end();
      for (const entry of handles) await entry.file.close();
      await new Promise((resolveClosed) => server.close(resolveClosed));
    },
  };
}

module.exports = { createSftpLoopback };
