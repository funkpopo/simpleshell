/**
 * Creates the SSH client for terminal connections: `NativeSshClient`, which
 * runs SSH in `simpleshell-core` and shares one connection per account with
 * SFTP, transfers and port forwarding. Without the native host there is no
 * SSH backend, so this fails with `ENATIVECORE`.
 */
const { NativeSshClient } = require("./native/nativeSshClient");
const { getNativeServicesHostPath } = require("../native/nativeServices");

function createSshClient() {
  if (!getNativeServicesHostPath()) {
    const error = new Error(
      "SSH is unavailable: the native services executable (simpleshell-core) was not found. Prepare or reinstall it.",
    );
    error.code = "ENATIVECORE";
    throw error;
  }
  return new NativeSshClient();
}

module.exports = { createSshClient };
