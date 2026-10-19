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
