import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_LINES,
  REDACTED_PLACEHOLDER,
  REDACTED_PRIVATE_KEY_PLACEHOLDER,
  collectTerminalContext,
  extractTerminalBufferLines,
  redactTerminalText,
  sanitizeSessionMetadata,
  stripAnsiSequences,
} from "../../src/renderer/features/terminal/lib/terminalContextCollector.js";
import {
  clearWorkingDirectorySession,
  consumeTerminalContextAttachRequest,
  getTerminalLastCommand,
  readTerminalContext,
  registerTerminalContextProvider,
  requestTerminalContextAttach,
  setTerminalLastCommand,
  setTerminalWorkingDirectory,
  subscribeTerminalContext,
  subscribeWorkingDirectory,
} from "../../src/renderer/shared/state/workingDirectoryStore.js";

function createMockTerm(rows, cols = 80) {
  return {
    cols,
    buffer: {
      active: {
        type: "normal",
        length: rows.length,
        getLine(index) {
          const entry = rows[index];
          if (entry == null) return undefined;
          const text = typeof entry === "string" ? entry : entry.text;
          const isWrapped =
            typeof entry === "object" ? Boolean(entry.isWrapped) : false;
          return {
            isWrapped,
            translateToString(trimRight = true, start = 0, end = text.length) {
              const slice = text.slice(start, end);
              return trimRight ? slice.replace(/\s+$/g, "") : slice;
            },
          };
        },
      },
    },
  };
}

afterEach(() => {
  clearWorkingDirectorySession("ctx-s1");
  clearWorkingDirectorySession("ctx-s2");
});

describe("terminalContextCollector", () => {
  it("strips ANSI CSI, OSC, and control sequences while preserving text", () => {
    const raw =
      "\x1b]0;alice@host:/var/log\x07\x1b[31mERROR\x1b[0m: bind \x1b[1;33m:80\x1b[m failed\r\nnext\x00line";
    expect(stripAnsiSequences(raw)).toBe("ERROR: bind :80 failed\nnextline");
  });

  it("redacts Bearer tokens, auth headers, URL credentials, password=, and PEM keys without touching PWD", () => {
    const input = [
      "PWD=/etc/nginx",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
      "Authorization: Basic dXNlcjpwYXNz",
      "X-Api-Key: secret-api-key-999",
      "curl https://deploy:Sup3rSecret!@git.example.com/app.git",
      'DB_PASSWORD="my secret pass" token=tok_live_12345',
      '{"password": "json-password"}',
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==",
      "-----END OPENSSH PRIVATE KEY-----",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEAtailTruncated",
    ].join("\n");

    const redacted = redactTerminalText(input);
    expect(redacted).toContain("PWD=/etc/nginx");
    expect(redacted).toContain(`Authorization: Bearer ${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`Authorization: Basic ${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`X-Api-Key: ${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(
      `https://deploy:${REDACTED_PLACEHOLDER}@git.example.com/app.git`,
    );
    expect(redacted).toContain(`DB_PASSWORD=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`token=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`"password": ${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(REDACTED_PRIVATE_KEY_PLACEHOLDER);
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).not.toContain("dXNlcjpwYXNz");
    expect(redacted).not.toContain("secret-api-key-999");
    expect(redacted).not.toContain("Sup3rSecret!");
    expect(redacted).not.toContain("my secret pass");
    expect(redacted).not.toContain("tok_live_12345");
    expect(redacted).not.toContain("json-password");
    expect(redacted).not.toContain("b3BlbnNzaC1rZXktdjE");
    expect(redacted).not.toContain("MIIEpAIBAAKCAQEAtailTruncated");
  });

  it("unwraps wrapped lines, trims trailing empty rows, and enforces line/char caps in O(maxLines)", () => {
    const rows = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    rows.push(
      { text: "wrapped-part-1 ", isWrapped: false },
      { text: "wrapped-part-2", isWrapped: true },
      "",
      "   ",
    );
    const term = createMockTerm(rows);
    const getLineSpy = vi.spyOn(term.buffer.active, "getLine");

    const extracted = extractTerminalBufferLines(term, { maxLines: 5 });
    expect(extracted.truncatedByLines).toBe(true);
    expect(extracted.lineCount).toBe(5);
    expect(extracted.lines).toEqual([
      "line-96",
      "line-97",
      "line-98",
      "line-99",
      "wrapped-part-1 wrapped-part-2",
    ]);
    // Only reads trailing rows + wrapped rows + padding, never the 100-line prefix.
    expect(getLineSpy.mock.calls.length).toBeLessThan(15);

    const longLines = Array.from(
      { length: 60 },
      (_, i) => `row-${String(i).padStart(2, "0")}-${"x".repeat(120)}`,
    );
    const collected = collectTerminalContext({
      term: createMockTerm(longLines),
      maxLines: DEFAULT_MAX_LINES,
      maxChars: DEFAULT_MAX_CHARS,
    });
    expect(collected.truncated).toBe(true);
    expect(collected.lineCount).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(collected.charCount).toBeLessThanOrEqual(DEFAULT_MAX_CHARS);
    expect(collected.recentOutput).toContain("row-59-");
    expect(collected.recentOutput).not.toContain("row-00-");
  });

  it("captures active CWD, sanitized session metadata, and redacted lastCommand", () => {
    setTerminalWorkingDirectory("ctx-s1", "/etc/nginx");
    setTerminalLastCommand(
      "ctx-s1",
      "curl -H 'Authorization: Bearer topsecret' https://user:pw@host/test",
    );

    const meta = sanitizeSessionMetadata({
      host: "prod-web-01",
      username: "ops",
      protocol: "ssh",
      port: 2222,
      password: "do-not-leak-password",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----",
      passphrase: "do-not-leak-passphrase",
      proxyPassword: "do-not-leak-proxy-password",
    });
    expect(meta).toEqual({
      host: "prod-web-01",
      username: "ops",
      protocol: "SSH",
      port: 2222,
    });

    const context = collectTerminalContext({
      sessionKey: "ctx-s1",
      term: createMockTerm(["\x1b[32mnginx -t ok\x1b[0m"]),
      connectionInfo: {
        host: "prod-web-01",
        username: "ops",
        type: "SSH",
        port: 22,
        password: "secret",
      },
    });

    expect(context.cwd).toBe("/etc/nginx");
    expect(context.host).toBe("prod-web-01");
    expect(context.username).toBe("ops");
    expect(context.protocol).toBe("SSH");
    expect(context.lastCommand).toBe(
      `curl -H 'Authorization: Bearer ${REDACTED_PLACEHOLDER}' https://user:${REDACTED_PLACEHOLDER}@host/test`,
    );
    expect(context.recentOutput).toBe("nginx -t ok");
    expect(context.lineCount).toBe(1);
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(JSON.stringify(context)).not.toContain("topsecret");
  });

  it("isolates context store updates from SFTP working-directory path listeners", () => {
    const dirListener = vi.fn();
    const ctxListener = vi.fn();
    const unsubDir = subscribeWorkingDirectory("ctx-s2", dirListener);
    const unsubCtx = subscribeTerminalContext("ctx-s2", ctxListener);

    setTerminalLastCommand("ctx-s2", "systemctl status nginx");
    expect(dirListener).not.toHaveBeenCalled();
    expect(ctxListener).toHaveBeenCalledTimes(1);
    expect(getTerminalLastCommand("ctx-s2")).toBe("systemctl status nginx");

    setTerminalWorkingDirectory("ctx-s2", "/var/log");
    expect(dirListener).toHaveBeenCalledTimes(1);
    expect(ctxListener).toHaveBeenCalledTimes(2);

    const unregister = registerTerminalContextProvider("ctx-s2", () => ({
      sessionKey: "ctx-s2",
      cwd: "/var/log",
      lastCommand: "systemctl status nginx",
      recentOutput: "active (running)",
      lineCount: 1,
      charCount: 16,
      truncated: false,
    }));
    expect(readTerminalContext("ctx-s2")?.recentOutput).toBe(
      "active (running)",
    );

    requestTerminalContextAttach("ctx-s2");
    expect(consumeTerminalContextAttachRequest("ctx-s2")).toBe(true);
    expect(consumeTerminalContextAttachRequest("ctx-s2")).toBe(false);
    expect(readTerminalContext("welcome")).toBeNull();

    unregister();
    unsubDir();
    unsubCtx();
  });
});
