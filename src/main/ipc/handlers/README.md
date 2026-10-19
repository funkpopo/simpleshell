# IPC handler ownership

`bootstrap/ipcSetup.js` registers handlers and initializes window-dependent
terminal services directly. It is the registration entry point.

`sshHandlers.js` retains the public channel list and session state. It composes
focused services under `domains/`:

- `connectionCredentials`: connection testing and saved credential updates.
- `terminalOutput`: IPC output, mailbox flow control and SSH stream listeners.
- `sshRecovery`: pool listeners, process bindings and reconnect recovery.
- `sshSessions`: preflight, start deduplication, authentication and shell creation.
- `protocolSessions`: Telnet, serial and Mosh launch/output handling.

The services receive named dependencies. Session maps, pending requests and
mailboxes retain their original lifetimes and owner. Channel names and public
handler signatures are unchanged. Authentication and recovery continue to run
through the facade's current commands.

SFTP file commands use `nativeSftpClient`. The old session/queue channels are
deprecated compatibility metadata responses; they do not acquire sessions or
schedule operations. The connection manager no longer exposes the old stubs.

`tests/integration/sshAuthentication.test.js` checks real authentication failure,
cancellation, live configuration changes and production-minified errors.
