import { describe, expect, it } from "vitest";
import outputProcessor from "../../src/main/terminal/output-processor.js";
import highlightRules from "../../src/shared/domain/highlight-configs.js";

// The previous quadratic selection, kept as the reference behavior.
const selectByScanningAll = (candidates) => {
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const lengthDelta = b.end - b.start - (a.end - a.start);
    if (lengthDelta) return lengthDelta;
    if (a.order !== b.order) return a.order - b.order;
    return a.start - b.start;
  });
  const selected = [];
  for (const candidate of sorted) {
    if (
      !selected.some(
        (existing) =>
          candidate.start < existing.end && existing.start < candidate.end,
      )
    ) {
      selected.push(candidate);
    }
  }
  return selected.sort((a, b) => a.start - b.start);
};

// The previous ANSI isolation with regex-based SGR parsing, kept as the reference behavior.
const LEGACY_ANSI_SEQUENCE_REGEX = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const LEGACY_SGR_REGEX = /^\u001b\[([0-9;]*)m$/;
const LEGACY_STYLE_CLEAR_CODES = new Set([
  0, 22, 23, 24, 25, 27, 28, 29, 39, 49, 59,
]);
const legacyAnsiIsolation = (processor, output) => {
  if (!output) return output;
  const segments = [];
  let lastIndex = 0;
  let ansiStyleActive = false;
  LEGACY_ANSI_SEQUENCE_REGEX.lastIndex = 0;
  let match = null;
  while ((match = LEGACY_ANSI_SEQUENCE_REGEX.exec(output)) !== null) {
    if (match.index > lastIndex) {
      const textSegment = output.slice(lastIndex, match.index);
      segments.push(
        ansiStyleActive
          ? textSegment
          : processor.highlightPlainTextSegment(textSegment),
      );
    }
    const ansiSequence = match[0];
    segments.push(ansiSequence);
    const sgrMatch = ansiSequence.match(LEGACY_SGR_REGEX);
    if (sgrMatch) {
      const rawCodes = sgrMatch[1];
      if (!rawCodes) {
        ansiStyleActive = false;
      } else {
        const codes = rawCodes
          .split(";")
          .map((code) => Number(code))
          .filter(Number.isFinite);
        ansiStyleActive = !(
          !codes.length ||
          codes.every((code) => LEGACY_STYLE_CLEAR_CODES.has(code))
        );
      }
    }
    lastIndex = LEGACY_ANSI_SEQUENCE_REGEX.lastIndex;
  }
  if (lastIndex < output.length) {
    const remainingSegment = output.slice(lastIndex);
    segments.push(
      ansiStyleActive
        ? remainingSegment
        : processor.highlightPlainTextSegment(remainingSegment),
    );
  }
  return segments.join("");
};

describe("terminal output highlighting", () => {
  it("selects the same non-overlapping ranges as a full overlap scan", () => {
    let seed = 42;
    const random = (limit) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    for (let round = 0; round < 300; round++) {
      const candidates = Array.from({ length: 1 + random(80) }, () => {
        const start = random(200);
        return {
          start,
          end: start + 1 + random(12),
          priority: random(4),
          order: random(6),
        };
      });
      expect(outputProcessor.selectStableHighlightRanges(candidates)).toEqual(
        selectByScanningAll(candidates),
      );
    }
  });

  it("highlights a whole UUID instead of the generic hex fragments inside it", () => {
    const order = highlightRules.map((rule) => rule.id);
    expect(order.indexOf("uuid")).toBeLessThan(order.indexOf("dockerId"));
    expect(order.indexOf("uuid")).toBeLessThan(order.indexOf("gitCommit"));

    const uuidColor = outputProcessor.compiledHighlightRules.find(
      (rule) => rule.id === "uuid",
    ).ansiColor;
    const reset = "\u001b[0m";
    for (const uuid of [
      "550e8400-e29b-41d4-a716-446655440000",
      "550E8400-E29B-41D4-A716-446655440000",
    ]) {
      for (const [before, after] of [
        ["id ", " end"],
        ["cd /data/", "/logs"],
        ["REQUEST_ID=", " done"],
      ]) {
        const output = outputProcessor.applySyntaxHighlighting(
          `${before}${uuid}${after}`,
        );
        expect(output).toContain(`${uuidColor}${uuid}${reset}`);
      }
    }

    // 版本位不是 1-5 的不是 UUID，仍按通用十六进制规则处理
    const notUuid = outputProcessor.applySyntaxHighlighting(
      "x 550e8400-e29b-61d4-a716-446655440000",
    );
    expect(notUuid).not.toContain(
      `${uuidColor}550e8400-e29b-61d4-a716-446655440000`,
    );
    // 独立的 Docker ID 与提交哈希不受影响
    const dockerColor = outputProcessor.compiledHighlightRules.find(
      (rule) => rule.id === "dockerId",
    ).ansiColor;
    expect(
      outputProcessor.applySyntaxHighlighting("container 0123456789ab up"),
    ).toContain(`${dockerColor}0123456789ab${reset}`);
  });

  it("keeps IPv6 matches after the prefilter and skips other colon text", () => {
    const rule = highlightRules.find((item) => item.id === "ipv6");
    const regex = new RegExp(rule.pattern, rule.flags);
    const matches = (text) => text.match(regex) || [];

    for (const address of [
      "2001:db8::ff00:42:8329",
      "fe80::1",
      "1:2:3:4:5:6:7:8",
      "abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    ]) {
      expect(matches(`addr ${address} up`)).toEqual([address]);
    }
    expect(matches("2026-10-25 12:00:01 key: value")).toEqual([]);
  });

  it("rule prefilters, cluster selection, SGR parsing and whitespace skipping never change the output", () => {
    // 参考实现：不带 requires 预筛、全局贪心选择、不跳过空白片段、原始 SGR 解析
    const reference = new outputProcessor.constructor();
    reference.updateHighlightRules(
      highlightRules.map((rule) => {
        const copy = { ...rule };
        delete copy.requires;
        return copy;
      }),
    );
    reference.highlightPlainTextSegment = (text) => {
      if (!text) return text;
      const ranges = selectByScanningAll(
        reference.collectHighlightCandidates(text),
      );
      return reference.applyHighlightRanges(text, ranges);
    };
    reference.applyHighlightWithAnsiIsolation = (output) =>
      legacyAnsiIsolation(reference, output);

    const samples = [
      "commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f merged",
      "container 0123456789ab started; image sha256:" + "ab".repeat(32),
      "id=550e8400-e29b-41d4-a716-446655440000 ok",
      "link fe80::1%eth0 and 2001:db8::ff00:42:8329 and ::ffff:192.168.1.1",
      "1:2:3:4:5:6:7:8 abcd:ef01:2345:6789:abcd:ef01:2345:6789",
      "12:00:01 aa:bb:cc:dd:ee:ff deadbeef-cafe",
      "\u001b[1m   \u001b[0m \r\n\t \u001b[31merror\u001b[0m  ~/x /tmp/a",
      "   \r\n",
      'C:\\Users\\dev\\app.log and \\\\server\\share "GET / HTTP/1.1" 200 512',
      "export PATH=/usr/bin HOME='/root' echo $HOME ${USER} pid=4321 listening on port 8080",
      "HTTP/1.1 404 exit code 2 status: 500 https://example.com/a?b=c www.test.org",
      "\u001b[38;5;196mred\u001b[m \u001b[1;mbold\u001b[22m plain error",
      "\u001b[38:5:1mcolon\u001b[0m \u001b[?25l hidden \u001b[1 m odd error",
      "\u001b[" +
        "9".repeat(400) +
        "m overflow error \u001b[0;0;0m reset error",
      // 非 SGR 的 "m" 结尾序列不得改变当前样式状态
      "\u001b[31mred \u001b[38:5:1m still red error \u001b[0m error",
      "\u001b[1mbold \u001b[1 m still bold error \u001b[m error",
      "\u001b[31mred \u001b[;m error \u001b[0;31m error \u001b[39;49m error",
      "\u001b[31mred \u001b[" + "9".repeat(320) + ";0m error",
    ];

    let seed = 7;
    const random = (limit) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    const alphabet = '0123456789abcdefABCDEFxyz:::---..  /~=$_"\\\r\n\u001b[m;';
    for (let round = 0; round < 1500; round++) {
      let text = "";
      const length = 1 + random(120);
      for (let index = 0; index < length; index++) {
        text += alphabet[random(alphabet.length)];
      }
      samples.push(text);
    }

    // 由真实片段拼接，保证每条规则都会实际命中
    const tokens = [
      "error",
      "WARN",
      "failed",
      "ok",
      "GET",
      "pid",
      "pid=",
      "port",
      "listening on",
      "status",
      "HTTP/1.1",
      "exit code",
      "sha256:",
      "a".repeat(64),
      "deadbeef",
      "0123456789ab",
      "3f2a9c1",
      "550e8400-e29b-41d4-a716-446655440000",
      "192.168.1.10",
      "10.0.0.1:22",
      "fe80::1",
      "2001:db8::8329",
      "aa:bb:cc:dd:ee:ff",
      "12:00:01",
      "2026-10-25",
      "2026-10-25 12:00:01",
      "https://x.io/p",
      "www.a.b",
      "/var/log/a.log",
      "~/x",
      "./run.sh",
      "C:\\tmp\\a",
      "\\\\srv\\s",
      "$HOME",
      "${PATH}",
      "FOO=bar",
      'A="b c"',
      '"GET / HTTP/1.1" 200 12',
      "1234",
      "42",
      "\u001b[31m",
      "\u001b[38:5:1m",
      "\u001b[1 m",
      "\u001b[;m",
      "\u001b[0m",
      "\u001b[1;32m",
      "\u001b[m",
      "\u001b[22m",
      "\u001b[38;5;9m",
      "\u001b[K",
      "\u001b]0;title\u0007",
      " ",
      "  ",
      "\r\n",
      "\t",
      "=",
      ":",
      "-",
      ".",
      "/",
      '"',
      "(",
      "'",
    ];
    for (let round = 0; round < 1500; round++) {
      let text = "";
      const count = 1 + random(24);
      for (let index = 0; index < count; index++) {
        text += tokens[random(tokens.length)];
        if (random(3) === 0) text += " ";
      }
      samples.push(text);
    }

    for (const sample of samples) {
      expect(outputProcessor.applySyntaxHighlighting(sample)).toBe(
        reference.applySyntaxHighlighting(sample),
      );
    }
  });

  it("each rule prefilter alone keeps exactly the rule's own matches", () => {
    // 逐条规则比较：不受优先级遮蔽影响（如 uuid 总被 dockerId 覆盖）
    const backslash = String.fromCharCode(92);
    // 预筛按片段判断：每种临界形态单独成一条样本，避免被同片段里的其它形态掩盖
    const samples = [
      "550e8400-e29b-41d4-a716-446655440000",
      "550E8400-E29B-41D4-A716-446655440000",
      "image sha256:" + "ab".repeat(32),
      "SHA256:" + "CD".repeat(32),
      "1:2:3:4:5:6:192.168.1.1",
      "a:b:c:d:e:f:10.0.0.1",
      "1:2:3:4:5:6:7:8",
      "fe80::1",
      "::ffff:1.2.3.4",
      "2001:db8::8329",
      "aa:bb:cc:dd:ee:ff",
      "AA-BB-CC-DD-EE-FF",
      "open http://localhost:3000 now",
      "ftp://host",
      "www.example.org",
      "cd ~backup",
      " ~x",
      " ./run",
      " /etc",
      "C:" +
        backslash +
        "tmp " +
        backslash +
        backslash +
        "srv" +
        backslash +
        "s",
      '"GET / HTTP/1.1" 200 12 status 404 exit code 3 pid 77 port 8080',
      "PATH=/bin x A='b' $HOME ${USER} https://a.b/c www.d.e ~/f ./g /h",
      "2026-10-25 12:00:01 12:00:01 10.0.0.1:22/24 deadbeefcafe 3f2a9c1",
      "FOO=bar",
      " X_1=2",
      " _=x",
      "a_B=1",
      "user=admin level=info",
      "Q='quoted value'",
    ];
    let seed = 23;
    const random = (limit) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    const alphabet =
      "0123456789abcdefABCDEFsxyzGQ_:::---...  /~==$\"'" + backslash + "\r\n";
    for (let round = 0; round < 4000; round++) {
      let text = "";
      const length = 1 + random(90);
      for (let index = 0; index < length; index++) {
        text += alphabet[random(alphabet.length)];
      }
      samples.push(text);
    }

    const gatedRules = highlightRules.filter((rule) => rule.requires);
    expect(gatedRules.length).toBeGreaterThan(0);
    for (const rule of gatedRules) {
      const gated = new outputProcessor.constructor();
      gated.updateHighlightRules([rule]);
      expect(gated.compiledHighlightRules[0].requires).toBeTruthy();
      const ungated = new outputProcessor.constructor();
      const copy = { ...rule };
      delete copy.requires;
      ungated.updateHighlightRules([copy]);
      for (const sample of samples) {
        expect(gated.collectHighlightCandidates(sample)).toEqual(
          ungated.collectHighlightCandidates(sample),
        );
      }
    }
  });

  it("no highlight rule can match whitespace-only text", () => {
    // 覆盖 JS \s 的全部字符（含 Unicode 空白），与 highlightPlainTextSegment 的跳过条件一致
    const whitespace = [];
    for (let code = 0; code <= 0xffff; code++) {
      const char = String.fromCharCode(code);
      if (/\s/.test(char)) whitespace.push(char);
    }
    expect(whitespace.length).toBeGreaterThan(20);
    const processor = new outputProcessor.constructor();
    for (const text of [
      " ",
      "  \t ",
      "\r\n",
      " \r\n\t\v\f ",
      whitespace.join(""),
      ...whitespace.map((char) => ` ${char}${char} `),
    ]) {
      expect(processor.collectHighlightCandidates(text)).toEqual([]);
    }
  });

  it("highlights large log batches without dropping or reordering text", () => {
    const line =
      "2026-10-25 12:00:01 ERROR pid=1234 GET /var/log/app.log from 192.168.1.10:8080 status 500\r\n";
    const output = line.repeat(2000);
    const highlighted = outputProcessor.applySyntaxHighlighting(output);
    const visibleText = highlighted.replace(/\x1b\[[0-9;]*m/g, "");
    expect(visibleText).toBe(output);
    expect(highlighted.length).toBeGreaterThan(output.length);
  });
});
