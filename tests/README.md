# Local verification

All suites use Vitest. Unit tests include the former standalone architecture,
contract, renderer-model and service checks, grouped by domain with `describe`.
Helpers live in `helpers/`; executable renderer/protocol fixtures live in
`fixtures/` and are shared by integration suites.

```sh
npm test
npm run check
npm run check:i18n
npm run check:a11y
```

`npm test` / `npm run test:unit` run `unit/**/*.test.js`. `npm run check` also runs
ESLint. These checks do not require a built native host or a desktop session.

Build the native host before running the integration suite:

```sh
cargo build --locked --manifest-path native-services/desktop-host/Cargo.toml
npm run test:integration
```

`SIMPLESHELL_NATIVE_SERVICES_PATH` can select a specific native host. Otherwise
the integration setup searches debug, release and staged binaries in that order.
Missing prerequisites fail the relevant tests. Native tests run real loopback
SSH/SFTP servers and close their sessions; Electron fixtures run in hidden windows.
Suites run sequentially to keep ports, process patches and fixture profiles isolated.

`npm run test:all` runs lint, all unit tests and all integration tests. The latter
includes a minified renderer build and checks that PDF, CodeMirror and xterm stay
out of startup chunks. Its asset report is saved to
`.cache/integration/production-renderer/bundle-report.json`, with initial/async
JavaScript byte totals and per-chunk sizes. The build check also verifies chunk
minification and the PDF worker emitted by Webpack's asset/resource rule into
the configured output directory. Renderer logs and
light/dark AI screenshots are saved alongside their compiled fixtures under
`.cache/integration/`.

The terminal scrollback regression exercises the real WebTerminal, xterm, and
mailbox in Electron with deterministic shell output. It fills the default
50,000-line buffer, increases the setting to 500,000 lines, then checks retained
Unicode text, selection, exact search counts beyond 1,000 matches, cached
navigation, input latency, DOM/WebGL rendering, overflow, very long wrapped
output, link detection, and disposal. Run it on its own with:

```sh
npx vitest run --config vitest.integration.config.mjs tests/integration/renderer.test.js -t "500,000"
```

The fixture saves `metrics.json`, `dom.cpuprofile`, `webgl.cpuprofile`, and
`electron.log` in `.cache/integration/terminal-scrollback/`. The CPU profiles can
be opened in Chromium DevTools. Search heartbeat gaps and input echo latency
are checked independently of total search time; a full-history scan may take
longer while yielding to other work. Column reflow after changing renderers is
measured separately because it changes xterm's cell geometry.

The SSH output suite uses a real loopback SSH server, the native ZMODEM
passthrough detector, the main/renderer mailboxes, and xterm's parser. It sends
510,000 stdout lines and 160,000 stderr lines with Chinese text and emoji while
slowing parsing and checking transport health. It verifies byte hashes, exact
ACK accounting, bounded backlog, pause/resume recovery, retained history, and
connection survival. A separate case holds global replies behind an earlier
request while sending shell data, then simulates a half-open transport to
verify real failures still enter recovery. Run it with:

```sh
npx vitest run --config vitest.integration.config.mjs tests/integration/sshTerminalOutput.test.js
```

This suite requires a built native host. Its mailbox bridge runs in process;
syntax highlighting uses an identity transform so output hashes can be
compared to the original UTF-8 bytes. The Electron fixtures separately cover
rendering, IPC input, split sessions, and ZMODEM file transfers.
