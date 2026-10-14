import { describe, expect, it } from "vitest";
const {
  normalizeLocalTerminalConfig,
  getDefaultPosixShell,
} = require("../../src/main/local-terminal/local-terminal-config.js");
const {
  isSensitiveCommand,
} = require("../../src/shared/security/commandPrivacy.js");
const history = require("../../src/main/terminal/command-history.js");
const {
  compressCommandHistory,
  decompressCommandHistory,
} = require("../../src/main/settings/commandHistoryCodec.js");
const zlib = require("node:zlib");

const options = {
  platform: "linux",
  env: { SHELL: "/bin/bash", PATH: "/usr/bin", HOME: "/home/test" },
  homeDirectory: "/home/test",
};
describe("POSIX terminal launch boundary", () => {
  it.each([
    "/tmp/bash",
    "/usr/bin/python3",
    "/bin/../tmp/bash",
    "bash",
    "/bin/bash\u0000",
  ])("rejects untrusted program %s", (command) => {
    expect(() => normalizeLocalTerminalConfig({ command }, options)).toThrow();
  });
  it.each(
    [
      ["-c", "echo injected"],
      ["--rcfile", "/tmp/rc"],
      ["/tmp/script"],
      ["-ic", "id"],
      ["-l\n"],
      Array(9).fill("-l"),
      "-c id",
    ].map((launchArgs) => [launchArgs]),
  )("rejects command execution arguments %j", (launchArgs) => {
    expect(() =>
      normalizeLocalTerminalConfig({ launchArgs }, options),
    ).toThrow();
  });
  it("accepts interactive shells but does not trust renderer environment overrides", () => {
    const config = normalizeLocalTerminalConfig(
      {
        command: "/bin/zsh",
        launchArgs: ["-l", "-i"],
        env: {
          SHELL: "/tmp/bash",
          BASH_ENV: "/tmp/rc",
          LD_PRELOAD: "/tmp/inject",
          PATH: "/tmp",
        },
        cwd: "/tmp",
      },
      options,
    );
    expect(config.command).toBe("/bin/zsh");
    expect(config.args).toEqual(["-l", "-i"]);
    expect(config.launchArgs).toEqual(config.args);
    expect(config.env).toEqual(options.env);
    expect(config.cwd).toBe("/tmp");
  });
  it("rejects invalid cwd and ignores non-shell defaults", () => {
    expect(() =>
      normalizeLocalTerminalConfig({ cwd: "relative" }, options),
    ).toThrow();
    expect(getDefaultPosixShell({ SHELL: "/usr/bin/python3" })).not.toBe(
      "/usr/bin/python3",
    );
  });
});

describe("sensitive command history", () => {
  const sensitive = [
    "curl --password demo-value",
    "export API_TOKEN=demo-value",
    "SECRET=demo-value run",
    "mysql -pdemo-value",
    "redis-cli -a demo-value",
    "curl -u user:demo-value https://example.test",
    "curl https://user:demo-value@example.test",
    "sshpass -p demo-value ssh host",
    "curl -H 'Authorization: Bearer demo-value' host",
    "openssl pkey -passin pass:demo-value",
  ];
  it.each(sensitive)("rejects %s", (command) => {
    expect(isSensitiveCommand(command)).toBe(true);
    history.initialize([]);
    expect(history.addCommand(command)).toBe(false);
    expect(history.exportHistory()).toEqual([]);
  });
  it("filters old, imported and compressed histories while preserving normal commands", () => {
    const safe = { command: "git status", timestamp: 1, count: 2 };
    const entries = [safe, ...sensitive.map((command) => ({ command }))];
    history.initialize(entries);
    expect(history.exportHistory()).toEqual([safe]);
    const compressed = compressCommandHistory(entries, () => {});
    expect(
      JSON.parse(
        zlib.gunzipSync(Buffer.from(compressed.data, "base64")).toString(),
      ),
    ).toEqual([safe]);
    expect(
      decompressCommandHistory(
        {
          compressed: true,
          data: zlib.gzipSync(JSON.stringify(entries)).toString("base64"),
        },
        () => {},
      ),
    ).toEqual([safe]);
    expect(
      decompressCommandHistory({ compressed: false, data: entries }, () => {}),
    ).toEqual([safe]);
  });
});
