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

`batchInvokeHandlers.js` (`BatchInvokeHandlers`) owns batched IPC invocation, while
`systemInfoHandlers.js` (`SystemInfoHandlers`) owns remote system info polling.

`fileHandlers.js` delegates directory browsing/watching, remote file mutations,
dropped upload validation and transfer operations to `file-domains/` helpers.
SFTP file commands use `nativeSftpClient` (and `sftp/*` helpers); legacy SFTP
session/queue stub channels have been removed.

`tests/integration/sshAuthentication.test.js` checks real authentication failure,
cancellation, live configuration changes and production-minified errors.
