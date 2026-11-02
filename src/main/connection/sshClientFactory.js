/**
 * Chooses the SSH client implementation for terminal connections.
 *
 * `native` (default) runs SSH in `simpleshell-core`, sharing one connection
 * per account with SFTP, transfers and port forwarding. `ssh2` is the
 * previous in-process implementation, kept as a fallback for a transition
 * period: `SIMPLESHELL_SSH_BACKEND=ssh2`, or `uiSettings.performance.sshBackend`
 * set to `"ssh2"`. Without the native host the fallback is used.
 */
const { Client } = require("ssh2");
const { NativeSshClient } = require("./native/nativeSshClient");
const { getNativeServicesHostPath } = require("../native/nativeServices");

const SSH_BACKENDS = Object.freeze({ NATIVE: "native", SSH2: "ssh2" });

function configuredBackend() {
  const override = process.env.SIMPLESHELL_SSH_BACKEND;
  if (override) return override;
  try {
    // Loaded lazily: settings need the app paths, tests may not have them.
    const configService = require("../settings/configService");
    return configService.loadUISettings?.()?.performance?.sshBackend || null;
  } catch {
    return null;
  }
}

function resolveSshBackend() {
  const requested = String(configuredBackend() || SSH_BACKENDS.NATIVE)
    .trim()
    .toLowerCase();
  if (requested === SSH_BACKENDS.SSH2) return SSH_BACKENDS.SSH2;
  return getNativeServicesHostPath() ? SSH_BACKENDS.NATIVE : SSH_BACKENDS.SSH2;
}

function createSshClient() {
  return resolveSshBackend() === SSH_BACKENDS.NATIVE
    ? new NativeSshClient()
    : new Client();
}

module.exports = { SSH_BACKENDS, resolveSshBackend, createSshClient };
