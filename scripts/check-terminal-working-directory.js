const assert = require("node:assert/strict");
const createLoader = require("./lib/load-renderer-module.js");
const load = createLoader();
const tracking = load(
  "src/renderer/modules/terminal/workingDirectoryTracking.js",
);
const store = load("src/renderer/modules/terminal/workingDirectoryStore.js");
const { parseWorkingDirectoryOsc: osc, parseWorkingDirectoryPrompt: prompt } =
  tracking;
const title = tracking.parseWorkingDirectoryTitle;

assert.equal(title("alice@server:/srv/a b", "alice").path, "/srv/a b");
assert.equal(title("alice@server:~/project", "alice").path, "~/project");
assert.equal(
  title("alice@server:/srv/100%/$data#1", "alice").path,
  "/srv/100%/$data#1",
);
for (const value of [
  "vim /etc/hosts",
  "/srv/project",
  "alice@server:project",
  "alice@server:/srv/.../src",
  "alice@server:/srv/…/src",
  "alice@server:/srv/\x00",
  "root@server:~",
]) {
  assert.equal(title(value, "alice"), null, value);
}

assert.equal(
  osc(7, "file://server/home/a%20b/%E4%B8%AD%E6%96%87").path,
  "/home/a b/中文",
);
assert.equal(osc(7, "file:///a%2520b").path, "/a%20b");
assert.equal(osc(7, "file://server/link/../folder").path, "/link/../folder");
assert.equal(osc(1337, "CurrentDir=/a%20b ").path, "/a%20b ");
for (const value of [
  "https://server/etc",
  "file://server",
  "file://server/%ZZ",
  "file://server/%00",
  "file://server/%0a",
  "file://server/%C2%85",
  "file://server//etc",
]) {
  assert.equal(osc(7, value), null, value);
}
assert.equal(osc(1337, "CurrentDir=relative"), null);
assert.equal(osc(1337, "SetMark"), null);
assert.equal(prompt("alice@server:/srv/a b$ ", "alice").path, "/srv/a b");
assert.equal(
  prompt("(venv) alice@server:~/project$ ", "alice").path,
  "~/project",
);
assert.equal(prompt("[alice@server /etc]$ ", "alice").path, "/etc");
assert.equal(prompt("alice@server:~$ ", "alice").path, "~");
for (const value of [
  "[alice@server src]$",
  "alice@server:/etc$ cd /tmp",
  "alice@server:/etc$ echo #",
  "alice@server:/etc$ echo $",
  "alice@server:/etc$ echo %",
  "mysql>",
  "log: /etc",
  "root@server:~# ",
  "alice@server:~/.../src$ ",
  "alice@server:/srv/…/src$ ",
]) {
  assert.equal(prompt(value, "alice"), null, value);
}

const handlers = new Map();
const parsed = new Set();
let line = "alice@server:/srv/first$ ";
const term = {
  parser: {
    registerOscHandler(code, callback) {
      handlers.set(code, callback);
      return { dispose: () => handlers.delete(code) };
    },
  },
  onWriteParsed(callback) {
    parsed.add(callback);
    return { dispose: () => parsed.delete(callback) };
  },
  buffer: {
    active: {
      type: "normal",
      baseY: 100,
      cursorY: 3,
      getLine(index) {
        assert.equal(
          index,
          103,
          "cwd must read the cursor line after scrollback",
        );
        return { isWrapped: false, translateToString: () => line };
      },
    },
  },
};
const tracker = tracking.attachWorkingDirectoryTracking(term, "A", {
  username: "alice",
});
let notifications = 0;
const unsubscribe = store.subscribeWorkingDirectory("A", () => notifications++);
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/srv/first");
parsed.forEach((callback) => callback());
assert.equal(notifications, 1, "unchanged directories must not refresh SFTP");
line = "alice@other:/wrong$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, null);
line = "alice@server:/srv/first$ ";
parsed.forEach((callback) => callback());
assert.equal(handlers.get(7)("file://server/explicit"), true);
line = "alice@server:/abbreviated$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/explicit");
handlers.get(7)("file://other/wrong");
assert.equal(store.getWorkingDirectoryState("A").path, null);
handlers.get(7)("file://server/explicit");
term.buffer.active.type = "alternate";
handlers.get(7)("file://server/editor");
assert.equal(store.getWorkingDirectoryState("A").path, "/explicit");
store.setTerminalWorkingDirectory("A::p1", "/pane");
assert.equal(store.getWorkingDirectoryState("A::p1").path, "/pane");
tracker.reset();
assert.equal(store.getWorkingDirectoryState("A").path, null);
term.buffer.active.type = "normal";
line = "alice@server:/reconnected$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/reconnected");
tracker.reset();
line = "[alice@server ~]$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "~");
// RHEL-style prompts show only a basename; their OSC title contains the cwd.
assert.equal(
  handlers.get(0)("alice@server:/srv/project"),
  false,
  "directory tracking must preserve xterm's title handling",
);
line = "[alice@server project]$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/srv/project");
handlers.get(2)("alice@server:/var/log");
line = "[alice@server log]$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/var/log");
handlers.get(2)("alice@other:/wrong");
line = "[alice@other wrong]$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, null);
handlers.get(0)("alice@server:/returned");
line = "[alice@server returned]$ ";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/returned");
term.buffer.active.type = "alternate";
handlers.get(2)("alice@server:/editor");
term.buffer.active.type = "normal";
parsed.forEach((callback) => callback());
assert.equal(store.getWorkingDirectoryState("A").path, "/returned");
handlers.get(7)("file://server/explicit");
handlers.get(0)("alice@server:/title");
line = "[alice@server title]$ ";
parsed.forEach((callback) => callback());
assert.equal(
  store.getWorkingDirectoryState("A").path,
  "/explicit",
  "an explicit directory report must take precedence over a title",
);
tracker.reset();
line = "[alice@server title]$ ";
parsed.forEach((callback) => callback());
assert.equal(
  store.getWorkingDirectoryState("A").path,
  null,
  "reconnect must discard old titles",
);
tracker.dispose();
tracker.dispose();
assert.equal(handlers.size + parsed.size, 0);
unsubscribe();
const before = notifications;
store.clearWorkingDirectorySession("A");
assert.equal(notifications, before);
assert.equal(store.getWorkingDirectoryState("A").path, null);
assert.equal(store.getWorkingDirectoryState("A::p1").path, "/pane");
store.clearWorkingDirectorySession("A::p1");

const {
  createOscSafeOutputTransform,
} = require("../src/main/terminal/oscSafeOutput");
for (const terminator of ["\x07", "\x1b\\"]) {
  const report = `\x1b]1337;CurrentDir=/srv/@host-abcdef:中文 ERROR${terminator}`;
  const input = `before ${report} after`;
  for (let split = 0; split <= input.length; split++) {
    const transform = createOscSafeOutputTransform((text) =>
      text.toUpperCase(),
    );
    assert.equal(
      transform(input.slice(0, split)) + transform(input.slice(split), true),
      `BEFORE ${report} AFTER`,
      `OSC corrupted at split ${split}`,
    );
  }
  const transform = createOscSafeOutputTransform((text) => text.toUpperCase());
  assert.equal(
    [...input].map((char) => transform(char)).join("") + transform("", true),
    `BEFORE ${report} AFTER`,
  );
}
const transform = createOscSafeOutputTransform((text) => text);
assert.equal(transform("trailing\x1b") + transform("", true), "trailing\x1b");

const configService = require("../src/main/settings/configService");
configService._initializeValidator();
configService._log = () => {};
const config = {};
configService._saveSection = (_section, { write }) => write(config) !== false;
configService._loadSection = (_section, { read, fallback }) =>
  read(config) || fallback();
assert.equal(configService.loadUISettings().sftpFollowTerminalDirectory, true);
assert.equal(
  configService.saveUISettings({ sftpFollowTerminalDirectory: false }),
  true,
);
assert.equal(configService.saveUISettings({ fontSize: 16 }), true);
assert.equal(
  configService.loadUISettings().sftpFollowTerminalDirectory,
  false,
  "partial settings save lost global opt-out",
);
assert.equal(
  configService.saveUISettings({ sftpFollowTerminalDirectory: "false" }),
  false,
);
console.log("Terminal working directory checks passed.");
